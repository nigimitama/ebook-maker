import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageStore } from '../lib/imageStore'
import { decodeBlobToRawImage } from '../lib/decodeImage'
import { encodeRawImageToPng } from '../lib/encodeImage'
import { computeAutoAdjustment } from '../lib/autoAdjust'
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
}

// Decoded RGBA pixels are huge (~15MB for one A4 scan), so at the spec's
// 200-page scale they cannot all be held at once. Keep only a handful of
// recently used pages; anything else is re-decoded from its stored Blob on
// demand. Map iteration order is insertion order, so delete-then-set on
// access gives cheap LRU semantics with the oldest entry first.
const RAW_IMAGE_CACHE_LIMIT = 4

export function useBook(): UseBookResult {
  const storeRef = useRef<ImageStore | null>(null)
  const rawImagesRef = useRef<Map<string, RawImage>>(new Map())
  const selectedPageIdRef = useRef<string | null>(null)
  const [pages, setPages] = useState<PageEntry[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [metadata, setMetadata] = useState<BookMetadata>({ title: '', author: '' })
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<RawImage | null>(null)

  useEffect(() => {
    let cancelled = false
    ImageStore.open().then((store) => {
      if (cancelled) {
        store.close()
        return
      }
      storeRef.current = store
      store.listPages().then(setPages)
    })
    return () => {
      cancelled = true
      storeRef.current?.close()
    }
  }, [])

  const refreshPages = useCallback(async () => {
    const store = storeRef.current
    if (!store) return
    setPages(await store.listPages())
  }, [])

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

  const importFiles = useCallback(
    async (files: File[]) => {
      const store = storeRef.current
      if (!store) return
      // Decoded pixels are deliberately NOT cached for every imported file —
      // only the first page, which is about to be shown in the editor.
      let firstNew: { id: string; raw: RawImage } | null = null
      for (const file of files) {
        const raw = await decodeBlobToRawImage(file)
        const page = await store.addPage(file, raw.width, raw.height)
        const auto = computeAutoAdjustment(raw)
        await store.updateAdjustment(page.id, auto)
        setThumbnails((current) => ({ ...current, [page.id]: URL.createObjectURL(file) }))
        if (!firstNew) firstNew = { id: page.id, raw }
      }
      await refreshPages()
      if (firstNew && !selectedPageId) {
        setSelected(firstNew.id)
        cacheRawImage(firstNew.id, firstNew.raw)
        setSelectedImage(firstNew.raw)
      }
    },
    [refreshPages, selectedPageId, setSelected, cacheRawImage],
  )

  const selectPage = useCallback(
    async (id: string) => {
      const page = pages.find((p) => p.id === id)
      if (!page) return
      setSelected(id)
      setSelectedImage(await ensureRawImage(page))
    },
    [pages, ensureRawImage, setSelected],
  )

  const updateAdjustment = useCallback(
    async (id: string, adjustment: AdjustmentParams) => {
      const store = storeRef.current
      if (!store) return
      await store.updateAdjustment(id, adjustment)
      await refreshPages()
    },
    [refreshPages],
  )

  const applyAdjustmentToAllPages = useCallback(
    async (sourceId: string) => {
      const store = storeRef.current
      if (!store) return
      const source = pages.find((p) => p.id === sourceId)
      if (!source) return
      for (const page of pages) {
        if (page.id === sourceId) continue
        await store.updateAdjustment(page.id, source.adjustment)
      }
      await refreshPages()
    },
    [pages, refreshPages],
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
    [refreshPages, selectedPageId, setSelected],
  )

  const confirmMerge = useCallback(
    async (firstId: string, secondId: string) => {
      const store = storeRef.current
      if (!store) return
      const first = pages.find((p) => p.id === firstId)
      const second = pages.find((p) => p.id === secondId)
      if (!first || !second) return
      const rawFirst = await ensureRawImage(first)
      const rawSecond = await ensureRawImage(second)
      const merged = mergeSpread(rawFirst, rawSecond)
      const blob = await encodeRawImageToPng(merged)
      const mergedEntry = await store.replacePagesWithMerged(
        [firstId, secondId],
        blob,
        merged.width,
        merged.height,
      )
      rawImagesRef.current.delete(firstId)
      rawImagesRef.current.delete(secondId)
      cacheRawImage(mergedEntry.id, merged)
      setThumbnails((current) => {
        const next = { ...current }
        if (next[firstId]) URL.revokeObjectURL(next[firstId])
        if (next[secondId]) URL.revokeObjectURL(next[secondId])
        delete next[firstId]
        delete next[secondId]
        next[mergedEntry.id] = URL.createObjectURL(blob)
        return next
      })
      if (selectedPageId === firstId || selectedPageId === secondId) {
        setSelected(mergedEntry.id)
        setSelectedImage(merged)
      }
      await refreshPages()
    },
    [pages, refreshPages, selectedPageId, ensureRawImage, cacheRawImage, setSelected],
  )

  const exportBook = useCallback(
    async (format: 'pdf' | 'epub') => {
      const store = storeRef.current
      if (!store) throw new Error('store not ready')
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
    [metadata],
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
  }
}
