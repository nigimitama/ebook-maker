import { useRef } from 'react'
import { ProgressBar } from './ProgressBar'

interface ImportPanelProps {
  onImport: (files: File[]) => void
  pageCount?: number
  onClearAll?: () => void
  canUndoClearAll?: boolean
  onUndoClearAll?: () => void
  importProgress?: { done: number; total: number } | null
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

function readEntriesBatch(
  reader: { readEntries: (resolve: (entries: DroppedEntry[]) => void) => void },
): Promise<DroppedEntry[]> {
  return new Promise((resolve) => reader.readEntries(resolve))
}

// readEntries は仕様上1回の呼び出しで返せる件数に上限があり(Chromeの実装では
// 100件)、空配列が返るまで呼び直さないと100件を超えるフォルダの中身を
// 取りこぼす。
async function readDirectoryEntries(entry: DroppedDirectoryEntry): Promise<DroppedEntry[]> {
  const reader = entry.createReader()
  const all: DroppedEntry[] = []
  while (true) {
    const batch = await readEntriesBatch(reader)
    if (batch.length === 0) break
    all.push(...batch)
  }
  return all
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

export function ImportPanel({
  onImport,
  pageCount = 0,
  onClearAll,
  canUndoClearAll = false,
  onUndoClearAll,
  importProgress,
}: ImportPanelProps) {
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
      {importProgress && (
        <ProgressBar
          done={importProgress.done}
          total={importProgress.total}
          label="読み込み中..."
          testId="import-progress"
        />
      )}
      {pageCount > 0 && (
        <p className="import-count" data-testid="import-count">
          {pageCount}件登録済み
          {onClearAll && (
            <button
              type="button"
              className="import-count__clear"
              data-testid="clear-all-button"
              onClick={() => onClearAll()}
            >
              すべて登録解除
            </button>
          )}
        </p>
      )}
      {canUndoClearAll && onUndoClearAll && (
        <p className="import-count" data-testid="undo-clear-all">
          <button
            type="button"
            className="import-count__undo"
            data-testid="undo-clear-all-button"
            onClick={() => onUndoClearAll()}
          >
            もとに戻す
          </button>
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
