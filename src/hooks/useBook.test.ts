import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import type { RawImage } from '../types'
import { fitWithin } from '../lib/previewSizes'

// fake-indexeddb は値をNodeの構造化複製に通す。node:buffer の Blob は保たれるが、
// jsdomの Blob はただのオブジェクトに潰れてしまう(imageStore.test.ts が
// node:buffer を使っているのも同じ理由)。jsdomの URL.createObjectURL は
// どちらも受け付ける。
function blobOf(text: string, type: string): Blob {
  return new NodeBlob([text], { type }) as unknown as Blob
}

// useBook が読み込むブラウザ専用の依存は canvas
// (createImageBitmap / getImageData / toBlob) と実際のWorkerを必要とするが、
// jsdomはどちらも提供しない。幅・高さ・RGBAバイト列を持つJSONという
// 往復可能な単純「画像フォーマット」でfakeを用意し、fake-indexeddb上の
// 本物の ImageStore に対して取り込み・結合・書き出しを通しで動かせるようにする。
// 結果の画素値もそのまま検証できる。
interface FakeImageFile {
  w: number
  h: number
  data: number[]
}

function encodeFake(image: RawImage): Blob {
  const payload: FakeImageFile = {
    w: image.width,
    h: image.height,
    data: Array.from(image.data),
  }
  return blobOf(JSON.stringify(payload), 'image/png')
}

async function decodeFake(blob: Blob): Promise<RawImage> {
  const parsed = JSON.parse(await blob.text()) as FakeImageFile
  return { data: Uint8ClampedArray.from(parsed.data), width: parsed.w, height: parsed.h }
}

// canvasなしで downscaleImage の契約を再現する: `fitWithin` が選ぶのと同じ
// 目標サイズへ最近傍でリサンプリングし、無加工の原本の寸法を返す
// (書き出すページのサイズはこの値から決まる)。
async function downscaleFake(blob: Blob, maxEdge: number) {
  const source = await decodeFake(blob)
  const target = fitWithin(source.width, source.height, maxEdge)
  const data = new Uint8ClampedArray(target.width * target.height * 4)
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor((x * source.width) / target.width))
      const sy = Math.min(source.height - 1, Math.floor((y * source.height) / target.height))
      const from = (sy * source.width + sx) * 4
      const to = (y * target.width + x) * 4
      data.set(source.data.subarray(from, from + 4), to)
    }
  }
  const image: RawImage = { data, width: target.width, height: target.height }
  return {
    image,
    originalWidth: source.width,
    originalHeight: source.height,
    toBlob: async () => encodeFake(image),
  }
}

vi.mock('../lib/decodeImage', () => ({
  decodeBlobToRawImage: (blob: Blob) => decodeFake(blob),
}))
// 縮小処理を任意のタイミングまで止められるようにしておく。ページ切り替え中の
// 「デコード待ちの間だけ前のページの画像が残る」競合を決定的に再現するために使う。
let downscaleGate: { wait: Promise<void>; open: () => void } | null = null

/** 以降の downscale 呼び出しを止める。戻り値を呼ぶと再開する。 */
function pauseDownscale(): () => void {
  let open!: () => void
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  downscaleGate = { wait, open }
  return () => {
    downscaleGate = null
    open()
  }
}

vi.mock('../lib/downscaleImage', () => ({
  downscale: async (blob: Blob, maxEdge: number) => {
    if (downscaleGate) await downscaleGate.wait
    return downscaleFake(blob, maxEdge)
  },
}))
vi.mock('../lib/encodeImage', () => ({
  encodeRawImageToPng: async (image: RawImage) => encodeFake(image),
}))
vi.mock('../lib/exportRunner', () => ({
  runExportInWorker: vi.fn(async () => blobOf('pdf', 'application/pdf')),
}))

const { useBook } = await import('./useBook')
const { runExportInWorker } = await import('../lib/exportRunner')

/** デコードすると画素がちょうど `pixel` になる1x1の画像ファイル。 */
function imageFile(name: string, pixel: [number, number, number, number]): File {
  const payload: FakeImageFile = { w: 1, h: 1, data: pixel }
  return new NodeFile([JSON.stringify(payload)], name, { type: 'image/png' }) as unknown as File
}

/** fakeのデコーダが解釈できないファイル。壊れたスキャンの代わり。 */
function corruptFile(name: string): File {
  return new NodeFile(['not an image'], name, { type: 'image/png' }) as unknown as File
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  cleanup()
  // ゲートを開いたままにしておかないと、閉じたまま次のテストへ漏れて止まる。
  downscaleGate?.open()
  downscaleGate = null
  await deleteDatabase('ebook-maker')
  vi.clearAllMocks()
})

async function importPages(files: File[]) {
  const view = renderHook(() => useBook())
  await act(async () => {
    await view.result.current.importFiles(files)
  })
  return view
}

