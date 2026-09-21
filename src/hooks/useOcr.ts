import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageStore } from '../lib/imageStore'
import { OCR_MODEL_VERSION } from '../lib/ocr/ocrConfig'
import { createOcrRunner, type OcrRunner } from '../lib/ocr/ocrRunner'
import type { Box, OcrLine, OcrResult } from '../lib/ocr/types'

export interface UseOcrResult {
  results: Record<string, OcrResult> // pageId → 結果
  progress: { done: number; total: number; stage?: string } | null
  running: boolean
  error: string | null
  clearError: () => void
  runOne: (pageId: string, opts?: RunOptions) => Promise<RunSummary>
  runAll: (pageIds: string[], opts?: RunOptions) => Promise<RunSummary>
  cancel: () => void
  updateLine: (pageId: string, lineId: string, text: string) => Promise<void>
  deleteLine: (pageId: string, lineId: string) => Promise<void>
  addLine: (pageId: string, box: Box, afterLineId?: string) => Promise<void>
  moveLine: (pageId: string, lineId: string, toIndex: number) => Promise<void>
}

export interface RunOptions {
  skipDone?: boolean
  /** true で、ユーザーが編集した行を含むページも上書きして再実行する。 */
  overwriteEdited?: boolean
}

export interface RunSummary {
  /** 編集済みの行があるため実行を見送ったページID(「上書きして再実行」の確認用)。 */
  skippedEdited: string[]
}

export interface UseOcrOptions {
  createRunner?: () => OcrRunner
  /**
   * 現在のページID一覧。内容が変わる(削除・全削除・取り消し・結合)たびに
   * 保存済みのOCR結果を読み直し、古い結果が残らないようにする。
   */
  pageIds?: string[]
}

let lineCounter = 0
function newLineId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  lineCounter += 1
  return `${Date.now()}-${lineCounter}-${Math.random().toString(36).slice(2, 8)}`
}

