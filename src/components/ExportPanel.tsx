import { useEffect, useState } from 'react'
import { ProgressBar } from './ProgressBar'

type Format = 'pdf' | 'epub'
type Status = 'idle' | 'running' | 'done' | 'error'

interface ExportPanelProps {
  onExport: (
    format: Format,
    onProgress?: (done: number, total: number) => void,
    options?: { embedChapters: boolean },
  ) => Promise<Blob>
  title?: string
  // 目次が1件以上あるときだけ「しおり・目次を埋め込む」を出す。
  chapterCount?: number
}

function sanitizeFileName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '_')
}

export function ExportPanel({ onExport, title, chapterCount = 0 }: ExportPanelProps) {
  const [embedChapters, setEmbedChapters] = useState(true)
  const [format, setFormat] = useState<Format>('pdf')
  const [status, setStatus] = useState<Status>('idle')
  // ファイル名は書き出した時点の形式で付ける(書き出し中に形式を切り替えても食い違わない)。
  const [download, setDownload] = useState<{ url: string; format: Format } | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // 書き出したBlobは数百MBになりうるので、差し替え・破棄のたびにURLを解放する。
  const downloadUrl = download?.url
  useEffect(() => {
    if (!downloadUrl) return
    return () => URL.revokeObjectURL(downloadUrl)
  }, [downloadUrl])

  // 書き出し後に設定を変えたら、古い結果のリンクは消す。残すと、たとえば
  // PDFのBlobが .epub の名前でダウンロードされてしまう。
  function resetResult() {
    if (status === 'running') return
    setStatus('idle')
    setDownload(null)
  }

  // リンクだと本文中のテキストに見えて気づきにくいので、ボタンから一時的な
  // リンクを踏ませて保存する。URLは結果の差し替え・破棄まで保持する(上のeffect)。
  function saveDownload() {
    if (!download) return
    const a = document.createElement('a')
    a.href = download.url
    a.download = `${title && sanitizeFileName(title) ? sanitizeFileName(title) : 'book'}.${download.format}`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function handleExport() {
    setStatus('running')
    setErrorMessage(null)
    setProgress(null)
    const exportedFormat = format
    try {
      const blob = await onExport(exportedFormat, (done, total) => setProgress({ done, total }), {
        embedChapters,
      })
      setDownload({ url: URL.createObjectURL(blob), format: exportedFormat })
      setStatus('done')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatus('error')
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="panel">
      <div className="export-panel__formats">
      <label>
        <input
          type="radio"
          name="format"
          value="pdf"
          checked={format === 'pdf'}
          onChange={() => {
            setFormat('pdf')
            resetResult()
          }}
        />
        PDF
      </label>
      <label>
        <input
          type="radio"
          name="format"
          value="epub"
          checked={format === 'epub'}
          onChange={() => {
            setFormat('epub')
            resetResult()
          }}
        />
        EPUB
      </label>
      </div>
      {chapterCount > 0 && (
        <label className="export-panel__option">
          <input
            type="checkbox"
            checked={embedChapters}
            onChange={(event) => {
              setEmbedChapters(event.target.checked)
              resetResult()
            }}
          />
          しおり・目次を埋め込む
        </label>
      )}
      {/* 設定の横に並ぶと設定の一部に見えるので、書き出しボタンは設定の下に置く。 */}
      <div className="export-panel__actions">
        <button type="button" onClick={handleExport} disabled={status === 'running'}>
          書き出し
        </button>
      </div>
      {status === 'running' &&
        (progress ? (
          <ProgressBar
            done={progress.done}
            total={progress.total}
            label="書き出し中..."
            testId="export-progress"
          />
        ) : (
          <p data-testid="export-progress">生成中...</p>
        ))}
      {status === 'error' && (
        <p data-testid="export-error" className="export-panel__error">
          {errorMessage}
        </p>
      )}
      {status === 'done' && download && (
        <div className="export-panel__actions">
          <button type="button" className="btn btn-primary" onClick={saveDownload}>
            ダウンロード
          </button>
        </div>
      )}
    </div>
  )
}
