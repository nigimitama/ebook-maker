import { useEffect, useState } from 'react'
import type { OcrResult } from '../lib/ocr/types'
import { lineFontSize, sortByFontSizeDesc } from '../lib/titleGuess'
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

  useEffect(() => {
    if (metadata.title !== '') return
    const guess = sortByFontSizeDesc(ocrResult)[0]?.text ?? ''
    if (guess !== '') onChange({ ...metadata, title: guess })
  }, [ocrResult, metadata, onChange])

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
      <div className="panel">
        <h2>表紙</h2>
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
      </div>

      <div className="panel">
        <h2>候補(文字サイズが大きい順)</h2>
        {candidates.length === 0 && <p>OCR結果がありません。表紙をOCRしてください。</p>}
        {candidates.length > 0 && (
          <ul className="title-step__candidates">
            {candidates.map((line) => (
              <li key={line.id} className="title-step__candidate">
                <span className="title-step__candidate-text">{line.text}</span>
                <span className="title-step__candidate-size">{`${lineFontSize(line)}px`}</span>
                <button
                  type="button"
                  className={metadata.title === line.text ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => onChange({ ...metadata, title: line.text })}
                >
                  タイトルにする
                </button>
                <button
                  type="button"
                  className={metadata.author === line.text ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => onChange({ ...metadata, author: line.text })}
                >
                  著者にする
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <MetadataForm metadata={metadata} onChange={onChange} />

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
