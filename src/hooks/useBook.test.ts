import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import type { RawImage } from '../types'

// fake-indexeddb structured-clones values through Node's implementation, which
// preserves a node:buffer Blob but flattens a jsdom one into a plain object
// (imageStore.test.ts uses node:buffer for the same reason). jsdom's
// URL.createObjectURL accepts both.
function blobOf(text: string, type: string): Blob {
  return new NodeBlob([text], { type }) as unknown as Blob
}

// The three browser-only dependencies useBook imports need a canvas
// (createImageBitmap / getImageData / toBlob) and a real Worker, none of
// which jsdom provides. Fake them with a trivial round-trippable "image
// format" — JSON holding width, height and the RGBA bytes — so imports,
// merges and exports can be driven end-to-end against a real ImageStore
// backed by fake-indexeddb, and the resulting pixels can be asserted on.
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

vi.mock('../lib/decodeImage', () => ({
  decodeBlobToRawImage: (blob: Blob) => decodeFake(blob),
}))
vi.mock('../lib/encodeImage', () => ({
  encodeRawImageToPng: async (image: RawImage) => encodeFake(image),
}))
vi.mock('../lib/exportRunner', () => ({
  runExportInWorker: vi.fn(async () => blobOf('pdf', 'application/pdf')),
}))

const { useBook } = await import('./useBook')
const { runExportInWorker } = await import('../lib/exportRunner')

/** A 1x1 image file whose decoded pixel is exactly `pixel`. */
function imageFile(name: string, pixel: [number, number, number, number]): File {
  const payload: FakeImageFile = { w: 1, h: 1, data: pixel }
  return new NodeFile([JSON.stringify(payload)], name, { type: 'image/png' }) as unknown as File
}

/** A file the fake decoder cannot parse — stands in for a corrupt scan. */
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

    // A fresh mount is what a page reload does: the same database, no
    // in-memory state carried over.
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
    // The merged page carries no further adjustment: it is already baked in.
    expect(merged.adjustment).toEqual({ brightness: 0, contrast: 0 })
    expect(view.result.current.selectedImage).not.toBeNull()

    // Left half brightened by 50, right half untouched.
    const pixels = view.result.current.selectedImage!.data
    expect(Array.from(pixels.slice(0, 4))).toEqual([60, 70, 80, 255])
    expect(Array.from(pixels.slice(4, 8))).toEqual([40, 50, 60, 255])
  })

  it('updates the adjustment locally at once and defers the IndexedDB write', async () => {
    const view = await importPages([imageFile('a.png', [10, 20, 30, 255])])
    const pageId = view.result.current.pages[0].id

    await act(async () => {
      // Three ticks of a slider drag: one debounced write, not three.
      await view.result.current.updateAdjustment(pageId, { brightness: 10, contrast: 0 })
      await view.result.current.updateAdjustment(pageId, { brightness: 20, contrast: 0 })
      await view.result.current.updateAdjustment(pageId, { brightness: 30, contrast: 0 })
    })
    // Local state is current immediately, with no round-trip.
    expect(view.result.current.pages[0].adjustment).toEqual({ brightness: 30, contrast: 0 })

    // Exporting before the debounce elapses must still see the latest value.
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
    // The worker gets the stored blob to decode itself, never decoded pixels.
    expect(await decodeFake(request.pages[0].blob)).toEqual({
      data: Uint8ClampedArray.from([10, 20, 30, 255]),
      width: 1,
      height: 1,
    })
  })
})
