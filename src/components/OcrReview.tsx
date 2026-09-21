import { useEffect, useRef, useState } from 'react'
import type { UseOcrResult } from '../hooks/useOcr'
import type { OcrLine, OcrResult } from '../lib/ocr/types'
import type { PageEntry, RawImage } from '../types'
import { OcrOverlay } from './OcrOverlay'
import { ProgressBar } from './ProgressBar'

export interface OcrReviewProps {
  pages: PageEntry[]
  thumbnails: Record<string, string>
  selectedPageId: string | null
  /** 選択中ページのプレビュー解像度の画素。まだ届いていなければ null。 */
  selectedImage: RawImage | null
  onSelect: (id: string) => void
  ocr: UseOcrResult
}

function statusOf(result: OcrResult | undefined): '未' | '済' | '修正あり' {
  if (!result) return '未'
  return result.lines.some((l) => l.edited) ? '修正あり' : '済'
}

const STAGE_LABEL: Record<string, string> = {
  detecting: '文字の領域を検出中',
  recognizing: '文字を認識中',
}

interface LineRowProps {
  line: OcrLine
  index: number
  count: number
  selected: boolean
  registerRef: (el: HTMLTextAreaElement | null) => void
  onFocus: () => void
  onCommit: (text: string) => void
  onDelete: () => void
  onMove: (toIndex: number) => void
}

function LineRow({
  line,
  index,
  count,
  selected,
  registerRef,
  onFocus,
  onCommit,
  onDelete,
  onMove,
}: LineRowProps) {
  const [draft, setDraft] = useState(line.text)
  useEffect(() => setDraft(line.text), [line.text])
  const label = `行${index + 1}`
  return (
    <li
      className={selected ? 'ocr-line ocr-line--selected' : 'ocr-line'}
      data-testid={`ocr-line-${line.id}`}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="ocr-line__head">
        <span className="ocr-line__no">{index + 1}</span>
        {line.edited && <span className="ocr-line__edited">修正済み</span>}
        <span className="ocr-line__actions">
          <button
            type="button"
            className="btn-ghost"
            aria-label="上へ移動"
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn-ghost"
            aria-label="下へ移動"
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            ↓
          </button>
          <button type="button" className="btn-ghost" aria-label="行を削除" onClick={onDelete}>
            削除
          </button>
        </span>
      </div>
      <textarea
        ref={registerRef}
        className="ocr-line__text"
        aria-label={`${label}の文字`}
        rows={2}
        value={draft}
        onFocus={onFocus}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== line.text) onCommit(draft)
        }}
      />
    </li>
  )
}

