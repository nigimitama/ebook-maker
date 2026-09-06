import { describe, it, expect, beforeEach } from 'vitest'
import { ImageStore } from './imageStore'
import { Blob as NodeBlob } from 'node:buffer'

function blob(byte: number): Blob {
  return new NodeBlob([new Uint8Array([byte])], { type: 'image/png' }) as unknown as Blob
}

describe('ImageStore', () => {
  let store: ImageStore

  beforeEach(async () => {
    store = await ImageStore.open(`test-db-${Math.random()}`)
  })

  it('adds pages with increasing order and lists them sorted', async () => {
    const p1 = await store.addPage(blob(1), 10, 20)
    const p2 = await store.addPage(blob(2), 10, 20)
    expect(p2.order).toBeGreaterThan(p1.order)
    const pages = await store.listPages()
    expect(pages.map((p) => p.id)).toEqual([p1.id, p2.id])
  })

  it('stores and retrieves the original blob unchanged', async () => {
    const page = await store.addPage(blob(42), 5, 5)
    const stored = await store.getBlob(page.blobId)
    const bytes = new Uint8Array(await stored!.arrayBuffer())
    expect(Array.from(bytes)).toEqual([42])
  })

  it('updates adjustment params without touching the blob', async () => {
    const page = await store.addPage(blob(1), 5, 5)
    await store.updateAdjustment(page.id, { brightness: 10, contrast: -5 })
    const [updated] = await store.listPages()
    expect(updated.adjustment).toEqual({ brightness: 10, contrast: -5 })
    const stored = await store.getBlob(page.blobId)
    expect(stored).toBeDefined()
  })

  it('reorders pages', async () => {
    const p1 = await store.addPage(blob(1), 5, 5)
    const p2 = await store.addPage(blob(2), 5, 5)
    await store.reorderPages([p2.id, p1.id])
    const pages = await store.listPages()
    expect(pages.map((p) => p.id)).toEqual([p2.id, p1.id])
  })

  it('deletes a page and its blob', async () => {
    const page = await store.addPage(blob(1), 5, 5)
    await store.deletePage(page.id)
    expect(await store.listPages()).toEqual([])
    expect(await store.getBlob(page.blobId)).toBeUndefined()
  })

  it('replaces two pages with one merged page at the first page position', async () => {
    const p1 = await store.addPage(blob(1), 5, 5)
    const p2 = await store.addPage(blob(2), 5, 5)
    const p3 = await store.addPage(blob(3), 5, 5)
    const merged = await store.replacePagesWithMerged([p1.id, p2.id], blob(99), 10, 5)
    const pages = await store.listPages()
    expect(pages.map((p) => p.id)).toEqual([merged.id, p3.id])
    expect(pages[0].width).toBe(10)
  })

  it('stores a thumbnail alongside the original, under a separate key', async () => {
    const page = await store.addPage(blob(1), 5, 5, blob(7))
    expect(page.thumbBlobId).toBeDefined()
    expect(page.thumbBlobId).not.toBe(page.blobId)
    const thumb = await store.getBlob(page.thumbBlobId!)
    expect(Array.from(new Uint8Array(await thumb!.arrayBuffer()))).toEqual([7])
    const original = await store.getBlob(page.blobId)
    expect(Array.from(new Uint8Array(await original!.arrayBuffer()))).toEqual([1])
  })

  it('leaves thumbBlobId unset for a page added without a thumbnail', async () => {
    const page = await store.addPage(blob(1), 5, 5)
    expect(page.thumbBlobId).toBeUndefined()
  })

  it('backfills a thumbnail onto a page stored without one', async () => {
    const page = await store.addPage(blob(1), 5, 5)
    const thumbBlobId = await store.setThumbnail(page.id, blob(8))
    const [updated] = await store.listPages()
    expect(updated.thumbBlobId).toBe(thumbBlobId)
    const thumb = await store.getBlob(thumbBlobId)
    expect(Array.from(new Uint8Array(await thumb!.arrayBuffer()))).toEqual([8])
  })

  it('deletes the thumbnail along with the page and its original', async () => {
    const page = await store.addPage(blob(1), 5, 5, blob(7))
    await store.deletePage(page.id)
    expect(await store.getBlob(page.blobId)).toBeUndefined()
    expect(await store.getBlob(page.thumbBlobId!)).toBeUndefined()
  })

  it('deletes both source thumbnails when merging and stores the merged one', async () => {
    const p1 = await store.addPage(blob(1), 5, 5, blob(11))
    const p2 = await store.addPage(blob(2), 5, 5, blob(12))
    const merged = await store.replacePagesWithMerged([p1.id, p2.id], blob(99), 10, 5, blob(13))
    expect(await store.getBlob(p1.thumbBlobId!)).toBeUndefined()
    expect(await store.getBlob(p2.thumbBlobId!)).toBeUndefined()
    const thumb = await store.getBlob(merged.thumbBlobId!)
    expect(Array.from(new Uint8Array(await thumb!.arrayBuffer()))).toEqual([13])
  })
})
