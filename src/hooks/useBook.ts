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
  applyResizeToAllPages: (sourceId: string) => Promise<void>
  applyQualityToAllPages: (sourceId: string) => Promise<void>
  applyToneToAllPages: (sourceId: string) => Promise<void>
  autoAdjustAllPages: () => Promise<void>
  reorderPages: (orderedIds: string[]) => Promise<void>
  deletePage: (id: string) => Promise<void>
  clearAllPages: () => Promise<void>
  confirmMerge: (firstId: string, secondId: string) => Promise<void>
  setMetadata: (metadata: BookMetadata) => void
  exportBook: (format: 'pdf' | 'epub', onProgress?: (done: number, total: number) => void) => Promise<Blob>
  importProgress: { done: number; total: number } | null
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

// デコード済みのRGBA画素は巨大(A4スキャン1枚で約15MB)なので、仕様上の
// 200ページ規模では全部を同時に保持できない。直近数ページ分だけ残し、
// それ以外は必要になった時点で保存済みBlobから再デコードする。
// Mapの反復順は挿入順なので、アクセス時にdelete→setすることで
// 最古のエントリが先頭に来る簡易LRUになる。
const RAW_IMAGE_CACHE_LIMIT = 4

// スライダー操作が止まってから調整値を書き込むまでの待機時間。
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
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  // ストアを開くeffectより前に宣言することでクリーンアップを先に走らせる。
  // Reactはeffectのクリーンアップを宣言順に実行するため、この書き込みは
  // 接続が開いたままの状態で行える。
  useEffect(() => {
    const pending = pendingAdjustmentsRef.current
    return () => {
      const store = storeRef.current
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer)
        // ImageStore.updateAdjustment はトランザクションを同期的に開くので、
        // 下の接続クローズが要求される前に開始される。
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
        // Object URLはドキュメントの生存期間しか有効でないため、リロード後に
        // IndexedDBから復元したページはここで作り直さないとサムネイルを持たず、
        // すべての<img>が壊れた表示になる。
        const restored: Record<string, string> = {}
        for (const page of loaded) {
          // サムネイル導入前に保存されたページは持っていないので、ここで生成して
          // 保存する。遅いのはこの初回読み込みだけで済む。
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
        // 置き換えではなくマージする: このeffectが listPages/getBlob を待っている間に
        // 読み込みが完了することがあり、置き換えると直前に作られたサムネイルを
        // 消して(かつリークさせて)しまう。
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

  // IndexedDBが開き終わる前に操作が発生しうる(読み込み直後のページに
  // ファイルをドロップした場合など)。黙って何もしないのではなく、開くのを待つ。
  const getStore = useCallback(async (): Promise<ImageStore | null> => {
    if (storeRef.current) return storeRef.current
    try {
      return (await storeOpeningRef.current) ?? null
    } catch {
      return null
    }
  }, [])

  // 遅延中の調整値を即座に書き出す。IndexedDBからページを読み直す処理は
  // 必ず先にこれを呼ぶこと。さもないと古い行で楽観的更新済みのローカル状態を
  // 上書きしてしまう。
  const flushPendingAdjustments = useCallback(async () => {
    const pending = pendingAdjustmentsRef.current
    if (pending.size === 0) return
    const entries = Array.from(pending)
    pending.clear()
    const store = storeRef.current
    for (const [id, entry] of entries) {
      clearTimeout(entry.timer)
      // スライダー操作からフラッシュまでの間に行が消えている場合がある
      // (削除、または見開きへの結合)。その場合は更新対象がないだけ。
      if (store) await store.updateAdjustment(id, entry.adjustment).catch(() => {})
    }
  }, [])

  // 存在しなくなったページに対する遅延書き込みを取り消す。
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

  // エントリを最新利用として挿入(または更新)し、選択中のページでも
  // 今使ったページでもない古いエントリから追い出す。
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

  // ページを選択し、プレビュー解像度でエディタに描画する。キャンバスの幅は
  // 数百pxしかないため、原本をフルデコードすると実際に表示する画素の約65倍を
  // 処理することになり、しかもスライダー操作のたびにその全画素へ
  // applyAdjustment が走る。見開き結合と書き出しは
  // ensureRawImage / Worker 経由で引き続き原本を使う。
  const showPreview = useCallback(
    async (id: string, store: ImageStore) => {
      setSelected(id)
      // 直前のページの画素をここで捨てる。残したままだと、デコードが終わるまでの間
      // 「前のページの画像」と「新しいページの調整値」が組み合わさって描画される。
      setSelectedImage(null)
      const pages = await store.listPages()
      const page = pages.find((p) => p.id === id)
      if (!page) return
      const blob = await store.getBlob(page.blobId)
      if (!blob) return
      const preview = await downscale(blob, PREVIEW_MAX_EDGE)
      // 待っている間にユーザーが別のページへ移っていたら、その選択を上書きしない。
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
      // 読めない・非対応のファイルが1つあっても読み込み全体を止めない:
      // そのファイルは飛ばして続行し、後でまとめて名前を報告する(仕様 §エラーハンドリング)。
      const failedNames: string[] = []
      let quotaExceeded = false
      setImportProgress({ done: 0, total: files.length })
      for (const [index, file] of files.entries()) {
        try {
          // ここで原本をフル解像度でデコードすることはない。自動補正の
          // ヒストグラムはサムネイル相当の画素で十分で、書き出すページに必要な
          // 原本の寸法は `downscale` が返してくれる。
          const thumb = await downscale(file, THUMBNAIL_MAX_EDGE)
          const page = await store.addPage(
            file,
            thumb.originalWidth,
            thumb.originalHeight,
            await thumb.toBlob(),
            file.name,
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
        setImportProgress({ done: index + 1, total: files.length })
      }
      setImportProgress(null)
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

  // スライダー操作のたびに呼ばれる。ローカル状態は即時更新してキャンバスの
  // 再描画からIndexedDBの往復を外し、書き込み自体は遅延させる。仕様も
  // 入力イベントごとではなく確定時の保存を求めている。以前は1目盛ごとに
  // 書き込んでページ表全体を読み直しており、実物のスキャンではUIが固まっていた。
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

  // リサイズ設定だけを他のページにも複製する。明るさ・コントラスト・画質は
  // ページごとに個別の値を持っているため、ここでは触れない
  // (以前はここで調整値全体をコピーしており、リサイズを揃えるだけのつもりが
  // 他ページの補正値まで上書きしてしまっていた)。
  const applyResizeToAllPages = useCallback(
    async (sourceId: string) => {
      const store = storeRef.current
      if (!store) return
      await flushPendingAdjustments()
      const source = pages.find((p) => p.id === sourceId)
      if (!source) return
      const { resizeMode, resizeWidth, resizeHeight } = source.adjustment
      for (const page of pages) {
        if (page.id === sourceId) continue
        await store.updateAdjustment(page.id, { ...page.adjustment, resizeMode, resizeWidth, resizeHeight })
      }
      await refreshPages()
    },
    [pages, refreshPages, flushPendingAdjustments],
  )

  // 画質だけを他のページにも複製する。
  const applyQualityToAllPages = useCallback(
    async (sourceId: string) => {
      const store = storeRef.current
      if (!store) return
      await flushPendingAdjustments()
      const source = pages.find((p) => p.id === sourceId)
      if (!source) return
      const { quality } = source.adjustment
      for (const page of pages) {
        if (page.id === sourceId) continue
        await store.updateAdjustment(page.id, { ...page.adjustment, quality })
      }
      await refreshPages()
    },
    [pages, refreshPages, flushPendingAdjustments],
  )

  // 明るさ・コントラストだけを他のページにも複製する。
  const applyToneToAllPages = useCallback(
    async (sourceId: string) => {
      const store = storeRef.current
      if (!store) return
      await flushPendingAdjustments()
      const source = pages.find((p) => p.id === sourceId)
      if (!source) return
      const { brightness, contrast } = source.adjustment
      for (const page of pages) {
        if (page.id === sourceId) continue
        await store.updateAdjustment(page.id, { ...page.adjustment, brightness, contrast })
      }
      await refreshPages()
    },
    [pages, refreshPages, flushPendingAdjustments],
  )

  const autoAdjustAllPages = useCallback(async () => {
    const store = storeRef.current
    if (!store) return
    await flushPendingAdjustments()
    const currentPages = await store.listPages()
    for (const page of currentPages) {
      if (!page.thumbBlobId) continue
      const blob = await store.getBlob(page.thumbBlobId)
      if (!blob) continue
      const raw = await decodeBlobToRawImage(blob)
      const auto = computeAutoAdjustment(raw)
      await store.updateAdjustment(page.id, { ...page.adjustment, ...auto })
    }
    await refreshPages()
  }, [flushPendingAdjustments, refreshPages])

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

  const clearAllPages = useCallback(async () => {
    const store = storeRef.current
    if (!store) return
    for (const entry of pendingAdjustmentsRef.current.values()) clearTimeout(entry.timer)
    pendingAdjustmentsRef.current.clear()
    rawImagesRef.current.clear()
    await store.clearAll()
    setThumbnails((current) => {
      for (const url of Object.values(current)) URL.revokeObjectURL(url)
      return {}
    })
    setSelected(null)
    setSelectedImage(null)
    await refreshPages()
  }, [refreshPages, setSelected])

  const confirmMerge = useCallback(
    async (firstId: string, secondId: string) => {
      const store = storeRef.current
      if (!store) return
      const first = pages.find((p) => p.id === firstId)
      const second = pages.find((p) => p.id === secondId)
      if (!first || !second) return
      // 各ページ自身の明るさ/コントラストを結合後の画素に焼き込む。
      // 結合時に元ページは削除されるため、無調整のまま結合すると
      // ユーザーが設定した値を黙って捨てることになる。焼き込んだ上で
      // 結合後エントリの調整値は0/0から始めるのが正しい。
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
      // 元ページは削除済みなので、遅延中の書き込みは対象を失っている。
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
    async (format: 'pdf' | 'epub', onProgress?: (done: number, total: number) => void) => {
      const store = storeRef.current
      if (!store) throw new Error('store not ready')
      // スライダー操作直後の書き出しで、遅延待ちのままの最後の調整値を
      // 取りこぼさないようにする。
      await flushPendingAdjustments()
      // デコード済み画素ではなく保存済みBlobを送る: Worker側が各ページを
      // 自前でデコードするので、ここで1冊分のRGBAを同時に抱えずに済む。
      const currentPages = await store.listPages()
      const exportPages: ExportRequestPage[] = []
      for (const page of currentPages) {
        const blob = await store.getBlob(page.blobId)
        if (!blob) throw new Error(`image data not found for page: ${page.id}`)
        exportPages.push({ blob, adjustment: page.adjustment })
      }
      return runExportInWorker({ format, metadata, pages: exportPages }, onProgress)
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
    applyResizeToAllPages,
    applyQualityToAllPages,
    applyToneToAllPages,
    autoAdjustAllPages,
    reorderPages,
    deletePage,
    clearAllPages,
    confirmMerge,
    setMetadata,
    exportBook,
    importProgress,
    error,
    clearError,
  }
}
