import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
// @ts-expect-error mjs without types
import {
  r2FallbackEnabled,
  fetchFromR2,
  fetchWithR2Fallback,
  EMPTY_PAYLOAD_SHA256,
  R2_FALLBACK_WARNING,
} from './r2Source.mjs'
// @ts-expect-error mjs without types
import { mirrorKey } from './mirrorPlan.mjs'

const KEY_SHA = 'ab'.repeat(32)
const file = { dest: 'public/models/a.onnx', sha256: KEY_SHA, sources: ['https://example.com/a.onnx'] }

const fullEnv = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  R2_BUCKET: 'ebook-maker-models',
}

type Call = { url: string; init: { method?: string; headers?: Record<string, string> } }

function recorder(handler: (c: Call) => unknown) {
  const calls: Call[] = []
  const fetchFn = (url: string, init: Call['init'] = {}) => {
    const c = { url: String(url), init }
    calls.push(c)
    return Promise.resolve(handler(c))
  }
  return { calls, fetch: fetchFn as unknown as typeof fetch }
}

describe('r2FallbackEnabled', () => {
  it('4変数が揃っているとき true', () => {
    expect(r2FallbackEnabled(fullEnv)).toBe(true)
  })
  it.each(Object.keys(fullEnv))('%s が欠けていたら false', (k) => {
    const env: Record<string, string> = { ...fullEnv }
    delete env[k]
    expect(r2FallbackEnabled(env)).toBe(false)
  })
  it.each(Object.keys(fullEnv))('%s が空文字なら false', (k) => {
    expect(r2FallbackEnabled({ ...fullEnv, [k]: '' })).toBe(false)
  })
  it.each(Object.keys(fullEnv))('%s が空白のみなら false', (k) => {
    expect(r2FallbackEnabled({ ...fullEnv, [k]: '   ' })).toBe(false)
  })
  it('env が空なら false', () => {
    expect(r2FallbackEnabled({})).toBe(false)
  })
})