export function OcrReview({
  pages,
  thumbnails,
  selectedPageId,
  selectedImage,
  onSelect,
  ocr,
}: OcrReviewProps) {
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [addMode, setAddMode] = useState(false)
  const [overwrite, setOverwrite] = useState<null | { kind: 'one' | 'all'; pageId: string | null }>(null)
  const textareas = useRef<Map<string, HTMLTextAreaElement>>(new Map())

  const page = pages.find((p) => p.id === selectedPageId) ?? null
  const result = page ? ocr.results[page.id] : undefined
  const lines = result?.lines ?? []
  const allIds = pages.map((p) => p.id)

  // ページを切り替えたら選択と各モードをリセットする。
  useEffect(() => {
    setSelectedLineId(null)
    setAddMode(false)
    setOverwrite(null)
  }, [selectedPageId])

  async function runThisPage(opts?: { overwriteEdited: true }) {
    if (!page) return
    setOverwrite(null)
    const summary = opts ? await ocr.runOne(page.id, opts) : await ocr.runOne(page.id)
    if (summary.skippedEdited.length > 0) setOverwrite({ kind: 'one', pageId: page.id })
  }

  async function runEveryPage(opts?: { overwriteEdited: true }) {
    setOverwrite(null)
    const summary = opts ? await ocr.runAll(allIds, opts) : await ocr.runAll(allIds)
    if (summary.skippedEdited.length > 0) setOverwrite({ kind: 'all', pageId: null })
  }

  function selectLine(id: string) {
    setSelectedLineId(id)
    textareas.current.get(id)?.focus()
  }

  const stage = ocr.progress?.stage
  const progressLabel = stage && STAGE_LABEL[stage] ? STAGE_LABEL[stage] : '文字認識中'

  return (
    <div className="ocr-review">
      {ocr.error && (
        <div role="alert" data-testid="ocr-error-banner" className="error-banner">
          <span>{ocr.error}</span>
          <button type="button" onClick={ocr.clearError}>
            閉じる
          </button>
        </div>
      )}

      <div className="ocr-review__toolbar">
        <button
          type="button"
          className="btn btn-primary"
          disabled={ocr.running || !page}
          onClick={() => void runThisPage()}
        >
          このページをOCR
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={ocr.running || pages.length === 0}
          onClick={() => void runEveryPage()}
        >
          全ページをOCR
        </button>
        {ocr.running && (
          <button type="button" className="btn btn-ghost" onClick={ocr.cancel}>
            中止
          </button>
        )}
        <button
          type="button"
          className={addMode ? 'btn btn-ghost page-row__merge--active' : 'btn btn-ghost'}
          aria-pressed={addMode}
          disabled={!result}
          onClick={() => setAddMode((v) => !v)}
        >
          枠を追加
        </button>
      </div>

      {overwrite && !ocr.running && (
        <div className="ocr-review__notice" data-testid="ocr-overwrite-notice">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              overwrite.kind === 'one' ? void runThisPage({ overwriteEdited: true }) : void runEveryPage({ overwriteEdited: true })
            }
          >
            修正済みの行があります。上書きして再実行
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setOverwrite(null)}>
            そのままにする
          </button>
        </div>
      )}

      {ocr.running && (
        <div data-testid="ocr-progress">
          {stage === 'loading-models' && (
            <p className="ocr-review__hint">
              モデルを読み込み中(初回のみ約157MBをダウンロードします)…
            </p>
          )}
          <ProgressBar
            done={ocr.progress?.done ?? 0}
            total={ocr.progress?.total ?? 0}
            label={progressLabel}
            testId="ocr-progress-bar"
          />
        </div>
      )}

      <div className="page-adjust-layout ocr-review__layout">
        <div className="ocr-review__pages panel">
          <ul className="page-list__items">
            {pages.map((p) => (
              <li
                key={p.id}
                data-testid={`ocr-page-${p.id}`}
                className={p.id === selectedPageId ? 'page-row page-row--selected' : 'page-row'}
                onClick={() => onSelect(p.id)}
              >
                <img src={thumbnails[p.id]} alt={`page ${p.order + 1}`} className="page-list__thumb" />
                <span className="page-row__name" title={p.fileName ?? `ページ ${p.order + 1}`}>
                  {p.fileName ?? `ページ ${p.order + 1}`}
                </span>
                <span
                  className={`ocr-status ocr-status--${statusOf(ocr.results[p.id]) === '未' ? 'none' : statusOf(ocr.results[p.id]) === '済' ? 'done' : 'edited'}`}
                  data-testid={`ocr-status-${p.id}`}
                >
                  {statusOf(ocr.results[p.id])}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="ocr-review__image panel">
          {page ? (
            <OcrOverlay
              image={selectedImage}
              originalWidth={page.width}
              originalHeight={page.height}
              lines={lines}
              selectedLineId={selectedLineId}
              onSelectLine={selectLine}
              addMode={addMode}
              onAddBox={(box) => {
                void ocr.addLine(page.id, box, selectedLineId ?? undefined)
                setAddMode(false)
              }}
            />
          ) : (
            <p>ページを選択してください</p>
          )}
        </div>

        <div className="ocr-review__lines panel">
          {result ? (
            <ol className="ocr-lines">
              {lines.map((line, index) => (
                <LineRow
                  key={line.id}
                  line={line}
                  index={index}
                  count={lines.length}
                  selected={line.id === selectedLineId}
                  registerRef={(el) => {
                    if (el) textareas.current.set(line.id, el)
                    else textareas.current.delete(line.id)
                  }}
                  onFocus={() => setSelectedLineId(line.id)}
                  onCommit={(text) => void ocr.updateLine(page!.id, line.id, text)}
                  onDelete={() => void ocr.deleteLine(page!.id, line.id)}
                  onMove={(to) => void ocr.moveLine(page!.id, line.id, to)}
                />
              ))}
            </ol>
          ) : (
            <p className="ocr-review__empty">このページはまだOCRされていません。</p>
          )}
        </div>
      </div>

      <p className="ocr-review__attribution">
        OCRモデル: 国立国会図書館 NDLOCR-Lite (CC BY 4.0) を元にした ndlocrlite-web のモデルを使用
      </p>
    </div>
  )
}
