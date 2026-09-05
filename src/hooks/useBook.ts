import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageStore } from '../lib/imageStore'
import { decodeBlobToRawImage } from '../lib/decodeImage'
import { downscale } from '../lib/downscaleImage'
import { PREVIEW_MAX_EDGE, THUMBNAIL_MAX_EDGE } from '../lib/previewSizes'
import { encodeRawImageToPng } from '../lib/encodeImage'
import { computeAutoAdjustment } from '../lib/autoAdjust'
import { applyAdjustment } from '../lib/applyAdjustment'
import { mergeSpread } from '../lib/mergeSpread'
import { runExportInWorker } from '../lib/exportRunner'
import type { ExportRequestPage } from '../workers/exportCore'
import type { AdjustmentParams, BookMetadata, PageEntry, RawImage } from '../types'

export interface UseBookResult {
  pages: PageEntry[]
  thumbnails: Record<string, string>
  metadata: BookMetadata
  selectedPageId: string | null
  selectedImage: RawImage | null
  importFiles: (files: File[]) => Promise<void>
  selectPage: (id: string) => Promise<void>
  updateAdjustment: (id: string, adjustment: AdjustmentParams) => Promise<void>
  applyAdjustmentToAllPages: (sourceId: string) => Promise<void>
  reorderPages: (orderedIds: string[]) => Promise<void>
  deletePage: (id: string) => Promise<void>
  confirmMerge: (firstId: string, secondId: string) => Promise<void>
  setMetadata: (metadata: BookMetadata) => void
  exportBook: (format: 'pdf' | 'epub') => Promise<Blob>
  error: string | null
  clearError: () => void
}

function isQuotaExceeded(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'QuotaExceededError'
  )
}

// Decoded RGBA pixels are huge (~15MB for one A4 scan), so at the spec's
// 200-page scale they cannot all be held at once. Keep only a handful of
// recently used pages; anything else is re-decoded from its stored Blob on
// demand. Map iteration order is insertion order, so delete-then-set on
// access gives cheap LRU semantics with the oldest entry first.
const RAW_IMAGE_CACHE_LIMIT = 4

// Quiet period after the last slider tick before the adjustment is written.
const ADJUSTMENT_WRITE_DEBOUNCE_MS = 250

