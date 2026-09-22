import { useEffect, useRef, useState } from 'react'
import type { OcrLine } from '../lib/ocr/types'

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
  // 入力中(未保存)の下書きは、外からのテキスト更新で上書きしない。
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) setDraft(line.text)
  }, [line.text])
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
        onChange={(event) => {
          dirty.current = true
          setDraft(event.target.value)
        }}
        onBlur={() => {
          if (!dirty.current) return
          dirty.current = false
          if (draft !== line.text) onCommit(draft)
        }}
      />
    </li>
  )
}

export interface OcrLineListProps {
  lines: OcrLine[]
  /** 選択中の行(枠クリックとの連動などに使う)。使わない画面ではundefinedでよい。 */
  selectedLineId?: string | null
  onSelectLine?: (id: string) => void
  onCommit: (lineId: string, text: string) => void
  onDelete: (lineId: string) => void
  onMove: (lineId: string, toIndex: number) => void
  /** 行IDごとのtextarea要素を親に伝える(枠クリックからのフォーカスなどに使う)。 */
  registerTextareaRef?: (id: string, el: HTMLTextAreaElement | null) => void
}

// OCR結果の行を一覧編集する。テキストの修正・並べ替え・削除ができる。
// OCR確認・修正ステップ(OcrReview)と目次の作成ステップ(ChaptersStep)の
// 両方から使う共通コンポーネント。
export function OcrLineList({
  lines,
  selectedLineId,
  onSelectLine,
  onCommit,
  onDelete,
  onMove,
  registerTextareaRef,
}: OcrLineListProps) {
  return (
    <ol className="ocr-lines">
      {lines.map((line, index) => (
        <LineRow
          key={line.id}
          line={line}
          index={index}
          count={lines.length}
          selected={line.id === selectedLineId}
          registerRef={(el) => registerTextareaRef?.(line.id, el)}
          onFocus={() => onSelectLine?.(line.id)}
          onCommit={(text) => onCommit(line.id, text)}
          onDelete={() => onDelete(line.id)}
          onMove={(to) => onMove(line.id, to)}
        />
      ))}
    </ol>
  )
}
