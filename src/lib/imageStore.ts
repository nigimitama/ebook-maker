import type { AdjustmentParams, PageEntry } from '../types'
import { DEFAULT_ADJUSTMENT } from '../types'

const BLOB_STORE = 'blobs'
const PAGE_STORE = 'pages'

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE)
      }
      if (!db.objectStoreNames.contains(PAGE_STORE)) {
        db.createObjectStore(PAGE_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`
}

export class ImageStore {
  private db: IDBDatabase

  private constructor(db: IDBDatabase) {
    this.db = db
  }

  static async open(dbName = 'ebook-maker'): Promise<ImageStore> {
    const db = await openDb(dbName)
    return new ImageStore(db)
  }

  close(): void {
    this.db.close()
  }

  async addPage(
    blob: Blob,
    width: number,
    height: number,
    thumbBlob?: Blob,
  ): Promise<PageEntry> {
    const pages = await this.listPages()
    const maxOrder = pages.reduce((max, p) => Math.max(max, p.order), -1)
    const page: PageEntry = {
      id: nextId(),
      order: maxOrder + 1,
      blobId: nextId(),
      ...(thumbBlob ? { thumbBlobId: nextId() } : {}),
      width,
      height,
      adjustment: { ...DEFAULT_ADJUSTMENT },
    }
    const tx = this.db.transaction([BLOB_STORE, PAGE_STORE], 'readwrite')
    const blobStore = tx.objectStore(BLOB_STORE)
    blobStore.put(blob, page.blobId)
    if (thumbBlob && page.thumbBlobId) blobStore.put(thumbBlob, page.thumbBlobId)
    tx.objectStore(PAGE_STORE).put(page)
    await txDone(tx)
    return page
  }

  /** サムネイル導入前に保存されたページにサムネイルを付ける。 */
  async setThumbnail(id: string, thumbBlob: Blob): Promise<string> {
    const tx = this.db.transaction([BLOB_STORE, PAGE_STORE], 'readwrite')
    const pageStore = tx.objectStore(PAGE_STORE)
    const page = (await reqToPromise(pageStore.get(id))) as PageEntry | undefined
    if (!page) throw new Error(`page not found: ${id}`)
    const thumbBlobId = page.thumbBlobId ?? nextId()
    tx.objectStore(BLOB_STORE).put(thumbBlob, thumbBlobId)
    pageStore.put({ ...page, thumbBlobId })
    await txDone(tx)
    return thumbBlobId
  }

  async listPages(): Promise<PageEntry[]> {
    const tx = this.db.transaction(PAGE_STORE, 'readonly')
    const all = await reqToPromise(tx.objectStore(PAGE_STORE).getAll())
    return (all as PageEntry[]).slice().sort((a, b) => a.order - b.order)
  }

  async getBlob(blobId: string): Promise<Blob | undefined> {
    const tx = this.db.transaction(BLOB_STORE, 'readonly')
    return reqToPromise(tx.objectStore(BLOB_STORE).get(blobId)) as Promise<Blob | undefined>
  }

  async updateAdjustment(id: string, adjustment: AdjustmentParams): Promise<void> {
    const tx = this.db.transaction(PAGE_STORE, 'readwrite')
    const store = tx.objectStore(PAGE_STORE)
    const page = (await reqToPromise(store.get(id))) as PageEntry | undefined
    if (!page) throw new Error(`page not found: ${id}`)
    store.put({ ...page, adjustment })
    await txDone(tx)
  }

  async reorderPages(orderedIds: string[]): Promise<void> {
    const tx = this.db.transaction(PAGE_STORE, 'readwrite')
    const store = tx.objectStore(PAGE_STORE)
    for (let i = 0; i < orderedIds.length; i += 1) {
      const page = (await reqToPromise(store.get(orderedIds[i]))) as PageEntry | undefined
      if (!page) throw new Error(`page not found: ${orderedIds[i]}`)
      store.put({ ...page, order: i })
    }
    await txDone(tx)
  }

  async deletePage(id: string): Promise<void> {
    const tx = this.db.transaction([BLOB_STORE, PAGE_STORE], 'readwrite')
    const pageStore = tx.objectStore(PAGE_STORE)
    const page = (await reqToPromise(pageStore.get(id))) as PageEntry | undefined
    if (!page) throw new Error(`page not found: ${id}`)
    pageStore.delete(id)
    const blobStore = tx.objectStore(BLOB_STORE)
    blobStore.delete(page.blobId)
    if (page.thumbBlobId) blobStore.delete(page.thumbBlobId)
    await txDone(tx)
  }

  async clearAll(): Promise<void> {
    const tx = this.db.transaction([BLOB_STORE, PAGE_STORE], 'readwrite')
    tx.objectStore(PAGE_STORE).clear()
    tx.objectStore(BLOB_STORE).clear()
    await txDone(tx)
  }

  async replacePagesWithMerged(
    removeIds: [string, string],
    blob: Blob,
    width: number,
    height: number,
    thumbBlob?: Blob,
  ): Promise<PageEntry> {
    const pages = await this.listPages()
    const [firstId] = removeIds
    const firstIndex = pages.findIndex((p) => p.id === firstId)
    if (firstIndex === -1) throw new Error(`page not found: ${firstId}`)
    const removed = new Set(removeIds)
    const merged: PageEntry = {
      id: nextId(),
      order: pages[firstIndex].order,
      blobId: nextId(),
      ...(thumbBlob ? { thumbBlobId: nextId() } : {}),
      width,
      height,
      adjustment: { ...DEFAULT_ADJUSTMENT },
    }
    const remaining = pages.filter((p) => !removed.has(p.id))
    const insertAt = remaining.filter((p) => p.order < pages[firstIndex].order).length
    remaining.splice(insertAt, 0, merged)
    const tx = this.db.transaction([BLOB_STORE, PAGE_STORE], 'readwrite')
    const blobStore = tx.objectStore(BLOB_STORE)
    const pageStore = tx.objectStore(PAGE_STORE)
    for (const id of removeIds) {
      const p = pages.find((page) => page.id === id)
      if (!p) throw new Error(`page not found: ${id}`)
      pageStore.delete(id)
      blobStore.delete(p.blobId)
      if (p.thumbBlobId) blobStore.delete(p.thumbBlobId)
    }
    blobStore.put(blob, merged.blobId)
    if (thumbBlob && merged.thumbBlobId) blobStore.put(thumbBlob, merged.thumbBlobId)
    remaining.forEach((p, i) => pageStore.put({ ...p, order: i }))
    await txDone(tx)
    return merged
  }
}
