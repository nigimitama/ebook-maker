import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageStore } from '../lib/imageStore'
import { decodeBlobToRawImage } from '../lib/decodeImage'
import { encodeRawImageToPng } from '../lib/encodeImage'
import { computeAutoAdjustment } from '../lib/autoAdjust'
import { mergeSpread } from '../lib/mergeSpread'
import { runExportInWorker } from '../lib/exportRunner'
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

export function useBook(): UseBookResult {
  const storeRef = useRef<ImageStore | null>(null)
  const rawImagesRef = useRef<Map<string, RawImage>>(new Map())
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

  const ensureRawImage = useCallback(async (page: PageEntry): Promise<RawImage> => {
    const cached = rawImagesRef.current.get(page.id)
    if (cached) return cached
    const store = storeRef.current!
    const blob = await store.getBlob(page.blobId)
    const raw = await decodeBlobToRawImage(blob!)
    rawImagesRef.current.set(page.id, raw)
    return raw
  }, [])

  const importFiles = useCallback(
    async (files: File[]) => {
      const store = storeRef.current
      if (!store) return
      let firstNewId: string | null = null
      for (const file of files) {
        const raw = await decodeBlobToRawImage(file)
        const page = await store.addPage(file, raw.width, raw.height)
        rawImagesRef.current.set(page.id, raw)
        const auto = computeAutoAdjustment(raw)
        await store.updateAdjustment(page.id, auto)
        setThumbnails((current) => ({ ...current, [page.id]: URL.createObjectURL(file) }))
        if (!firstNewId) firstNewId = page.id
      }
      await refreshPages()
      if (firstNewId && !selectedPageId) {
        setSelectedPageId(firstNewId)
        setSelectedImage(rawImagesRef.current.get(firstNewId) ?? null)
      }
    },
    [refreshPages, selectedPageId],
  )

  const selectPage = useCallback(
    async (id: string) => {
      const page = pages.find((p) => p.id === id)
      if (!page) return
      setSelectedPageId(id)
      setSelectedImage(await ensureRawImage(page))
    },
    [pages, ensureRawImage],
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
        setSelectedPageId(null)
        setSelectedImage(null)
      }
      await refreshPages()
    },
    [refreshPages, selectedPageId],
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
      rawImagesRef.current.set(mergedEntry.id, merged)
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
        setSelectedPageId(mergedEntry.id)
        setSelectedImage(merged)
      }
      await refreshPages()
    },
    [pages, refreshPages, selectedPageId, ensureRawImage],
  )

  const exportBook = useCallback(
    async (format: 'pdf' | 'epub') => {
      const store = storeRef.current
      if (!store) throw new Error('store not ready')
      const currentPages = await store.listPages()
      const exportPages = []
      for (const page of currentPages) {
        const raw = await ensureRawImage(page)
        exportPages.push({ image: raw, adjustment: page.adjustment })
      }
      return runExportInWorker({ format, metadata, pages: exportPages })
    },
    [metadata, ensureRawImage],
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