export function useOcr(
  getStore: () => Promise<ImageStore | null>,
  options: UseOcrOptions = {},
): UseOcrResult {
  const { pageIds } = options
  const createRunnerRef = useRef(options.createRunner ?? (() => createOcrRunner()))
  const getStoreRef = useRef(getStore)
  useEffect(() => {
    createRunnerRef.current = options.createRunner ?? (() => createOcrRunner())
    getStoreRef.current = getStore
  })
  const runnerRef = useRef<OcrRunner | null>(null)
  const cancelRef = useRef(false)
  const runningRef = useRef(false)
  const mountedRef = useRef(true)
  const reloadPendingRef = useRef(false)
  const editChainsRef = useRef<Map<string, Promise<unknown>>>(new Map())
  const resultsRef = useRef<Record<string, OcrResult>>({})
  const [results, setResultsState] = useState<Record<string, OcrResult>>({})
  const [progress, setProgress] = useState<UseOcrResult['progress']>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setResults = useCallback((next: Record<string, OcrResult>) => {
    resultsRef.current = next
    setResultsState(next)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const reload = useCallback(async () => {
    // 実行中に読み直すと、書き込み途中の結果を落としかねない。終了時にまとめて読み直す。
    if (runningRef.current) {
      reloadPendingRef.current = true
      return
    }
    const store = await getStoreRef.current()
    if (!store || !mountedRef.current || runningRef.current) return
    const list = await store.listOcr()
    if (!mountedRef.current || runningRef.current) return
    const next: Record<string, OcrResult> = {}
    for (const r of list) next[r.pageId] = r
    setResults(next)
  }, [setResults])

  // ページ一覧が変わったら保存済み結果を読み直す(ページIDの並びをキーにする)。
  const pagesKey = pageIds ? pageIds.join(',') : null
  useEffect(() => {
    void reload().catch(() => {})
  }, [pagesKey, reload])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelRef.current = true
      runnerRef.current?.dispose()
      runnerRef.current = null
    }
  }, [])

  // 実行中のページの認識は止められない。そのページは最後まで処理して保存し、
  // 残りのページだけを飛ばす。
  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  const discardRunner = useCallback(() => {
    runnerRef.current?.dispose()
    runnerRef.current = null
  }, [])

  const runAll = useCallback(
    async (ids: string[], opts?: RunOptions): Promise<RunSummary> => {
      const summary: RunSummary = { skippedEdited: [] }
      // 最初のawaitより前に確保する。さもないと同時に2回呼ばれたとき両方が走る。
      if (runningRef.current) return summary
      runningRef.current = true
      cancelRef.current = false
      setRunning(true)
      const failed: string[] = []
      try {
        const store = await getStoreRef.current()
        if (!store) return summary
        const pages = await store.listPages()
        const hasEdits = (id: string) => resultsRef.current[id]?.lines.some((l) => l.edited)
        const targets = ids
          .map((id) => pages.find((p) => p.id === id))
          .filter((p): p is NonNullable<typeof p> => p !== undefined)
          .filter((p) => !(opts?.skipDone && resultsRef.current[p.id]))
          .filter((p) => {
            if (!opts?.overwriteEdited && hasEdits(p.id)) {
              summary.skippedEdited.push(p.id)
              return false
            }
            return true
          })
        setProgress({ done: 0, total: targets.length })
        for (const [index, page] of targets.entries()) {
          if (cancelRef.current || !mountedRef.current) break
          try {
            const blob = await store.getBlob(page.blobId)
            if (!blob) throw new Error(`image data not found for page: ${page.id}`)
            if (!mountedRef.current) break
            runnerRef.current ??= createRunnerRef.current()
            const lines = await runnerRef.current.recognizePage(blob, (stage) => {
              if (mountedRef.current) setProgress({ done: index, total: targets.length, stage })
            })
            if (!mountedRef.current) break
            // 認識中にページが削除された場合は、孤立したOCR結果を残さない。
            if (!(await store.listPages()).some((p) => p.id === page.id)) continue
            // 認識中にユーザーが編集していた場合は、その編集を守って新しい結果を捨てる。
            const latest = await store.getOcr(page.id)
            if (!opts?.overwriteEdited && latest?.lines.some((l) => l.edited)) {
              setResults({ ...resultsRef.current, [page.id]: latest })
              continue
            }
            const result: OcrResult = {
              pageId: page.id,
              lines,
              modelVersion: OCR_MODEL_VERSION,
              updatedAt: Date.now(),
            }
            await store.putOcr(result)
            if (mountedRef.current) setResults({ ...resultsRef.current, [page.id]: result })
          } catch {
            failed.push(page.fileName ?? page.id)
            // Workerが壊れている可能性があるので捨てる。次のページで作り直される。
            discardRunner()
          }
          if (mountedRef.current) setProgress({ done: index + 1, total: targets.length })
        }
      } finally {
        runningRef.current = false
        if (mountedRef.current) {
          setRunning(false)
          setProgress(null)
        }
      }
      if (mountedRef.current) {
        setError(failed.length > 0 ? `文字認識に失敗しました: ${failed.join(', ')}` : null)
        if (reloadPendingRef.current) {
          reloadPendingRef.current = false
          void reload().catch(() => {})
        }
      }
      return summary
    },
    [setResults, discardRunner, reload],
  )

  const runOne = useCallback(
    (pageId: string, opts?: RunOptions) => runAll([pageId], opts),
    [runAll],
  )

  // 同じページへの編集は直列化する(読み→書きが交差して編集が失われないように)。
  const mutate = useCallback(
    (pageId: string, edit: (lines: OcrLine[]) => OcrLine[]): Promise<void> => {
      const chains = editChainsRef.current
      const task = (chains.get(pageId) ?? Promise.resolve()).then(async () => {
        const store = await getStoreRef.current()
        const current = resultsRef.current[pageId]
        if (!store || !current) return
        const result: OcrResult = { ...current, lines: edit(current.lines), updatedAt: Date.now() }
        await store.putOcr(result)
        setResults({ ...resultsRef.current, [pageId]: result })
      })
      chains.set(
        pageId,
        task.catch(() => undefined),
      )
      return task
    },
    [setResults],
  )

  const updateLine = useCallback(
    (pageId: string, lineId: string, text: string) =>
      mutate(pageId, (lines) =>
        lines.map((l) => (l.id === lineId ? { ...l, text, edited: true } : l)),
      ),
    [mutate],
  )

  const deleteLine = useCallback(
    (pageId: string, lineId: string) => mutate(pageId, (lines) => lines.filter((l) => l.id !== lineId)),
    [mutate],
  )

  const addLine = useCallback(
    (pageId: string, box: Box, afterLineId?: string) =>
      mutate(pageId, (lines) => {
        const line: OcrLine = { ...box, id: newLineId(), text: '', edited: true }
        const after = afterLineId ? lines.findIndex((l) => l.id === afterLineId) : -1
        const at = after === -1 ? lines.length : after + 1
        return [...lines.slice(0, at), line, ...lines.slice(at)]
      }),
    [mutate],
  )

  const moveLine = useCallback(
    (pageId: string, lineId: string, toIndex: number) =>
      mutate(pageId, (lines) => {
        const from = lines.findIndex((l) => l.id === lineId)
        if (from === -1) return lines
        const next = lines.slice()
        const [moved] = next.splice(from, 1)
        next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved)
        return next
      }),
    [mutate],
  )

  return {
    results,
    progress,
    running,
    error,
    clearError,
    runOne,
    runAll,
    cancel,
    updateLine,
    deleteLine,
    addLine,
    moveLine,
  }
}
