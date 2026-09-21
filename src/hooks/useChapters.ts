import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageStore } from '../lib/imageStore'
import { remapChapters } from '../lib/toc/chapters'
import type { Chapter } from '../types'

export interface UseChaptersResult {
  chapters: Chapter[]
  setChapters: (next: Chapter[]) => Promise<void>
}

export interface UseChaptersOptions {
  /** 現在のページID一覧(書籍順)。変わるたびに保存済みの章を読み直し、消えたページの章を寄せる。 */
  pageIds?: string[]
}

function clampLevels(chapters: Chapter[]): Chapter[] {
  return chapters.map((c) => ({ ...c, level: c.level >= 2 ? 2 : 1 }))
}

export function useChapters(
  getStore: () => Promise<ImageStore | null>,
  options: UseChaptersOptions = {},
): UseChaptersResult {
  const { pageIds } = options
  const [chapters, setChaptersState] = useState<Chapter[]>([])
  const getStoreRef = useRef(getStore)
  useEffect(() => {
    getStoreRef.current = getStore
  })
  const mountedRef = useRef(true)
  const prevIdsRef = useRef<string[] | null>(null)
  // 保存は直列にする。入力のたびに呼ばれるので、順序が入れ替わると古い値が残る。
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve())
  // 読み込みを待つ間に編集された場合、古い読み込み結果で表示を上書きしないための世代番号。
  const editVersionRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const pagesKey = pageIds ? pageIds.join(',') : null
  useEffect(() => {
    if (!pageIds) return
    const prev = prevIdsRef.current
    prevIdsRef.current = pageIds
    // 読み込みと寄せは保存と同じ直列の列に入れる。保留中の編集の保存より後に読むので、
    // 古い章を読んで新しい編集を上書きすることがなく、寄せが飛ばされることもない。
    const enqueuedVersion = editVersionRef.current
    writeChainRef.current = writeChainRef.current
      .then(async () => {
        const store = await getStoreRef.current()
        if (!store || !mountedRef.current) return
        const stored = await store.listChapters()
        const alive = new Set(pageIds)
        // 前回のページ一覧が空(初回読み込み・全削除の取り消し)のときは、まだ全ページが
        // 揃っていないだけの可能性があるので寄せない。寄せると章を誤って捨ててしまう。
        const shouldRemap = prev !== null && prev.length > 0 && stored.some((c) => !alive.has(c.pageId))
        const next = shouldRemap ? remapChapters(stored, prev ?? [], pageIds) : stored
        if (shouldRemap) await store.putChapters(next)
        // 待っている間に編集された場合、その編集が最新の状態なので表示は上書きしない。
        if (mountedRef.current && editVersionRef.current === enqueuedVersion) setChaptersState(next)
      })
      .catch(() => {})
  }, [pagesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const setChapters = useCallback(async (next: Chapter[]) => {
    const normalized = clampLevels(next)
    editVersionRef.current += 1
    setChaptersState(normalized)
    const write = writeChainRef.current.then(async () => {
      const store = await getStoreRef.current()
      if (store) await store.putChapters(normalized)
    })
    writeChainRef.current = write.catch(() => {})
    await write
  }, [])

  return { chapters, setChapters }
}
