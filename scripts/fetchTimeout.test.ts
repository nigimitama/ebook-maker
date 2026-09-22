import { describe, expect, it } from 'vitest'
// @ts-expect-error mjs without types
import { fetchWithTimeout } from './fetchTimeout.mjs'

/** 実際の fetch と同様、signal の abort を見て初めて reject する「ハングする」偽 fetch。 */
function hangingFetch(_url: string, init: { signal: AbortSignal }) {
  return new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () =>
      reject(new DOMException('The operation was aborted.', 'AbortError')),
    )
  })
}

describe('fetchWithTimeout', () => {
  it('doFetch がタイムアウト前に解決すればそのまま返し、signal 付きで呼ばれる', async () => {
    let capturedInit: { signal?: AbortSignal } = {}
    const doFetch = async (_url: string, init: { signal?: AbortSignal }) => {
      capturedInit = init
      return 'ok-value'
    }
    const result = await fetchWithTimeout(doFetch, 'https://example.com', {}, 1000)
    expect(result).toBe('ok-value')
    expect(capturedInit.signal).toBeInstanceOf(AbortSignal)
  })

  it('timeoutMs 経過でタイムアウトメッセージの Error を投げ、テスト自体も速く終わる', async () => {
    await expect(fetchWithTimeout(hangingFetch, 'https://example.com', {}, 20)).rejects.toThrow(
      'タイムアウト(20ms)',
    )
  })

  it('abort以外のエラーはそのまま伝播する(タイムアウトメッセージに書き換えない)', async () => {
    const doFetch = async () => {
      throw new Error('ECONNRESET')
    }
    await expect(fetchWithTimeout(doFetch, 'https://example.com', {}, 1000)).rejects.toThrow('ECONNRESET')
  })
})
