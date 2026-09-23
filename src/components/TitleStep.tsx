import { useEffect, useState } from 'react'
import type { OcrResult } from '../lib/ocr/types'
import { guessTitle, joinSelectedLines, lineFontSize, sortByFontSizeDesc } from '../lib/titleGuess'
import type { BookMetadata, PageEntry, RawImage, TitleSelection } from '../types'
import { MetadataForm } from './MetadataForm'
import { AdjustedPreview, ZoomModal } from './ZoomModal'

type Field = 'title' | 'author'
const FIELD_LABEL: Record<Field, string> = { title: 'タイトル', author: '著者' }

export interface TitleStepProps {
  /** 表紙とみなす1ページ目。ページが1枚もなければ undefined。 */
  coverPage: PageEntry | undefined
  /** 表紙のサムネイル(なければ img は出さない)。 */
  thumbnail?: string
  /** 表紙のOCR結果(未実施なら undefined)。 */
  ocrResult: OcrResult | undefined
  ocrRunning: boolean
  /** 表紙ページ1枚にOCRをかける。 */
  onRunOcr: () => void
  metadata: BookMetadata
  onChange: (metadata: BookMetadata) => void
  /** 拡大表示用に、指定ページの原本から生成したプレビュー画素を取得する。 */
  getPagePreview: (pageId: string) => Promise<RawImage>
  selection: TitleSelection
  onSelectionChange: (selection: TitleSelection) => void
}

