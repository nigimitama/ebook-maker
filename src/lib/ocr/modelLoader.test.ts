import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadModelBytes, resolveModelUrl, MODEL_CACHE_NAME } from './modelLoader'

// Cache API の最小の偽物。put/match だけ使う。
class FakeCache {
  store = new Map<string, Uint8Array>()
  async match(url: string): Promise<Response | undefined> {
    const bytes = this.store.get(url)
    if (!bytes) return undefined
    return new Response(bytes.slice().buffer as ArrayBuffer, {
      headers: { 'Content-Length': String(bytes.length) },
    })
  }
  async put(url: string, res: Response): Promise<void> {
    this.store.set(url, new Uint8Array(await res.arrayBuffer()))
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
function streamingFetch(body: Uint8Array, chunks: number) {
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
      headers: { 'Content-Length': String(body.length) },
    })
  })
}

beforeEach(setCaches)
afterEach(() => {
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: original.caches })
  globalThis.fetch = original.fetch
})

describe('resolveModelUrl', () => {
  it('サイト相対URLをアプリのベースURLで絶対化する', () => {
    const url = resolveModelUrl('models/a.onnx')
    expect(url).toBe(new URL(`${import.meta.env.BASE_URL}models/a.onnx`, location.origin).href)
    expect(url.startsWith('http')).toBe(true)
  })
})

describe('loadModelBytes', () => {
  const body = new Uint8Array(40)
  body.forEach((_, i) => {
    body[i] = i
  })

  it('1回目はfetchしてCache APIに保存する', async () => {
    const fetchMock = streamingFetch(body, 4)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const bytes = await loadModelBytes('https://example.test/m.onnx')
    expect(new Uint8Array(bytes)).toEqual(body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(openedNames).toEqual([MODEL_CACHE_NAME])
    expect(cache.store.get('https://example.test/m.onnx')).toEqual(body)
  })

  it('2回目はfetchせず保存済みを返す', async () => {
    const fetchMock = streamingFetch(body, 4)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await loadModelBytes('https://example.test/m.onnx')
    const second = await loadModelBytes('https://example.test/m.onnx')
    expect(new Uint8Array(second)).toEqual(body)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('onProgress が Content-Length を total として進捗を報告する', async () => {
    globalThis.fetch = streamingFetch(body, 4) as unknown as typeof fetch
    const calls: Array<[number, number]> = []
    await loadModelBytes('https://example.test/m.onnx', (received, total) => calls.push([received, total]))
    expect(calls).toEqual([
      [10, 40],
      [20, 40],
      [30, 40],
      [40, 40],
    ])
  })

  it('キャッシュ命中時も完了として進捗を1回報告する', async () => {
    globalThis.fetch = streamingFetch(body, 4) as unknown as typeof fetch
    await loadModelBytes('https://example.test/m.onnx')
    const calls: Array<[number, number]> = []
    await loadModelBytes('https://example.test/m.onnx', (received, total) => calls.push([received, total]))
    expect(calls).toEqual([[40, 40]])
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
    const bytes = await loadModelBytes('https://example.test/m.onnx')
    expect(new Uint8Array(bytes)).toEqual(body)
  })
})
