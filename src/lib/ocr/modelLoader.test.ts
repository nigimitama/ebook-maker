import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadModelBytes,
  evictModel,
  resolveModelUrl,
  MODEL_CACHE_NAME,
  MIN_MODEL_BYTES,
} from './modelLoader'

// Cache API の最小の偽物。match/put/delete だけ使う。
class FakeCache {
  store = new Map<string, { bytes: Uint8Array; contentType: string }>()
  async match(url: string): Promise<Response | undefined> {
    const entry = this.store.get(url)
    if (!entry) return undefined
    return new Response(entry.bytes.slice().buffer as ArrayBuffer, {
      headers: {
        'Content-Length': String(entry.bytes.length),
        'Content-Type': entry.contentType,
      },
    })
  }
  async put(url: string, res: Response): Promise<void> {
    this.store.set(url, {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
    })
  }
  async delete(url: string): Promise<boolean> {
    return this.store.delete(url)
  }
}

const original = { caches: globalThis.caches, fetch: globalThis.fetch }
let cache: FakeCache
let openedNames: string[]

function setCaches() {
  cache = new FakeCache()
  openedNames = []
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      open: async (name: string) => {
        openedNames.push(name)
        return cache
      },
    },
  })
}

// Content-Length 付きでチャンク分割して返す fetch の偽物
function streamingFetch(body: Uint8Array, chunks: number, contentType = 'application/octet-stream') {
  return vi.fn(async () => {
    const size = Math.ceil(body.length / chunks)
    let offset = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= body.length) {
          controller.close()
          return
        }
        controller.enqueue(body.subarray(offset, offset + size))
        offset += size
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Length': String(body.length), 'Content-Type': contentType },
    })
  })
}

beforeEach(setCaches)
afterEach(() => {
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: original.caches })
  globalThis.fetch = original.fetch
  vi.unstubAllEnvs()
})

describe('resolveModelUrl', () => {
  it('サイト相対URLをアプリのベースURLで絶対化する', () => {
    const url = resolveModelUrl('models/a.onnx')
    expect(url).toBe(new URL(`${import.meta.env.BASE_URL}models/a.onnx`, location.origin).href)
    expect(url.startsWith('http')).toBe(true)
  })
})

// ONNXらしい中身(protobufなので先頭は 0x08)で、最小サイズを満たす本体
const SIZE = MIN_MODEL_BYTES + 4

// 1MiB級の Uint8Array を toEqual で比べると要素ごとの比較で遅く(約1秒)、
// CIでは5秒のタイムアウトを超える。Buffer.compare なら一瞬で済む。
function expectSameBytes(actual: Uint8Array | undefined, expected: Uint8Array) {
  expect(actual).toBeDefined()
  expect(Buffer.compare(actual as Uint8Array, expected)).toBe(0)
}
function modelBody(): Uint8Array {
  const body = new Uint8Array(SIZE)
  body[0] = 0x08
  for (let i = 1; i < SIZE; i += 1) body[i] = i % 251
  return body
}

