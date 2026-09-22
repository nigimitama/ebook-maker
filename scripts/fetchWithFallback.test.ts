import { describe, expect, it } from 'vitest'
// @ts-expect-error mjs without types
import { fetchVerified } from './fetchWithFallback.mjs'

const ok = (body: string) => new Response(body, { status: 200 })
const verifyHash = (buf: Buffer, expected: string | null) => expected == null || buf.toString() === expected

describe('fetchVerified', () => {
  it('一次ソースが成功すれば二次を呼ばない', async () => {
    const calls: string[] = []
    const fetch = async (u: string) => (calls.push(u), ok('A'))
    const buf = await fetchVerified(['p', 's'], 'A', { fetch, verifyHash })
    expect(buf.toString()).toBe('A')
    expect(calls).toEqual(['p'])
  })
  it('一次が404なら二次を試す', async () => {
    const fetch = async (u: string) => (u === 'p' ? new Response('', { status: 404 }) : ok('A'))
    expect((await fetchVerified(['p', 's'], 'A', { fetch, verifyHash })).toString()).toBe('A')
  })
  it('一次のハッシュ不一致でも二次を試す(改ざん/更新の検出)', async () => {
    const fetch = async (u: string) => ok(u === 'p' ? 'BAD' : 'A')
    expect((await fetchVerified(['p', 's'], 'A', { fetch, verifyHash })).toString()).toBe('A')
  })
  it('全滅なら各ソースの理由を含むエラー', async () => {
    const fetch = async () => new Response('', { status: 500 })
    await expect(fetchVerified(['p', 's'], 'A', { fetch, verifyHash })).rejects.toThrow(/p.*500[\s\S]*s.*500/)
  })
  it('ネットワーク例外も次のソースへ回す', async () => {
    const fetch = async (u: string) => {
      if (u === 'p') throw new Error('ECONNRESET')
      return ok('A')
    }
    expect((await fetchVerified(['p', 's'], 'A', { fetch, verifyHash })).toString()).toBe('A')
  })
  it('一次がハングしてタイムアウトしたら二次を試す', async () => {
    const fetch = async (u: string, init: { signal: AbortSignal }) => {
      if (u === 'p') {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          )
        })
      }
      return ok('A')
    }
    const buf = await fetchVerified(['p', 's'], 'A', { fetch, verifyHash, timeoutMs: 20 })
    expect(buf.toString()).toBe('A')
  })
})
