import { useEffect, useMemo, useState } from 'react'
import type { OcrResult } from '../lib/ocr/types'
import { newChapterId, sortChapters } from '../lib/toc/chapters'
import { detectTocPages, tocScanWindow } from '../lib/toc/detectTocPages'
import { defaultBodyStartIndex, parseToc } from '../lib/toc/parseToc'
import type { Chapter, PageEntry } from '../types'
import { ZoomModal } from './ZoomModal'

export interface ChaptersStepProps {
  pages: PageEntry[]
  thumbnails: Record<string, string>
  ocrResults: Record<string, OcrResult>
  ocrRunning: boolean
  /** 検出範囲(先頭N枚)のうち未OCRのページにOCRをかける。 */
  onRunOcr: (pageIds: string[]) => void
  chapters: Chapter[]
  onChange: (chapters: Chapter[]) => void
}

export function ChaptersStep({
  pages,
  thumbnails,
  ocrResults,
  ocrRunning,
  onRunOcr,
  chapters,
  onChange,
}: ChaptersStepProps) {
  const pageIds = useMemo(() => pages.map((p) => p.id), [pages])
  const [tocPageIds, setTocPageIds] = useState<string[]>([])
  const [bodyStart, setBodyStart] = useState(1) // 画像の何枚目が印刷ページ1か(1始まり)
  const [bodyStartEdited, setBodyStartEdited] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // サムネイルは小さく読みにくいので、クリックで拡大表示するモーダルを出す
  // (並べ替えページのZoomModalを流用。ここでは既に持っているサムネイル画像を
  // そのまま拡大するだけで、原本の再デコードはしない)。
  const [zoomPageId, setZoomPageId] = useState<string | null>(null)

  const windowSize = tocScanWindow(pages.length)
  const detection = useMemo(() => detectTocPages(pageIds, ocrResults), [pageIds, ocrResults])

  function runDetection() {
    if (detection.pageIds.length > 0) {
      setTocPageIds(detection.pageIds)
      setBodyStartEdited(false)
      setNotice(null)
    } else {
      setNotice('自動検出できませんでした。手動で選んでください')
    }
  }

  // 開いたとき、まだ目次ページが選ばれていなければ検出結果を事前選択する。
  useEffect(() => {
    if (tocPageIds.length === 0) runDetection()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時と、検出対象のOCR結果が届いた時だけ
  }, [detection])

  // 本文1ページ目の既定値は目次の次の画像。ユーザーが直したあとは動かさない。
  useEffect(() => {
    if (bodyStartEdited || tocPageIds.length === 0) return
    setBodyStart(defaultBodyStartIndex(pageIds, tocPageIds) + 1)
  }, [tocPageIds, pageIds, bodyStartEdited])

  function toggleToc(id: string, checked: boolean) {
    setTocPageIds((current) => (checked ? [...current, id] : current.filter((x) => x !== id)))
  }

  function handleParse() {
    const parsed = parseToc(tocPageIds, ocrResults, pageIds, bodyStart - 1)
    if (parsed.length === 0) {
      setNotice('目次から章を読み取れませんでした')
      return
    }
    setNotice(null)
    onChange(sortChapters(parsed, pageIds))
  }

  function updateChapter(id: string, patch: Partial<Chapter>, resort = false) {
    const next = chapters.map((c) => (c.id === id ? { ...c, ...patch } : c))
    onChange(resort ? sortChapters(next, pageIds) : next)
  }

  function addChapter() {
    const last = chapters[chapters.length - 1]
    const pageId = last?.pageId ?? pageIds[0]
    if (!pageId) return
    onChange([...chapters, { id: newChapterId(), title: '', pageId, level: 1 }])
  }

  const unscanned = detection.unscannedPageIds
  const zoomPage = pages.find((p) => p.id === zoomPageId) ?? null

  return (
    <div className="chapters-step">
      <div className="panel">
        <h2>目次ページ</h2>
        {unscanned.length > 0 && (
          <p>
            <span>{`先頭${windowSize}枚のうち${unscanned.length}枚が未OCRです`}</span>{' '}
            <button
              type="button"
              className="btn btn-ghost"
              disabled={ocrRunning}
              onClick={() => onRunOcr(unscanned)}
            >
              {`先頭${windowSize}枚をOCR`}
            </button>
          </p>
        )}
        <button type="button" className="btn btn-ghost" onClick={runDetection}>
          目次ページを自動検出
        </button>
        <div className="chapters-step__pages">
          {pages.map((p, i) => {
            const hasOcr = Boolean(ocrResults[p.id])
            return (
              <label key={p.id} className="chapters-step__page">
                {thumbnails[p.id] && (
                  <button
                    type="button"
                    className="chapters-step__thumb-btn"
                    aria-label={`${i + 1}枚目を拡大表示`}
                    onClick={(event) => {
                      event.stopPropagation()
                      setZoomPageId(p.id)
                    }}
                  >
                    <img src={thumbnails[p.id]} alt="" />
                  </button>
                )}
                <input
                  type="checkbox"
                  aria-label={`${i + 1}枚目を目次ページにする`}
                  checked={tocPageIds.includes(p.id)}
                  disabled={!hasOcr}
                  onChange={(event) => toggleToc(p.id, event.target.checked)}
                />
                <span>{hasOcr ? `${i + 1}` : `${i + 1}(未OCR)`}</span>
              </label>
            )
          })}
        </div>
        <label>
          本文1ページ目 = 画像
          <input
            type="number"
            min={1}
            max={Math.max(pages.length, 1)}
            aria-label="本文1ページ目は画像何枚目か"
            value={bodyStart}
            onChange={(event) => {
              setBodyStart(Number(event.target.value) || 1)
              setBodyStartEdited(true)
            }}
          />
          枚目
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={tocPageIds.length === 0}
          onClick={handleParse}
        >
          {chapters.length > 0 ? '目次を解析して置き換える' : '目次を解析'}
        </button>
        {notice && <p role="status">{notice}</p>}
      </div>

      <div className="panel">
        <h2>目次</h2>
        {chapters.length === 0 && <p>目次はまだありません。目次を解析するか、手で追加してください。</p>}
        {chapters.map((chapter, i) => (
          <div key={chapter.id} className="chapters-step__row">
            {thumbnails[chapter.pageId] && (
              <button
                type="button"
                className="chapters-step__thumb-btn"
                aria-label={`章${i + 1}の開始ページを拡大表示`}
                onClick={() => setZoomPageId(chapter.pageId)}
              >
                <img src={thumbnails[chapter.pageId]} alt="" />
              </button>
            )}
            <input
              type="text"
              aria-label={`章${i + 1}のタイトル`}
              value={chapter.title}
              onChange={(event) => updateChapter(chapter.id, { title: event.target.value })}
            />
            <select
              aria-label={`章${i + 1}の開始ページ`}
              value={chapter.pageId}
              onChange={(event) => updateChapter(chapter.id, { pageId: event.target.value }, true)}
            >
              {pages.map((p, pageIndex) => (
                <option key={p.id} value={p.id}>
                  {`${pageIndex + 1}枚目`}
                </option>
              ))}
            </select>
            <select
              aria-label={`章${i + 1}の階層`}
              value={String(chapter.level >= 2 ? 2 : 1)}
              onChange={(event) => updateChapter(chapter.id, { level: Number(event.target.value) })}
            >
              <option value="1">章</option>
              <option value="2">節</option>
            </select>
            <button
              type="button"
              className="btn btn-ghost"
              aria-label={`章${i + 1}を削除`}
              onClick={() => onChange(chapters.filter((c) => c.id !== chapter.id))}
            >
              削除
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost" onClick={addChapter}>
          章を追加
        </button>
      </div>

      {zoomPage && thumbnails[zoomPage.id] && (
        <ZoomModal
          label={zoomPage.fileName ?? `page ${zoomPage.order + 1}`}
          onClose={() => setZoomPageId(null)}
        >
          <img src={thumbnails[zoomPage.id]} alt="" />
        </ZoomModal>
      )}
    </div>
  )
}