describe('useBook', () => {
  it('imports files and exposes a thumbnail for each page', async () => {
    const view = await importPages([
      imageFile('a.png', [10, 20, 30, 255]),
      imageFile('b.png', [40, 50, 60, 255]),
    ])
    expect(view.result.current.pages).toHaveLength(2)
    expect(view.result.current.error).toBeNull()
    for (const page of view.result.current.pages) {
      expect(view.result.current.thumbnails[page.id]).toBeTruthy()
    }
  })

  it('skips a file it cannot decode, keeps the rest, and names the failure', async () => {
    const view = await importPages([
      imageFile('good.png', [10, 20, 30, 255]),
      corruptFile('broken.png'),
      imageFile('good2.png', [40, 50, 60, 255]),
    ])
    expect(view.result.current.pages).toHaveLength(2)
    expect(view.result.current.error).toBe('読み込みに失敗しました: broken.png')

    await act(async () => view.result.current.clearError())
    expect(view.result.current.error).toBeNull()
  })

  it('rebuilds thumbnails for pages restored from IndexedDB after a reload', async () => {
    const first = await importPages([
      imageFile('a.png', [10, 20, 30, 255]),
      imageFile('b.png', [40, 50, 60, 255]),
    ])
    const importedIds = first.result.current.pages.map((p) => p.id)
    first.unmount()

    // マウントし直すことでページのリロードを再現する: データベースは同じで、
    // メモリ上の状態は引き継がれない。
    const reloaded = renderHook(() => useBook())
    await waitFor(() => expect(reloaded.result.current.pages).toHaveLength(2))
    expect(reloaded.result.current.pages.map((p) => p.id)).toEqual(importedIds)
    for (const id of importedIds) {
      expect(reloaded.result.current.thumbnails[id]).toBeTruthy()
    }
  })

  it('bakes each page’s adjustment into the pixels when merging a spread', async () => {
    const view = await importPages([
      imageFile('left.png', [10, 20, 30, 255]),
      imageFile('right.png', [40, 50, 60, 255]),
    ])
    const [left, right] = view.result.current.pages

    await act(async () => {
      await view.result.current.updateAdjustment(left.id, { brightness: 50, contrast: 0 })
      await view.result.current.updateAdjustment(right.id, { brightness: 0, contrast: 0 })
    })
    await waitFor(() =>
      expect(
        view.result.current.pages.find((p) => p.id === left.id)?.adjustment.brightness,
      ).toBe(50),
    )

    await act(async () => {
      await view.result.current.confirmMerge(left.id, right.id)
    })

    await waitFor(() => expect(view.result.current.pages).toHaveLength(1))
    const merged = view.result.current.pages[0]
    // 結合後のページに追加の調整値は乗らない: すでに画素へ焼き込まれている。
    expect(merged.adjustment).toEqual({ brightness: 0, contrast: 0 })
    expect(view.result.current.selectedImage).not.toBeNull()

    // 左半分は明るさ+50、右半分は無調整のまま。
    const pixels = view.result.current.selectedImage!.data
    expect(Array.from(pixels.slice(0, 4))).toEqual([60, 70, 80, 255])
    expect(Array.from(pixels.slice(4, 8))).toEqual([40, 50, 60, 255])
  })

  it('never pairs the previous page’s pixels with the newly selected page', async () => {
    const view = await importPages([
      imageFile('a.png', [10, 20, 30, 255]),
      imageFile('b.png', [200, 210, 220, 255]),
    ])
    const [a, b] = view.result.current.pages
    await act(async () => {
      await view.result.current.selectPage(a.id)
    })
    expect(Array.from(view.result.current.selectedImage!.data)).toEqual([10, 20, 30, 255])

    // Bへの切り替え中、デコードが終わるまで止める。この間にAの画素が
    // 残っていると、画面上はAの画像にBの調整値が当たったものが表示される。
    const resume = pauseDownscale()
    let switching: Promise<void>
    await act(async () => {
      switching = view.result.current.selectPage(b.id)
      await Promise.resolve()
    })

    expect(view.result.current.selectedPageId).toBe(b.id)
    expect(view.result.current.selectedImage).toBeNull()

    await act(async () => {
      resume()
      await switching
    })
    expect(view.result.current.selectedPageId).toBe(b.id)
    expect(Array.from(view.result.current.selectedImage!.data)).toEqual([200, 210, 220, 255])
  })

  it('updates the adjustment locally at once and defers the IndexedDB write', async () => {
    const view = await importPages([imageFile('a.png', [10, 20, 30, 255])])
    const pageId = view.result.current.pages[0].id

    await act(async () => {
      // スライダー操作3目盛分。書き込みは遅延されて3回ではなく1回になる。
      await view.result.current.updateAdjustment(pageId, { brightness: 10, contrast: 0 })
      await view.result.current.updateAdjustment(pageId, { brightness: 20, contrast: 0 })
      await view.result.current.updateAdjustment(pageId, { brightness: 30, contrast: 0 })
    })
    // ローカル状態は往復なしで即座に最新になる。
    expect(view.result.current.pages[0].adjustment).toEqual({ brightness: 30, contrast: 0 })

    // 遅延時間が経つ前に書き出しても、最新の値が反映されていること。
    await act(async () => {
      await view.result.current.exportBook('pdf')
    })
    const request = vi.mocked(runExportInWorker).mock.calls[0][0]
    expect(request.pages[0].adjustment).toEqual({ brightness: 30, contrast: 0 })
  })

  it('sends stored blobs, not decoded pixels, to the export worker', async () => {
    const view = await importPages([imageFile('a.png', [10, 20, 30, 255])])
    await act(async () => {
      await view.result.current.exportBook('pdf')
    })
    const request = vi.mocked(runExportInWorker).mock.calls[0][0]
    expect(request.format).toBe('pdf')
    expect(request.pages).toHaveLength(1)
    expect(request.pages[0].adjustment).toBeDefined()
    // Workerには保存済みblobが渡り、自前でデコードする。デコード済み画素は渡さない。
    expect(await decodeFake(request.pages[0].blob)).toEqual({
      data: Uint8ClampedArray.from([10, 20, 30, 255]),
      width: 1,
      height: 1,
    })
  })
})
