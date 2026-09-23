import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageStore } from '../lib/imageStore'
import { OCR_MODEL_VERSION } from '../lib/ocr/ocrConfig'
import type { OcrStage } from '../lib/ocr/ocrMessages'
import { createOcrRunner, type OcrRunner } from '../lib/ocr/ocrRunner'
import {
  browserStorage,
  clampOcrConcurrency,
  loadOcrConcurrency,
  maxOcrConcurrency,
  saveOcrConcurrency,
  type OcrSettingsStorage,
} from '../lib/ocr/ocrSettings'
import type { Box, OcrLine, OcrResult } from '../lib/ocr/types'

export interface UseOcrResult {
  results: Record<string, OcrResult> // pageId → 結果
  progress: OcrProgress | null
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
  /** 同時に処理するページ数(=同時に動かすOCR Workerの数)。次の実行から反映される。 */
  concurrency: number
  /** この端末で選べる同時処理数の上限(論理コア数−1)。 */
  maxConcurrency: number
  /** 1〜上限に丸めて保存し、採用した値を返す。 */
  setConcurrency: (n: number) => number
}

export interface OcrProgress {
  done: number
  total: number
  stage?: string
  /** 並列に処理しているレーン数。 */
  concurrency?: number
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
  /** 論理コア数。既定は navigator.hardwareConcurrency(テストで差し替える)。 */
  cores?: number
  /** 同時処理数の保存先。既定は localStorage。 */
  storage?: OcrSettingsStorage
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
  const cores =
    options.cores ?? (typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency)
  const maxConcurrency = maxOcrConcurrency(cores)
  const storageRef = useRef(options.storage ?? browserStorage())
  const createRunnerRef = useRef(options.createRunner ?? (() => createOcrRunner()))
  const getStoreRef = useRef(getStore)
  useEffect(() => {
    createRunnerRef.current = options.createRunner ?? (() => createOcrRunner())
    getStoreRef.current = getStore
  })
  // レーンごとのRunner(=Worker)。レーン0は実行後も残し、1ページだけの再実行などで使い回す。
  const runnersRef = useRef<(OcrRunner | null)[]>([])
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
  const [storedConcurrency, setStoredConcurrency] = useState(() =>
    loadOcrConcurrency(maxConcurrency, storageRef.current),
  )
  const concurrency = clampOcrConcurrency(storedConcurrency, maxConcurrency)
  // runAll は開始時点の値を読むので、描画を待たずに最新値を持っておく。
  const concurrencyRef = useRef(concurrency)
  useEffect(() => {
    concurrencyRef.current = concurrency
  }, [concurrency])

