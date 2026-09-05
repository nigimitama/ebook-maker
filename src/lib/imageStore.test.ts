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
})
