import { useEffect, useRef, useState } from 'react'
import type { OcrResult } from '../lib/ocr/types'
import { guessTitle, joinSelectedLines, lineFontSize, sortByFontSizeDesc } from '../lib/titleGuess'
import type { BookMetadata, PageEntry, RawImage } from '../types'
import { MetadataForm } from './MetadataForm'
import { AdjustedPreview, ZoomModal } from './ZoomModal'

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
}: TitleStepProps) {
  const [zoomOpen, setZoomOpen] = useState(false)
  const [zoomImage, setZoomImage] = useState<RawImage | null>(null)
  const [zoomError, setZoomError] = useState<string | null>(null)
  // どのOCR行をタイトル/著者に含めるか。改行でbboxが分かれた行を複数選んで
  // 結合できるよう、テキストの完全一致ではなく行IDの集合で持つ。
  const [titleLineIds, setTitleLineIds] = useState<ReadonlySet<string>>(new Set())
  const [authorLineIds, setAuthorLineIds] = useState<ReadonlySet<string>>(new Set())

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
  const appliedOcrKeyRef = useRef<number | null>(null)
  useEffect(() => {
    const key = ocrResult?.updatedAt ?? null
    if (key === null || key === appliedOcrKeyRef.current) return
    appliedOcrKeyRef.current = key
    if (metadata.title !== '') return
    const top = sortByFontSizeDesc(ocrResult)[0]
    if (!top) return
    setTitleLineIds(new Set([top.id]))
    const guess = guessTitle(ocrResult)
    if (guess !== '') onChange({ ...metadata, title: guess })
  }, [ocrResult, metadata, onChange])

  function toggleTitleLine(lineId: string, checked: boolean) {
    const next = new Set(titleLineIds)
    if (checked) next.add(lineId)
    else next.delete(lineId)
    setTitleLineIds(next)
    onChange({ ...metadata, title: joinSelectedLines(ocrResult, next) })
  }

  function toggleAuthorLine(lineId: string, checked: boolean) {
    const next = new Set(authorLineIds)
    if (checked) next.add(lineId)
    else next.delete(lineId)
    setAuthorLineIds(next)
    onChange({ ...metadata, author: joinSelectedLines(ocrResult, next) })
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
      <MetadataForm metadata={metadata} onChange={onChange} />

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
                    onChange={(event) => toggleTitleLine(line.id, event.target.checked)}
                  />
                  タイトル
                </label>
                <label className="title-step__candidate-checkbox">
                  <input
                    type="checkbox"
                    checked={authorLineIds.has(line.id)}
                    aria-label={`「${line.text}」を著者に含める`}
                    onChange={(event) => toggleAuthorLine(line.id, event.target.checked)}
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
