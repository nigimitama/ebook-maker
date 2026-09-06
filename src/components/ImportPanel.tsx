import { useRef } from 'react'

interface ImportPanelProps {
  onImport: (files: File[]) => void
  pageCount?: number
  onClearAll?: () => void
}

function filterImageFiles(fileList: FileList | null): File[] {
  if (!fileList) return []
  return Array.from(fileList).filter((file) => file.type.startsWith('image/'))
}

export function ImportPanel({ onImport, pageCount = 0, onClearAll }: ImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  function handleFileList(fileList: FileList | null) {
    const files = filterImageFiles(fileList)
    if (files.length > 0) onImport(files)
  }

  return (
    <div
      data-testid="import-dropzone"
      className="dropzone"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        handleFileList(event.dataTransfer.files)
      }}
    >
      <p>画像をドラッグ&ドロップ、またはファイル/フォルダを選択</p>
      {pageCount > 0 && (
        <p className="import-count" data-testid="import-count">
          {pageCount}件登録済み
          {onClearAll && (
            <button
              type="button"
              className="import-count__clear"
              data-testid="clear-all-button"
              onClick={() => {
                if (window.confirm('登録済みのファイルをすべて登録解除しますか？')) onClearAll()
              }}
            >
              すべて登録解除
            </button>
          )}
        </p>
      )}
      <button type="button" onClick={() => fileInputRef.current?.click()}>
        ファイルを選択
      </button>
      <button type="button" onClick={() => folderInputRef.current?.click()}>
        フォルダを選択
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="file-input"
        onChange={(event) => handleFileList(event.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        data-testid="folder-input"
        {...({ webkitdirectory: '' } as Record<string, string>)}
        onChange={(event) => handleFileList(event.target.files)}
      />
    </div>
  )
}
