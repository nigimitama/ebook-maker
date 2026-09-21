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
  runOne: (pageId: string) => Promise<void>
  runAll: (pageIds: string[], opts?: { skipDone?: boolean }) => Promise<void>
  cancel: () => void
  updateLine: (pageId: string, lineId: string, text: string) => Promise<void>
  deleteLine: (pageId: string, lineId: string) => Promise<void>
  addLine: (pageId: string, box: Box, afterLineId?: string) => Promise<void>
  moveLine: (pageId: string, lineId: string, toIndex: number) => Promise<void>
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

  // ページ一覧が変わったら保存済み結果を読み直す(ページIDの並びをキーにする)。
  const pagesKey = pageIds ? pageIds.join('\n') : null
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const store = await getStoreRef.current()
      if (!store || cancelled) return
      const list = await store.listOcr()
      if (cancelled) return
      const next: Record<string, OcrResult> = {}
      for (const r of list) next[r.pageId] = r
      setResults(next)
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pagesKey, setResults])

  useEffect(
    () => () => {
      runnerRef.current?.dispose()
      runnerRef.current = null
    },
    [],
  )

  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  const discardRunner = useCallback(() => {
    runnerRef.current?.dispose()
    runnerRef.current = null
  }, [])

  const runAll = useCallback(
    async (ids: string[], opts?: { skipDone?: boolean }) => {
      if (runningRef.current) return
      const store = await getStoreRef.current()
      if (!store) return
      runningRef.current = true
      cancelRef.current = false
      setRunning(true)
      const failed: string[] = []
      try {
        const pages = await store.listPages()
        const targets = ids
          .map((id) => pages.find((p) => p.id === id))
          .filter((p): p is NonNullable<typeof p> => p !== undefined)
          .filter((p) => !(opts?.skipDone && resultsRef.current[p.id]))
        setProgress({ done: 0, total: targets.length })
        for (const [index, page] of targets.entries()) {
          if (cancelRef.current) break
          try {
            const blob = await store.getBlob(page.blobId)
            if (!blob) throw new Error(`image data not found for page: ${page.id}`)
            runnerRef.current ??= createRunnerRef.current()
            const lines = await runnerRef.current.recognizePage(blob, (stage) =>
              setProgress({ done: index, total: targets.length, stage }),
            )
            const result: OcrResult = {
              pageId: page.id,
              lines,
              modelVersion: OCR_MODEL_VERSION,
              updatedAt: Date.now(),
            }
            await store.putOcr(result)
            setResults({ ...resultsRef.current, [page.id]: result })
          } catch {
            failed.push(page.fileName ?? page.id)
            // Workerが壊れている可能性があるので捨てる。次のページで作り直される。
            discardRunner()
          }
          setProgress({ done: index + 1, total: targets.length })
        }
      } finally {
        runningRef.current = false
        setRunning(false)
        setProgress(null)
      }
      setError(failed.length > 0 ? `文字認識に失敗しました: ${failed.join(', ')}` : null)
    },
    [setResults, discardRunner],
  )

  const runOne = useCallback((pageId: string) => runAll([pageId]), [runAll])

  const mutate = useCallback(
    async (pageId: string, edit: (lines: OcrLine[]) => OcrLine[]) => {
      const store = await getStoreRef.current()
      const current = resultsRef.current[pageId]
      if (!store || !current) return
      const result: OcrResult = { ...current, lines: edit(current.lines), updatedAt: Date.now() }
      await store.putOcr(result)
      setResults({ ...resultsRef.current, [pageId]: result })
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
