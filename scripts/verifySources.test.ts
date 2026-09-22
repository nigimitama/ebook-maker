import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
// @ts-expect-error mjs without types
import { verifyAll, exitCodeFor } from './verifySources.mjs'

const body = Buffer.from('model bytes')
const sha = createHash('sha256').update(body).digest('hex')

const file = {
  dest: 'public/models/a.onnx',
  sha256: sha,
  sources: ['https://official.example/a.onnx'],
}

const fullEnv = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  R2_BUCKET: 'ebook-maker',
}

const okFetch = () => Promise.resolve(new Response(body, { status: 200 }))
const deadFetch = () => Promise.resolve(new Response('', { status: 404 }))
const okR2 = () => Promise.resolve(body)
const deadR2 = () => Promise.reject(new Error('HTTP 404'))

function run(env: Record<string, string>, opts: { fetch?: unknown; fetchFromR2?: unknown }) {
  const logs: string[] = []
  return verifyAll([file], env, { ...opts, log: (m: string) => logs.push(m) }).then(
    (r: { officialDead: string[]; fullyDead: string[] }) => ({ ...r, logs, out: logs.join('\n') }),
  )
}

describe('verifyAll の警報条件', () => {
  it('(a) 公式OK + R2 OK → 異常なし・注釈なし', async () => {
    const r = await run(fullEnv, { fetch: okFetch, fetchFromR2: okR2 })
    expect(r.officialDead).toEqual([])
    expect(r.fullyDead).toEqual([])
    expect(exitCodeFor(r)).toBe(0)
    expect(r.out).not.toContain('::error::')
    expect(r.out).not.toContain('::warning::')
  })

  it('(b) 公式が全滅 + R2 OK → 非0終了 + ファイル名を含む ::error:: 注釈', async () => {
    const r = await run(fullEnv, { fetch: deadFetch, fetchFromR2: okR2 })
    expect(r.officialDead).toEqual([file.dest])
    // R2 が代替しているので「全滅」ではない
    expect(r.fullyDead).toEqual([])
    expect(exitCodeFor(r)).not.toBe(0)
    const err = r.logs.find((l) => l.startsWith('::error::'))
    expect(err).toBeDefined()
    expect(err).toContain(file.dest)
  })

  it('(c) 公式OK + R2 が落ちている → 終了コード0だが ::warning:: を出す', async () => {
    const r = await run(fullEnv, { fetch: okFetch, fetchFromR2: deadR2 })
    expect(r.officialDead).toEqual([])
    expect(r.fullyDead).toEqual([])
    expect(exitCodeFor(r)).toBe(0)
    expect(r.out).not.toContain('::error::')
    const warn = r.logs.find((l) => l.startsWith('::warning::'))
    expect(warn).toBeDefined()
    expect(warn).toContain(file.dest)
  })

  it('(c2) 公式OK + R2 が Secrets 未設定 → 終了コード0・注釈なし', async () => {
    const r = await run({}, { fetch: okFetch, fetchFromR2: deadR2 })
    expect(exitCodeFor(r)).toBe(0)
    expect(r.out).not.toContain('::error::')
    expect(r.out).not.toContain('::warning::')
  })

  it('(d) 公式もR2も全滅 → 非0終了 + ::error::(より重い扱い)', async () => {
    const r = await run(fullEnv, { fetch: deadFetch, fetchFromR2: deadR2 })
    expect(r.officialDead).toEqual([file.dest])
    expect(r.fullyDead).toEqual([file.dest])
    expect(exitCodeFor(r)).not.toBe(0)
    const err = r.logs.find((l) => l.startsWith('::error::'))
    expect(err).toBeDefined()
    expect(err).toContain(file.dest)
  })

  it('公式ソースのSHA-256不一致も公式全滅として扱う', async () => {
    const tampered = () => Promise.resolve(new Response(Buffer.from('tampered'), { status: 200 }))
    const r = await run(fullEnv, { fetch: tampered, fetchFromR2: okR2 })
    expect(r.officialDead).toEqual([file.dest])
    expect(r.out).toContain('SHA-256 不一致')
    expect(exitCodeFor(r)).not.toBe(0)
  })

  it('R2 のSHA-256不一致は警告扱い(公式が生きている場合)', async () => {
    const staleR2 = () => Promise.resolve(Buffer.from('stale object'))
    const r = await run(fullEnv, { fetch: okFetch, fetchFromR2: staleR2 })
    expect(r.officialDead).toEqual([])
    expect(exitCodeFor(r)).toBe(0)
    expect(r.logs.find((l) => l.startsWith('::warning::'))).toContain(file.dest)
  })

  it('複数ソースのうち1本でも生きていれば公式は健全', async () => {
    const two = { ...file, sources: ['https://dead.example/a', 'https://alive.example/a'] }
    const mixed = (url: string) =>
      Promise.resolve(url.includes('alive') ? new Response(body, { status: 200 }) : new Response('', { status: 500 }))
    const logs: string[] = []
    const r = await verifyAll([two], fullEnv, {
      fetch: mixed as unknown as typeof fetch,
      fetchFromR2: okR2,
      log: (m: string) => logs.push(m),
    })
    expect(r.officialDead).toEqual([])
    expect(exitCodeFor(r)).toBe(0)
  })

  it('ネットワーク例外も公式失敗として扱う', async () => {
    const boom = () => Promise.reject(new Error('ECONNRESET'))
    const r = await run(fullEnv, { fetch: boom, fetchFromR2: okR2 })
    expect(r.officialDead).toEqual([file.dest])
    expect(r.out).toContain('ECONNRESET')
  })
})