describe('loadModelBytes', () => {
  const body = modelBody()
  const URL_A = 'https://example.test/m.onnx'

  it('1回目はfetchしてCache APIに保存する', async () => {
    const fetchMock = streamingFetch(body, 4)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const bytes = await loadModelBytes(URL_A)
    expectSameBytes(new Uint8Array(bytes), body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(openedNames).toEqual([MODEL_CACHE_NAME])
    expectSameBytes(cache.store.get(URL_A)?.bytes, body)
  })

  it('2回目はfetchせず保存済みを返す', async () => {
    const fetchMock = streamingFetch(body, 4)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await loadModelBytes(URL_A)
    const second = await loadModelBytes(URL_A)
    expectSameBytes(new Uint8Array(second), body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('onProgress が Content-Length を total として進捗を報告する', async () => {
    globalThis.fetch = streamingFetch(body, 4) as unknown as typeof fetch
    const calls: Array<[number, number]> = []
    await loadModelBytes(URL_A, (received, total) => calls.push([received, total]))
    const chunk = Math.ceil(SIZE / 4)
    expect(calls).toEqual([
      [chunk, SIZE],
      [chunk * 2, SIZE],
      [chunk * 3, SIZE],
      [SIZE, SIZE],
    ])
  })

  it('キャッシュ命中時も完了として進捗を1回報告する', async () => {
    globalThis.fetch = streamingFetch(body, 4) as unknown as typeof fetch
    await loadModelBytes(URL_A)
    const calls: Array<[number, number]> = []
    await loadModelBytes(URL_A, (received, total) => calls.push([received, total]))
    expect(calls).toEqual([[SIZE, SIZE]])
  })

  it('HTTPエラーなら例外を投げ、キャッシュに入れない', async () => {
    globalThis.fetch = vi.fn(async () => new Response('ng', { status: 404 })) as unknown as typeof fetch
    await expect(loadModelBytes('https://example.test/missing.onnx')).rejects.toThrow(/404/)
    expect(cache.store.size).toBe(0)
  })

  it('Cache APIが無い環境でもfetchだけで動く', async () => {
    Object.defineProperty(globalThis, 'caches', { configurable: true, value: undefined })
    const fetchMock = streamingFetch(body, 2)
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const bytes = await loadModelBytes(URL_A)
    expectSameBytes(new Uint8Array(bytes), body)
  })

  // Vite の dev/preview はモデルが無いとき index.html を 200 で返すので、
  // それをモデルとしてキャッシュしてしまうと永久に壊れたままになる。
  it('200で返るHTML(dev/previewのSPAフォールバック)は拒否し、キャッシュしない', async () => {
    const html = new TextEncoder().encode('<!doctype html><html><body>app</body></html>')
    globalThis.fetch = streamingFetch(html, 1, 'text/html') as unknown as typeof fetch
    await expect(loadModelBytes(URL_A)).rejects.toThrow(/HTML/)
    expect(cache.store.size).toBe(0)
  })

  it('Content-Typeが正しくても中身がHTMLなら拒否する', async () => {
    const html = new TextEncoder().encode(`<!doctype html>${'x'.repeat(SIZE)}`)
    globalThis.fetch = streamingFetch(html, 2) as unknown as typeof fetch
    await expect(loadModelBytes(URL_A)).rejects.toThrow(/HTML/)
    expect(cache.store.size).toBe(0)
  })

  // devサーバーでHTMLが返る典型的な原因は npm run fetch-models 未実行なので、
  // 開発時(import.meta.env.DEV)はそのヒントをエラーメッセージに含める。
  // 本番ビルドでは無関係な文言なので出さない。
  it('開発時はHTML拒否のエラーにnpm run fetch-modelsのヒントを含める', async () => {
    vi.stubEnv('DEV', true)
    const html = new TextEncoder().encode('<!doctype html><html><body>app</body></html>')
    globalThis.fetch = streamingFetch(html, 1, 'text/html') as unknown as typeof fetch
    await expect(loadModelBytes(URL_A)).rejects.toThrow(/npm run fetch-models/)
  })

  it('本番ビルドではHTML拒否のエラーにfetch-modelsのヒントを含めない', async () => {
    vi.stubEnv('DEV', false)
    const html = new TextEncoder().encode('<!doctype html><html><body>app</body></html>')
    globalThis.fetch = streamingFetch(html, 1, 'text/html') as unknown as typeof fetch
    await expect(loadModelBytes(URL_A)).rejects.not.toThrow(/npm run fetch-models/)
    await expect(loadModelBytes(URL_A)).rejects.toThrow(/HTML/)
  })

  it('小さすぎる応答はモデルとみなさず拒否する', async () => {
    globalThis.fetch = streamingFetch(new Uint8Array([8, 1, 2, 3]), 1) as unknown as typeof fetch
    await expect(loadModelBytes(URL_A)).rejects.toThrow(/小さ/)
    expect(cache.store.size).toBe(0)
  })

  it('壊れたキャッシュ(HTMLが入っている)は捨てて再取得する', async () => {
    const html = new TextEncoder().encode('<!doctype html><html></html>')
    cache.store.set(URL_A, { bytes: html, contentType: 'text/html' })
    const fetchMock = streamingFetch(body, 2)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const bytes = await loadModelBytes(URL_A)
    expectSameBytes(new Uint8Array(bytes), body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expectSameBytes(cache.store.get(URL_A)?.bytes, body)
  })

  it('壊れたキャッシュ(小さすぎる)も捨てて再取得する', async () => {
    cache.store.set(URL_A, { bytes: new Uint8Array(16), contentType: 'application/octet-stream' })
    const fetchMock = streamingFetch(body, 2)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const bytes = await loadModelBytes(URL_A)
    expectSameBytes(new Uint8Array(bytes), body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('evictModel', () => {
  it('保存済みのモデルを消し、次回は再取得になる', async () => {
    const body = modelBody()
    const fetchMock = streamingFetch(body, 2)
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const url = 'https://example.test/broken.onnx'

    await loadModelBytes(url)
    expect(cache.store.has(url)).toBe(true)

    // セッション生成に失敗したときの想定(壊れたバイト列だった)
    await evictModel(url)
    expect(cache.store.has(url)).toBe(false)

    await loadModelBytes(url)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('Cache APIが無くても例外にしない', async () => {
    Object.defineProperty(globalThis, 'caches', { configurable: true, value: undefined })
    await expect(evictModel('https://example.test/x.onnx')).resolves.toBeUndefined()
  })
})
