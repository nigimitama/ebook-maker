import { useRef } from 'react'

interface ImportPanelProps {
  onImport: (files: File[]) => void
  pageCount?: number
  onClearAll?: () => void
}

interface FileSystemEntry {
  isFile: boolean
  isDirectory: boolean
}

interface FileSystemFileEntry extends FileSystemEntry {
  file: (resolve: (file: File) => void) => void
}

interface FileSystemDirectoryEntry extends FileSystemEntry {
  createReader: () => {
    readEntries: (resolve: (entries: FileSystemEntry[]) => void) => void
  }
}

function readDirectoryEntries(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => entry.createReader().readEntries(resolve))
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve) => entry.file(resolve))
}

async function filesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) return [await readEntryFile(entry as FileSystemFileEntry)]
  if (entry.isDirectory) {
    const entries = await readDirectoryEntries(entry as FileSystemDirectoryEntry)
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
    .map((item) => (item as DataTransferItem & { webkitGetAsEntry: () => FileSystemEntry | null }).webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null)
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