export function useBook(): UseBookResult {
  const storeRef = useRef<ImageStore | null>(null)
  const storeOpeningRef = useRef<Promise<ImageStore> | null>(null)
  const rawImagesRef = useRef<Map<string, RawImage>>(new Map())
  const selectedPageIdRef = useRef<string | null>(null)
  const pendingAdjustmentsRef = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; adjustment: AdjustmentParams }>
  >(new Map())
  const [pages, setPages] = useState<PageEntry[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [metadata, setMetadata] = useState<BookMetadata>({ title: '', author: '' })
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<RawImage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  // Declared before the store-open effect so its cleanup runs first: React
  // runs effect cleanups in declaration order, and these writes need the
  // connection still open.
  useEffect(() => {
    const pending = pendingAdjustmentsRef.current
    return () => {
      const store = storeRef.current
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer)
        // ImageStore.updateAdjustment opens its transaction synchronously, so
        // it is started before the connection close below is requested.
        if (store) void store.updateAdjustment(id, entry.adjustment).catch(() => {})
      }
      pending.clear()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const opening = ImageStore.open()
    storeOpeningRef.current = opening
    opening
      .then(async (store) => {
        if (cancelled) return
        storeRef.current = store
        const loaded = await store.listPages()
        // Object URLs live only for the lifetime of a document, so after a
        // reload the pages restored from IndexedDB have no thumbnail unless
        // we mint one here — otherwise every <img> renders broken.
        const restored: Record<string, string> = {}
        for (const page of loaded) {
          // Pages stored before thumbnails existed have none; build and keep
          // one now so this load is the only slow one for them.
          let thumbBlobId = page.thumbBlobId
          if (!thumbBlobId) {
            const original = await store.getBlob(page.blobId)
            if (!original) continue
            const thumb = await downscale(original, THUMBNAIL_MAX_EDGE)
            thumbBlobId = await store.setThumbnail(page.id, await thumb.toBlob())
            page.thumbBlobId = thumbBlobId
          }
          const blob = await store.getBlob(thumbBlobId)
          if (blob) restored[page.id] = URL.createObjectURL(blob)
        }
        if (cancelled) {
          for (const url of Object.values(restored)) URL.revokeObjectURL(url)
          return
        }
        // Merge rather than replace: an import can complete while this effect
        // is still awaiting listPages/getBlob, and replacing would wipe (and
        // leak) the thumbnail it just created.
        setThumbnails((current) => ({ ...restored, ...current }))
        setPages(loaded)
      })
      .catch(() => {
        if (!cancelled) {
          setError('このブラウザは対応していません(IndexedDBが利用できません)')
        }
      })
    return () => {
      cancelled = true
      opening.then((store) => store.close()).catch(() => {})
    }
  }, [])

  // Actions can fire before IndexedDB finishes opening (a user dropping files
  // onto a freshly loaded page); await the open instead of silently no-oping.
  const getStore = useCallback(async (): Promise<ImageStore | null> => {
    if (storeRef.current) return storeRef.current
    try {
      return (await storeOpeningRef.current) ?? null
    } catch {
      return null
    }
  }, [])

  // Write out any debounced adjustment immediately. Anything that reads pages
  // back from IndexedDB must do this first, or it would overwrite the
  // optimistic local state with a stale row.
  const flushPendingAdjustments = useCallback(async () => {
    const pending = pendingAdjustmentsRef.current
    if (pending.size === 0) return
    const entries = Array.from(pending)
    pending.clear()
    const store = storeRef.current
    for (const [id, entry] of entries) {
      clearTimeout(entry.timer)
      // The row can be gone (deleted, or merged into a spread) between the
      // slider tick and the flush; that write simply has nothing to update.
      if (store) await store.updateAdjustment(id, entry.adjustment).catch(() => {})
    }
  }, [])

  // Drop a debounced write for a page that no longer exists.
  const cancelPendingAdjustment = useCallback((id: string) => {
    const entry = pendingAdjustmentsRef.current.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    pendingAdjustmentsRef.current.delete(id)
  }, [])

  const refreshPages = useCallback(async () => {
    const store = storeRef.current
    if (!store) return
    await flushPendingAdjustments()
    setPages(await store.listPages())
  }, [flushPendingAdjustments])

  const setSelected = useCallback((id: string | null) => {
    selectedPageIdRef.current = id
    setSelectedPageId(id)
  }, [])

  // Insert (or refresh) an entry as most-recently-used, then evict the
  // oldest entries that are neither the selected page nor the one just used.
  const cacheRawImage = useCallback((id: string, raw: RawImage) => {
    const cache = rawImagesRef.current
    cache.delete(id)
    cache.set(id, raw)
    while (cache.size > RAW_IMAGE_CACHE_LIMIT) {
      let victim: string | undefined
      for (const key of cache.keys()) {
        if (key !== id && key !== selectedPageIdRef.current) {
          victim = key
          break
        }
      }
      if (victim === undefined) break
      cache.delete(victim)
    }
  }, [])

  const ensureRawImage = useCallback(
    async (page: PageEntry): Promise<RawImage> => {
      const cached = rawImagesRef.current.get(page.id)
      if (cached) {
        cacheRawImage(page.id, cached)
        return cached
      }
      const store = storeRef.current
      if (!store) throw new Error('store not ready')
      const blob = await store.getBlob(page.blobId)
      if (!blob) throw new Error(`image data not found for page: ${page.id}`)
      const raw = await decodeBlobToRawImage(blob)
      cacheRawImage(page.id, raw)
      return raw
    },
    [cacheRawImage],
  )

  // Selects a page and paints it into the editor at preview resolution. The
  // canvas is only a few hundred px wide, so decoding the original in full
  // would cost ~65x the pixels actually shown — and every slider tick then
  // re-runs applyAdjustment over all of them. Merging and exporting still use
  // the original via ensureRawImage / the worker.
  const showPreview = useCallback(
    async (id: string, store: ImageStore) => {
      setSelected(id)
      const pages = await store.listPages()
      const page = pages.find((p) => p.id === id)
      if (!page) return
      const blob = await store.getBlob(page.blobId)
      if (!blob) return
      const preview = await downscale(blob, PREVIEW_MAX_EDGE)
      if (selectedPageIdRef.current !== id) return
      setSelectedImage(preview.image)
    },
    [setSelected],
  )

  const importFiles = useCallback(
    async (files: File[]) => {
      const store = await getStore()
      if (!store) return
      let firstNewId: string | null = null
      // One unreadable or unsupported file must not abort the whole import:
      // skip it, keep going, and report the names afterwards (spec §エラーハンドリング).
      const failedNames: string[] = []
      let quotaExceeded = false
      for (const file of files) {
        try {
          // The original is never decoded at full resolution here. The
          // thumbnail-sized pixels carry enough of the histogram for auto
          // adjustment, and `downscale` reports the original dimensions the
          // exported page needs.
          const thumb = await downscale(file, THUMBNAIL_MAX_EDGE)
          const page = await store.addPage(
            file,
            thumb.originalWidth,
            thumb.originalHeight,
            await thumb.toBlob(),
          )
          const auto = computeAutoAdjustment(thumb.image)
          await store.updateAdjustment(page.id, auto)
          const thumbBlob = page.thumbBlobId ? await store.getBlob(page.thumbBlobId) : undefined
          if (thumbBlob) {
            setThumbnails((current) => ({ ...current, [page.id]: URL.createObjectURL(thumbBlob) }))
          }
          if (!firstNewId) firstNewId = page.id
        } catch (fileError) {
          if (isQuotaExceeded(fileError)) quotaExceeded = true
          failedNames.push(file.name)
        }
      }
      if (failedNames.length > 0) {
        setError(
          quotaExceeded
            ? `保存容量が不足しています。不要なページを削除してください: ${failedNames.join(', ')}`
            : `読み込みに失敗しました: ${failedNames.join(', ')}`,
        )
      } else {
        setError(null)
      }
      await refreshPages()
      if (firstNewId && !selectedPageId) {
        await showPreview(firstNewId, store)
      }
    },
    [refreshPages, selectedPageId, showPreview, getStore],
  )

  const selectPage = useCallback(
    async (id: string) => {
      const store = await getStore()
      if (!store) return
      await showPreview(id, store)
    },
    [showPreview, getStore],
  )

  // Every slider tick calls this. Update local state at once so the canvas
  // redraws with no IndexedDB round-trip in the critical path, and debounce
  // the write itself — the spec asks for persistence on commit, not on every
  // input event. The old code wrote and then re-listed the whole page table
  // per tick, which locks the UI on a real scan.
  const updateAdjustment = useCallback(async (id: string, adjustment: AdjustmentParams) => {
    setPages((current) => current.map((p) => (p.id === id ? { ...p, adjustment } : p)))
    const pending = pendingAdjustmentsRef.current
    const existing = pending.get(id)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      const entry = pending.get(id)
      pending.delete(id)
      const store = storeRef.current
      if (!store || !entry) return
      void store.updateAdjustment(id, entry.adjustment).catch(() => {})
    }, ADJUSTMENT_WRITE_DEBOUNCE_MS)
    pending.set(id, { timer, adjustment })
  }, [])

  const applyAdjustmentToAllPages = useCallback(
    async (sourceId: string) => {
      const store = storeRef.current
      if (!store) return
      await flushPendingAdjustments()
      const source = pages.find((p) => p.id === sourceId)
      if (!source) return
      for (const page of pages) {
        if (page.id === sourceId) continue
        await store.updateAdjustment(page.id, source.adjustment)
      }
      await refreshPages()
    },
    [pages, refreshPages, flushPendingAdjustments],
  )

  const reorderPages = useCallback(
    async (orderedIds: string[]) => {
      const store = storeRef.current
      if (!store) return
      await store.reorderPages(orderedIds)
      await refreshPages()
    },
    [refreshPages],
  )

  const deletePage = useCallback(
    async (id: string) => {
      const store = storeRef.current
      if (!store) return
      cancelPendingAdjustment(id)
      await store.deletePage(id)
      rawImagesRef.current.delete(id)
      setThumbnails((current) => {
        const next = { ...current }
        if (next[id]) URL.revokeObjectURL(next[id])
        delete next[id]
        return next
      })
      if (selectedPageId === id) {
        setSelected(null)
        setSelectedImage(null)
      }
      await refreshPages()
    },
    [refreshPages, selectedPageId, setSelected, cancelPendingAdjustment],
  )

  const confirmMerge = useCallback(
    async (firstId: string, secondId: string) => {
      const store = storeRef.current
      if (!store) return
      const first = pages.find((p) => p.id === firstId)
      const second = pages.find((p) => p.id === secondId)
      if (!first || !second) return
      // Bake each source page's own brightness/contrast into the merged
      // pixels — the originals are deleted by the merge, so an unadjusted
      // merge would silently discard whatever the user had dialled in. The
      // merged entry's own adjustment then correctly starts at 0/0.
      const rawFirst = applyAdjustment(await ensureRawImage(first), first.adjustment)
      const rawSecond = applyAdjustment(await ensureRawImage(second), second.adjustment)
      const merged = mergeSpread(rawFirst, rawSecond)
      const blob = await encodeRawImageToPng(merged)
      const mergedThumb = await downscale(blob, THUMBNAIL_MAX_EDGE)
      const mergedThumbBlob = await mergedThumb.toBlob()
      const mergedEntry = await store.replacePagesWithMerged(
        [firstId, secondId],
        blob,
        merged.width,
        merged.height,
        mergedThumbBlob,
      )
      // The source pages are gone now; their debounced writes have no target.
      cancelPendingAdjustment(firstId)
      cancelPendingAdjustment(secondId)
      rawImagesRef.current.delete(firstId)
      rawImagesRef.current.delete(secondId)
      cacheRawImage(mergedEntry.id, merged)
      setThumbnails((current) => {
        const next = { ...current }
        if (next[firstId]) URL.revokeObjectURL(next[firstId])
        if (next[secondId]) URL.revokeObjectURL(next[secondId])
        delete next[firstId]
        delete next[secondId]
        next[mergedEntry.id] = URL.createObjectURL(mergedThumbBlob)
        return next
      })
      if (selectedPageId === firstId || selectedPageId === secondId) {
        setSelected(mergedEntry.id)
        setSelectedImage((await downscale(blob, PREVIEW_MAX_EDGE)).image)
      }
      await refreshPages()
    },
    [
      pages,
      refreshPages,
      selectedPageId,
      ensureRawImage,
      cacheRawImage,
      setSelected,
      cancelPendingAdjustment,
    ],
  )

  const exportBook = useCallback(
    async (format: 'pdf' | 'epub') => {
      const store = storeRef.current
      if (!store) throw new Error('store not ready')
      // An export fired straight after a slider drag must not miss the last
      // adjustment still sitting in the debounce window.
      await flushPendingAdjustments()
      // Send the stored Blobs, not decoded pixels: the worker decodes each
      // page itself, so nothing here holds a full book's RGBA data at once.
      const currentPages = await store.listPages()
      const exportPages: ExportRequestPage[] = []
      for (const page of currentPages) {
        const blob = await store.getBlob(page.blobId)
        if (!blob) throw new Error(`image data not found for page: ${page.id}`)
        exportPages.push({ blob, adjustment: page.adjustment })
      }
      return runExportInWorker({ format, metadata, pages: exportPages })
    },
    [metadata, flushPendingAdjustments],
  )

  return {
    pages,
    thumbnails,
    metadata,
    selectedPageId,
    selectedImage,
    importFiles,
    selectPage,
    updateAdjustment,
    applyAdjustmentToAllPages,
    reorderPages,
    deletePage,
    confirmMerge,
    setMetadata,
    exportBook,
    error,
    clearError,
  }
}
