import { useRef } from 'react'

interface ImportPanelProps {
  onImport: (files: File[]) => void
  pageCount?: number
  onClearAll?: () => void
}

interface DroppedEntry {
  isFile: boolean
  isDirectory: boolean
}

interface DroppedFileEntry extends DroppedEntry {
  file: (resolve: (file: File) => void) => void
}

interface DroppedDirectoryEntry extends DroppedEntry {
  createReader: () => {
    readEntries: (resolve: (entries: DroppedEntry[]) => void) => void
  }
}

function readDirectoryEntries(entry: DroppedDirectoryEntry): Promise<DroppedEntry[]> {
  return new Promise((resolve) => entry.createReader().readEntries(resolve))
}

function readEntryFile(entry: DroppedFileEntry): Promise<File> {
  return new Promise((resolve) => entry.file(resolve))
}

async function filesFromEntry(entry: DroppedEntry): Promise<File[]> {
  if (entry.isFile) return [await readEntryFile(entry as DroppedFileEntry)]
  if (entry.isDirectory) {
    const entries = await readDirectoryEntries(entry as DroppedDirectoryEntry)
    const files = await Promise.all(entries.map(filesFromEntry))
    return files.flat()
  }
  return []
}

function filterImageFiles(files: File[] | FileList | null): File[] {
  if (!files) return []
  return Array.from(files).filter((file) => file.type.startsWith('image/'))
}

function hasDirectoryEntries(dataTransfer: DataTransfer): boolean {
  const items = dataTransfer.items
  return Boolean(items && items.length > 0 && 'webkitGetAsEntry' in items[0])
}

async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => item.webkitGetAsEntry() as unknown as DroppedEntry | null)
    .filter((entry): entry is DroppedEntry => entry !== null)
  const files = await Promise.all(entries.map(filesFromEntry))
  return files.flat()
}

export function ImportPanel({ onImport, pageCount = 0, onClearAll }: ImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  function handleFileList(fileList: File[] | FileList | null) {
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
        const dataTransfer = event.dataTransfer
        if (hasDirectoryEntries(dataTransfer)) {
          filesFromDataTransfer(dataTransfer).then((files) => handleFileList(files))
        } else {
          handleFileList(dataTransfer.files)
        }
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