describe('EMPTY_PAYLOAD_SHA256', () => {
  it('空文字の SHA-256 と一致する(値をその場で計算して照合)', () => {
    expect(EMPTY_PAYLOAD_SHA256).toBe(createHash('sha256').update('').digest('hex'))
    expect(EMPTY_PAYLOAD_SHA256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('fetchFromR2', () => {
  it('本文を Buffer で返し、S3互換APIのURLを組み立てる', async () => {
    const body = Buffer.from('hello r2')
    const r = recorder(() => new Response(body, { status: 200 }))
    const buf = await fetchFromR2(file, fullEnv, { fetch: r.fetch })

    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.equals(body)).toBe(true)
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0].url).toBe(
      `https://acct123.r2.cloudflarestorage.com/ebook-maker-models/${mirrorKey(file)}`,
    )
    expect(r.calls[0].init.method).toBe('GET')
  })

  it('SigV4 の必須ヘッダを付ける', async () => {
    const r = recorder(() => new Response(Buffer.from('x'), { status: 200 }))
    await fetchFromR2(file, fullEnv, { fetch: r.fetch })
    const h = r.calls[0].init.headers as Record<string, string>

    expect(h['x-amz-content-sha256']).toBe(EMPTY_PAYLOAD_SHA256)
    expect(h['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
    const day = h['x-amz-date'].slice(0, 8)
    expect(h.Authorization).toMatch(
      new RegExp(`^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/${day}/auto/s3/aws4_request, `),
    )
    expect(h.Authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date')
    expect(h.Authorization).toMatch(/Signature=[0-9a-f]{64}$/)
    expect(h.host).toBe('acct123.r2.cloudflarestorage.com')
  })

  // 期待値は本実装とは別に書き下した SigV4 実装で算出し、
  // さらに公式 @aws-sdk/signature-v4 + @aws-crypto/sha256-js の出力と一致することを確認済み。
  // 導出過程は .superpowers/sdd/2026-09-21-phase3-model-hosting/task-4-report.md 参照。
  it('既知の固定入力に対する署名が独立計算値と完全一致する', async () => {
    const r = recorder(() => new Response(Buffer.from('x'), { status: 200 }))
    await fetchFromR2(file, fullEnv, { fetch: r.fetch, now: () => new Date('2026-01-01T00:00:00Z') })
    const h = r.calls[0].init.headers as Record<string, string>

    expect(h['x-amz-date']).toBe('20260101T000000Z')
    expect(h.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260101/auto/s3/aws4_request, ' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=fe235de1af7492fa960527d1299e0e0ef5fee6b22cd7daf9d4874a1d21944668',
    )
  })

  it('非2xx はステータスを含む例外', async () => {
    const r = recorder(() => new Response('nope', { status: 403 }))
    await expect(fetchFromR2(file, fullEnv, { fetch: r.fetch })).rejects.toThrow(/403/)
  })

  it('404 でもステータスを含む例外', async () => {
    const r = recorder(() => new Response('', { status: 404 }))
    await expect(fetchFromR2(file, fullEnv, { fetch: r.fetch })).rejects.toThrow(/404/)
  })

  it('ネットワークエラーは伝播する', async () => {
    const boom = () => Promise.reject(new Error('ECONNRESET'))
    await expect(
      fetchFromR2(file, fullEnv, { fetch: boom as unknown as typeof fetch }),
    ).rejects.toThrow(/ECONNRESET/)
  })

  it('ハングした接続はタイムアウトメッセージを含む例外になる', async () => {
    const hangingFetch = (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        )
      })
    await expect(
      fetchFromR2(file, fullEnv, { fetch: hangingFetch as unknown as typeof fetch, timeoutMs: 20 }),
    ).rejects.toThrow(/タイムアウト/)
  })

  it('Secrets が不足していれば呼ぶ前に例外', async () => {
    const r = recorder(() => new Response('x', { status: 200 }))
    await expect(
      fetchFromR2(file, { ...fullEnv, R2_BUCKET: '' }, { fetch: r.fetch }),
    ).rejects.toThrow(/R2/)
    expect(r.calls).toHaveLength(0)
  })

  it('sha256 未記録のファイルはミラー取得できない', async () => {
    const r = recorder(() => new Response('x', { status: 200 }))
    await expect(
      fetchFromR2({ ...file, sha256: null }, fullEnv, { fetch: r.fetch }),
    ).rejects.toThrow(/sha256/)
  })

  it('不正なバケット名は拒否する', async () => {
    const r = recorder(() => new Response('x', { status: 200 }))
    await expect(
      fetchFromR2(file, { ...fullEnv, R2_BUCKET: 'Bad Bucket' }, { fetch: r.fetch }),
    ).rejects.toThrow(/R2_BUCKET/)
  })
})

describe('fetchWithR2Fallback', () => {
  const body = Buffer.from('model bytes')
  const real = {
    dest: 'public/models/a.onnx',
    sha256: createHash('sha256').update(body).digest('hex'),
    sources: ['https://official.example/a.onnx'],
  }
  const R2_URL = (f: typeof real) =>
    `https://acct123.r2.cloudflarestorage.com/ebook-maker-models/${mirrorKey(f)}`

  it('公式ソースが生きていれば R2 には行かず、WARN も出さない', async () => {
    const logs: string[] = []
    const r = recorder(() => new Response(body, { status: 200 }))
    const buf = await fetchWithR2Fallback(real, fullEnv, { fetch: r.fetch, log: (m: string) => logs.push(m) })

    expect(buf.equals(body)).toBe(true)
    expect(r.calls.map((c) => c.url)).toEqual(['https://official.example/a.onnx'])
    expect(logs).toEqual([])
  })

  it('公式が落ちていたら R2 にフォールバックし WARN を出す', async () => {
    const logs: string[] = []
    const r = recorder((c) =>
      c.url.includes('official.example') ? new Response('', { status: 404 }) : new Response(body, { status: 200 }),
    )
    const buf = await fetchWithR2Fallback(real, fullEnv, { fetch: r.fetch, log: (m: string) => logs.push(m) })

    expect(buf.equals(body)).toBe(true)
    expect(r.calls.map((c) => c.url)).toEqual(['https://official.example/a.onnx', R2_URL(real)])
    expect(logs).toEqual([R2_FALLBACK_WARNING])
  })

  it('Secrets がなければ R2 を試さず、公式の失敗理由を保って投げる', async () => {
    const r = recorder(() => new Response('', { status: 500 }))
    await expect(fetchWithR2Fallback(real, {}, { fetch: r.fetch, log: () => {} })).rejects.toThrow(
      /HTTP 500[\s\S]*Secrets 未設定/,
    )
    expect(r.calls).toHaveLength(1)
  })

  it('R2 も失敗したら公式・R2 両方の理由を含めて投げる', async () => {
    const r = recorder(() => new Response('', { status: 503 }))
    await expect(
      fetchWithR2Fallback(real, fullEnv, { fetch: r.fetch, log: () => {} }),
    ).rejects.toThrow(/HTTP 503[\s\S]*R2 ミラー:[\s\S]*503/)
  })

  it('R2 のハッシュが合わなければ失敗として扱う', async () => {
    const r = recorder((c) =>
      c.url.includes('official.example')
        ? new Response('', { status: 404 })
        : new Response(Buffer.from('tampered'), { status: 200 }),
    )
    await expect(
      fetchWithR2Fallback(real, fullEnv, { fetch: r.fetch, log: () => {} }),
    ).rejects.toThrow(/R2 ミラー: SHA-256 不一致/)
  })
})
