import { basename, win32 } from 'node:path'

export const WRANGLER_PACKAGE = 'wrangler@4'
const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

/** R2 バケット名(3〜63字の小文字英数とハイフン)。不正なら例外。 */
export function validateBucket(bucket) {
  if (typeof bucket !== 'string' || !BUCKET_RE.test(bucket)) {
    throw new Error(`R2_BUCKET が不正です(小文字英数とハイフンの3〜63文字): ${JSON.stringify(bucket)}`)
  }
  return bucket
}

/**
 * シェルを介さない wrangler 起動コマンド。
 * win32 では Node が .cmd の直接起動を EINVAL で拒否するため、同梱の npx-cli.js を node で起動する。
 */
export function wranglerCommand(wranglerArgs, platform = process.platform, execPath = process.execPath) {
  const args = ['--yes', WRANGLER_PACKAGE, ...wranglerArgs]
  if (platform === 'win32') {
    // execPath は Windows 形式なので、ホストOSに依らず win32 のパス規則で扱う
    return { command: execPath, args: [win32.join(win32.dirname(execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'), ...args] }
  }
  return { command: 'npx', args }
}

/** 内容アドレスのキー(ハッシュ入り)。不変・長期キャッシュ可能。 */
export function mirrorKey(file) {
  if (!file.sha256) throw new Error(`sha256 が未記録のファイルはミラーできません: ${file.dest}`)
  if (!/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error(`sha256 の形式が不正です: ${file.dest}`)
  return `models/${file.sha256}/${basename(file.dest)}`
}

/** sha256 未記録のエントリは対象外。実行はせず引数を組み立てるだけ。 */
export function buildMirrorPlan(files, bucket) {
  validateBucket(bucket)
  return files
    .filter((f) => f.sha256)
    .map((f) => ({
      key: mirrorKey(f),
      localPath: f.dest,
      sha256: f.sha256,
      wranglerArgs: [
        'r2', 'object', 'put', `${bucket}/${mirrorKey(f)}`,
        '--file', f.dest, '--remote',
        '--content-type', 'application/octet-stream',
        '--cache-control', 'public, max-age=31536000, immutable',
      ],
    }))
}
