import { useState } from 'react'
import { ProgressBar } from './ProgressBar'

type Format = 'pdf' | 'epub'
type Status = 'idle' | 'running' | 'done' | 'error'

interface ExportPanelProps {
  onExport: (format: Format, onProgress?: (done: number, total: number) => void) => Promise<Blob>
}

export function ExportPanel({ onExport }: ExportPanelProps) {
  const [format, setFormat] = useState<Format>('pdf')
  const [status, setStatus] = useState<Status>('idle')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  async function handleExport() {
    setStatus('running')
    setErrorMessage(null)
    setProgress(null)
    try {
      const blob = await onExport(format, (done, total) => setProgress({ done, total }))
      setDownloadUrl(URL.createObjectURL(blob))
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
          onChange={() => setFormat('pdf')}
        />
        PDF
      </label>
      <label>
        <input
          type="radio"
          name="format"
          value="epub"
          checked={format === 'epub'}
          onChange={() => setFormat('epub')}
        />
        EPUB
      </label>
      </div>
      <button type="button" onClick={handleExport} disabled={status === 'running'}>
        書き出し
      </button>
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
      {status === 'done' && downloadUrl && (
        <a
          href={downloadUrl}
          download={format === 'pdf' ? 'book.pdf' : 'book.epub'}
          data-testid="download-link"
        >
          ダウンロード
        </a>
      )}
    </div>
  )
}
