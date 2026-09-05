import { useState } from 'react'

type Format = 'pdf' | 'epub'
type Status = 'idle' | 'running' | 'done' | 'error'

interface ExportPanelProps {
  onExport: (format: Format) => Promise<Blob>
}

export function ExportPanel({ onExport }: ExportPanelProps) {
  const [format, setFormat] = useState<Format>('pdf')
  const [status, setStatus] = useState<Status>('idle')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleExport() {
    setStatus('running')
    setErrorMessage(null)
    try {
      const blob = await onExport(format)
      setDownloadUrl(URL.createObjectURL(blob))
      setStatus('done')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatus('error')
    }
  }

  return (
    <div>
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
      <button type="button" onClick={handleExport} disabled={status === 'running'}>
        書き出し
      </button>
      {status === 'running' && <p data-testid="export-progress">生成中...</p>}
      {status === 'error' && <p data-testid="export-error">{errorMessage}</p>}
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
