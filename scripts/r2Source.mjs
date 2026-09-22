import { createHash, createHmac } from 'node:crypto'
import { mirrorKey, validateBucket } from './mirrorPlan.mjs'
import { fetchVerified } from './fetchWithFallback.mjs'
import { verifyHash } from './modelFiles.mjs'
import { fetchWithTimeout } from './fetchTimeout.mjs'

// R2 は S3互換API を公開しており、アクセスキーID + シークレットアクセスキーの組による
// AWS Signature Version 4(region="auto", service="s3")で1オブジェクトを GET できる。
// wrangler は OAuth セッション前提で CI では非対話認証できないため、CI からはこの経路を使う。
// (ローカルからのアップロードは mirror-models.mjs の wrangler 経路のまま)
const REGION = 'auto'
const SERVICE = 's3'
const ALGORITHM = 'AWS4-HMAC-SHA256'
const REQUIRED_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']

/** ペイロードなしの GET は空文字の SHA-256 を署名対象にする。 */
export const EMPTY_PAYLOAD_SHA256 = createHash('sha256').update('').digest('hex')

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => createHmac('sha256', key).update(data).digest()

/** R2 の4 Secrets が全部そろっていれば true。フォークPRなど未設定の環境では false。 */
export function r2FallbackEnabled(env) {
  return REQUIRED_ENV.every((k) => typeof env?.[k] === 'string' && env[k].trim() !== '')
}

/** SigV4 の UriEncode。非予約文字はそのまま、'/' はオブジェクトキー内なのでエンコードしない。 */
function uriEncodePath(path) {
  return path
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join('/')
}

/** YYYYMMDDTHHMMSSZ */
export function amzDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * SigV4 署名ヘッダを組み立てる。
 * 正規リクエスト → 署名文字列 → 日付/リージョン/サービス/aws4_request の HMAC 連鎖で導いた署名鍵 → 署名。
 */
export function signRequest({ method, host, path, query = '', payloadHash, accessKeyId, secretAccessKey, region = REGION, service = SERVICE, date }) {
  const amz = amzDate(date)
  const dateStamp = amz.slice(0, 8)

  // 署名対象ヘッダ。ヘッダ名は小文字にして名前順に並べる。
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amz }
  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [method, uriEncodePath(path), query, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [ALGORITHM, amz, scope, sha256Hex(canonicalRequest)].join('\n')

  let key = hmac(`AWS4${secretAccessKey}`, dateStamp)
  key = hmac(key, region)
  key = hmac(key, service)
  key = hmac(key, 'aws4_request')
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex')

  return {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amz,
    Authorization: `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

/** R2 ミラーの URL(S3互換エンドポイント)。 */
export function r2ObjectUrl(file, env) {
  const bucket = validateBucket(env.R2_BUCKET)
  return {
    host: `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    path: `/${bucket}/${mirrorKey(file)}`,
  }
}

/**
 * R2 ミラーから1ファイルを取得して Buffer で返す。ハッシュ検証は呼び出し側の責務。
 * deps.fetch / deps.now はテスト用の差し替え口。
 */
export async function fetchFromR2(file, env, deps = {}) {
  const doFetch = deps.fetch ?? fetch
  const now = deps.now ?? (() => new Date())
  if (!r2FallbackEnabled(env)) {
    throw new Error(`R2 ミラーの設定が不足しています(${REQUIRED_ENV.join(', ')} が必要)`)
  }
  const { host, path } = r2ObjectUrl(file, env)
  const url = `https://${host}${path}`
  const headers = signRequest({
    method: 'GET',
    host,
    path,
    payloadHash: EMPTY_PAYLOAD_SHA256,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    date: now(),
  })

  let res
  try {
    res = await fetchWithTimeout(doFetch, url, { method: 'GET', headers }, deps.timeoutMs)
  } catch (e) {
    // 認証情報は組み立て済みヘッダにしか入っていないので、メッセージには URL のみ載せる。
    throw new Error(`R2 ミラーへの接続に失敗しました: ${url}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!res.ok) {
    throw new Error(`R2 ミラーの取得に失敗しました: ${url}: HTTP ${res.status}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

export const R2_FALLBACK_WARNING = 'WARN: 公式ソースから取得できなかったため R2 ミラーを使用'

/**
 * 公式ソース(sources 先頭から順)→ Secrets があれば R2 ミラー、の順に取得する。
 * R2 経路も同じ SHA-256 で検証する。すべて失敗したら公式側の失敗理由を保ったまま投げる。
 */
export async function fetchWithR2Fallback(file, env, deps = {}) {
  const log = deps.log ?? console.log
  try {
    return await fetchVerified(file.sources, file.sha256, deps)
  } catch (officialError) {
    if (!r2FallbackEnabled(env)) {
      throw new Error(`${officialError.message}\nR2 ミラー: Secrets 未設定のため試行しませんでした`)
    }
    let buf
    try {
      buf = await fetchFromR2(file, env, deps)
    } catch (r2Error) {
      throw new Error(`${officialError.message}\nR2 ミラー: ${r2Error.message}`)
    }
    if (!(deps.verifyHash ?? verifyHash)(buf, file.sha256)) {
      throw new Error(`${officialError.message}\nR2 ミラー: SHA-256 不一致`)
    }
    log(R2_FALLBACK_WARNING)
    return buf
  }
}