// 1ページ目を表紙と仮定し、そのOCR結果から文字サイズが最大の行をタイトルの
// 初期候補として自動的に入れる。タイトルが既に入力済みなら上書きしない。
export function TitleStep({
  coverPage,
  thumbnail,
  ocrResult,
  ocrRunning,
  onRunOcr,
  metadata,
  onChange,
  getPagePreview,
  selection,
  onSelectionChange,
}: TitleStepProps) {
  const [zoomOpen, setZoomOpen] = useState(false)
  const [zoomImage, setZoomImage] = useState<RawImage | null>(null)
  const [zoomError, setZoomError] = useState<string | null>(null)
  // 候補のチェックで手入力の値を置き換えたときの、置き換え前の値(取り消し用)。
  const [replaced, setReplaced] = useState<{ field: Field; previous: string } | null>(null)
  const titleLineIds = new Set(selection.titleLineIds)
  const authorLineIds = new Set(selection.authorLineIds)

  useEffect(() => {
    setZoomImage(null)
    setZoomError(null)
    if (!zoomOpen || !coverPage) return
    let cancelled = false
    getPagePreview(coverPage.id)
      .then((image) => {
        if (!cancelled) setZoomImage(image)
      })
      .catch(() => {
        if (!cancelled) setZoomError('画像の読み込みに失敗しました')
      })
    return () => {
      cancelled = true
    }
  }, [zoomOpen, coverPage, getPagePreview])

  // 新しいOCR結果が来たときだけタイトルを自動入力する。metadataの変化そのもの
  // (ユーザーがタイトルを空に戻した場合など)では発火させない。そうしないと、
  // 一度自動入力した後にユーザーが消しても即座に同じ候補が再入力されてしまう。
  // 自動入力済みの印は selection に持つので、工程を離れて戻っても再入力しない。
  useEffect(() => {
    const key = ocrResult?.updatedAt ?? null
    if (key === null || key === selection.appliedOcrKey) return
    if (metadata.title !== '') {
      onSelectionChange({ ...selection, appliedOcrKey: key })
      return
    }
    const top = sortByFontSizeDesc(ocrResult)[0]
    onSelectionChange({ ...selection, appliedOcrKey: key, titleLineIds: top ? [top.id] : selection.titleLineIds })
    const guess = guessTitle(ocrResult)
    if (top && guess !== '') onChange({ ...metadata, title: guess })
  }, [ocrResult, selection, metadata, onChange, onSelectionChange])

  function toggleLine(field: Field, lineId: string, checked: boolean) {
    const key = field === 'title' ? 'titleLineIds' : 'authorLineIds'
    const current = new Set(selection[key])
    const next = new Set(current)
    if (checked) next.add(lineId)
    else next.delete(lineId)
    onSelectionChange({ ...selection, [key]: [...next] })
    // チェックで作った値ではない(手入力した)値を置き換えるときは、取り消せるように控える。
    const previous = metadata[field]
    const handTyped = previous !== '' && previous !== joinSelectedLines(ocrResult, current)
    setReplaced(handTyped ? { field, previous } : null)
    onChange({ ...metadata, [field]: joinSelectedLines(ocrResult, next) })
  }

  if (!coverPage) {
    return (
      <div className="panel">
        <p>ページがありません。「読み込み」工程で画像を追加してください。</p>
      </div>
    )
  }

  const candidates = sortByFontSizeDesc(ocrResult)

  return (
    <div className="title-step">
      <MetadataForm
        metadata={metadata}
        onChange={(next) => {
          setReplaced(null)
          onChange(next)
        }}
      />

      <div className="panel">
        <h2>OCR結果から入力</h2>

        <p className="title-step__cover-caption">入力画像の1枚目を表紙と仮定しています</p>
        <div className="title-step__cover">
          {thumbnail && (
            <button
              type="button"
              className="chapters-step__thumb-btn"
              aria-label="表紙を拡大表示"
              onClick={() => setZoomOpen(true)}
            >
              <img src={thumbnail} alt="" />
            </button>
          )}
          <button type="button" className="btn btn-ghost" disabled={ocrRunning} onClick={onRunOcr}>
            {ocrResult ? '表紙を再OCR' : '表紙をOCR'}
          </button>
        </div>

        {replaced && (
          <p className="title-step__undo" role="status">
            <span>{`「${replaced.previous}」を置き換えました`}</span>{' '}
            <button
              type="button"
              className="btn btn-ghost"
              aria-label={`「${FIELD_LABEL[replaced.field]}の置き換え」を取り消す`}
              onClick={() => {
                setReplaced(null)
                onChange({ ...metadata, [replaced.field]: replaced.previous })
              }}
            >
              元に戻す
            </button>
          </p>
        )}

        <h3>候補(文字サイズが大きい順)</h3>
        {candidates.length === 0 && ocrResult === undefined && (
          <p>OCR結果がありません。表紙をOCRしてください。</p>
        )}
        {candidates.length === 0 && ocrResult !== undefined && <p>OCR結果に文字が見つかりませんでした。</p>}
        {candidates.length > 0 && (
          <ul className="title-step__candidates">
            {candidates.map((line) => (
              <li key={line.id} className="title-step__candidate">
                <span className="title-step__candidate-text">{line.text}</span>
                <span className="title-step__candidate-size">{`${Math.round(lineFontSize(line))}px`}</span>
                <label className="title-step__candidate-checkbox">
                  <input
                    type="checkbox"
                    checked={titleLineIds.has(line.id)}
                    aria-label={`「${line.text}」をタイトルに含める`}
                    onChange={(event) => toggleLine('title', line.id, event.target.checked)}
                  />
                  タイトル
                </label>
                <label className="title-step__candidate-checkbox">
                  <input
                    type="checkbox"
                    checked={authorLineIds.has(line.id)}
                    aria-label={`「${line.text}」を著者に含める`}
                    onChange={(event) => toggleLine('author', line.id, event.target.checked)}
                  />
                  著者
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {zoomOpen && (
        <ZoomModal
          label={coverPage.fileName ?? `page ${coverPage.order + 1}`}
          onClose={() => setZoomOpen(false)}
        >
          {zoomImage ? (
            <AdjustedPreview image={zoomImage} adjustment={coverPage.adjustment} />
          ) : zoomError ? (
            <p>{zoomError}</p>
          ) : (
            <div className="thumb-modal__loading">loading...</div>
          )}
        </ZoomModal>
      )}
    </div>
  )
}