  const setConcurrency = useCallback(
    (n: number) => {
      const value = clampOcrConcurrency(n, maxConcurrency)
      saveOcrConcurrency(value, storageRef.current)
      concurrencyRef.current = value
      setStoredConcurrency(value)
      return value
    },
    [maxConcurrency],
  )

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
      for (const runner of runnersRef.current) runner?.dispose()
      runnersRef.current = []
    }
  }, [])

  // 実行中のページの認識は止められない。そのページは最後まで処理して保存し、
  // 残りのページだけを飛ばす。
  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  const discardRunner = useCallback((lane: number) => {
    runnersRef.current[lane]?.dispose()
    runnersRef.current[lane] = null
  }, [])

  // fromLane 以降のRunnerを破棄する(Workerごとにモデルのメモリを持つため)。
  const disposeRunners = useCallback((fromLane: number) => {
    const runners = runnersRef.current
    for (let lane = fromLane; lane < runners.length; lane += 1) runners[lane]?.dispose()
    runners.length = Math.min(runners.length, fromLane)
  }, [])

  const runAll = useCallback(
    async (ids: string[], opts?: RunOptions): Promise<RunSummary> => {
      const summary: RunSummary = { skippedEdited: [] }
      // 最初のawaitより前に確保する。さもないと同時に2回呼ばれたとき両方が走る。
      if (runningRef.current) return summary
      runningRef.current = true
      cancelRef.current = false
      setRunning(true)
      const failed: { index: number; name: string }[] = []
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
        const lanes = Math.max(1, Math.min(concurrencyRef.current, targets.length))
        const stages = new Array<OcrStage | undefined>(lanes).fill(undefined)
        let next = 0
        let done = 0

        const report = () => {
          if (!mountedRef.current) return
          // 並列時は各レーンの細かい段階を出し分けず、モデル読み込み中だけ知らせる。
          const stage = stages.includes('loading-models')
            ? 'loading-models'
            : lanes === 1
              ? stages[0]
              : undefined
          setProgress({ done, total: targets.length, stage, concurrency: lanes })
        }
        setProgress({ done: 0, total: targets.length, concurrency: lanes })

        // 初回はモデルをネットワークから取得するので、全レーンが同時に始めると
        // 同じモデルをレーン数ぶんダウンロードしてしまう。レーン0がモデルを
        // 読み終える(か最初のページを終える)まで、他のレーンは待たせる。
        let markLoaded = () => {}
        const firstLoaded = new Promise<void>((resolve) => {
          markLoaded = resolve
        })

        const processPage = async (
          lane: number,
          index: number,
          page: (typeof targets)[number],
        ): Promise<'done' | 'unmounted'> => {
          try {
            const blob = await store.getBlob(page.blobId)
            if (!blob) throw new Error(`image data not found for page: ${page.id}`)
            if (!mountedRef.current) return 'unmounted'
            const runner = (runnersRef.current[lane] ??= createRunnerRef.current())
            const lines = await runner.recognizePage(blob, (stage) => {
              stages[lane] = stage
              if (lane === 0 && stage !== 'loading-models') markLoaded()
              report()
            })
            if (!mountedRef.current) return 'unmounted'
            // 認識中にページが削除された場合は、孤立したOCR結果を残さない。
            if (!(await store.listPages()).some((p) => p.id === page.id)) return 'done'
            // 認識中にユーザーが編集していた場合は、その編集を守って新しい結果を捨てる。
            const latest = await store.getOcr(page.id)
            if (!opts?.overwriteEdited && latest?.lines.some((l) => l.edited)) {
              setResults({ ...resultsRef.current, [page.id]: latest })
              return 'done'
            }
            const result: OcrResult = {
              pageId: page.id,
              lines,
              modelVersion: OCR_MODEL_VERSION,
              updatedAt: Date.now(),
            }
            await store.putOcr(result)
            if (mountedRef.current) setResults({ ...resultsRef.current, [page.id]: result })
          } catch (error) {
            failed.push({ index, name: page.fileName ?? page.id })
            // 原因(モデル取得失敗の詳細など)をUIの短いメッセージに含めると
            // 長くなりすぎるため、コンソールにだけ出す。
            console.error(`OCRに失敗しました: ${page.fileName ?? page.id}`, error)
            // Workerが壊れている可能性があるので、このレーンのものだけ捨てる。
            // 次のページで作り直される。
            discardRunner(lane)
          } finally {
            stages[lane] = undefined
          }
          return 'done'
        }

        // 各レーンは共有の対象リストから次のページを取っていく。
        const runLane = async (lane: number) => {
          if (lane > 0) await firstLoaded
          try {
            while (!cancelRef.current && mountedRef.current && next < targets.length) {
              const index = next
              next += 1
              const outcome = await processPage(lane, index, targets[index])
              if (lane === 0) markLoaded()
              if (outcome === 'unmounted') return
              done += 1
              report()
            }
          } finally {
            if (lane === 0) markLoaded()
          }
        }

        await Promise.all(Array.from({ length: lanes }, (_, lane) => runLane(lane)))
      } finally {
        // レーン0以外のWorkerはモデルのメモリを抱えたままなので、終わったら捨てる。
        disposeRunners(1)
        runningRef.current = false
        if (mountedRef.current) {
          setRunning(false)
          setProgress(null)
        }
      }
      if (mountedRef.current) {
        setError(
          failed.length > 0
            ? `文字認識に失敗しました: ${failed
                .sort((a, b) => a.index - b.index)
                .map((f) => f.name)
                .join(', ')} (詳細はブラウザの開発者ツールのコンソールを確認してください)`
            : null,
        )
        if (reloadPendingRef.current) {
          reloadPendingRef.current = false
          void reload().catch(() => {})
        }
      }
      return summary
    },
    [setResults, discardRunner, disposeRunners, reload],
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
    concurrency,
    maxConcurrency,
    setConcurrency,
  }
}
