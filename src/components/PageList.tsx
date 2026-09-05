import { useRef, useState } from 'react'
import type { PageEntry } from '../types'

interface PageListProps {
  pages: PageEntry[]
  thumbnails: Record<string, string>
  selectedPageId: string | null
  onSelect: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  onDelete: (id: string) => void
  onConfirmMerge: (firstId: string, secondId: string) => void
}

export function PageList({
  pages,
  thumbnails,
  selectedPageId,
  onSelect,
  onReorder,
  onDelete,
  onConfirmMerge,
}: PageListProps) {
  const draggedId = useRef<string | null>(null)
  const [mergeMode, setMergeMode] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  function handleDrop(targetId: string) {
    const sourceId = draggedId.current
    draggedId.current = null
    if (!sourceId || sourceId === targetId) return
    const ids = pages.map((p) => p.id)
    const sourceIndex = ids.indexOf(sourceId)
    const targetIndex = ids.indexOf(targetId)
    const withoutSource = ids.filter((id) => id !== sourceId)
    const targetIndexInFiltered = withoutSource.indexOf(targetId)
    const insertAt = sourceIndex < targetIndex ? targetIndexInFiltered + 1 : targetIndexInFiltered
    withoutSource.splice(insertAt, 0, sourceId)
    onReorder(withoutSource)
  }

  function toggleMergeSelection(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      if (current.length >= 2) return current
      return [...current, id]
    })
  }

  function cancelMerge() {
    setMergeMode(false)
    setSelected([])
  }

  return (
    <div>
      <button type="button" onClick={() => (mergeMode ? cancelMerge() : setMergeMode(true))}>
        見開き結合
      </button>

      {mergeMode && selected.length === 2 && (
        <div data-testid="merge-preview" style={{ display: 'flex' }}>
          <img src={thumbnails[selected[0]]} alt="left page" />
          <img src={thumbnails[selected[1]]} alt="right page" />
          <button
            type="button"
            onClick={() => {
              const [first, second] = selected
              onConfirmMerge(first, second)
              cancelMerge()
            }}
          >
            結合を確定
          </button>
          <button type="button" onClick={cancelMerge}>
            キャンセル
          </button>
        </div>
      )}

      <ul>
        {pages.map((page) => (
          <li
            key={page.id}
            data-testid={`page-item-${page.id}`}
            draggable={!mergeMode}
            style={page.id === selectedPageId ? { outline: '2px solid blue' } : undefined}
            onDragStart={() => {
              draggedId.current = page.id
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => handleDrop(page.id)}
          >
            {mergeMode && (
              <input
                type="checkbox"
                data-testid={`merge-checkbox-${page.id}`}
                checked={selected.includes(page.id)}
                disabled={!selected.includes(page.id) && selected.length >= 2}
                onChange={() => toggleMergeSelection(page.id)}
              />
            )}
            <img
              src={thumbnails[page.id]}
              alt={`page ${page.order + 1}`}
              onClick={() => onSelect(page.id)}
            />
            <button type="button" data-testid={`delete-${page.id}`} onClick={() => onDelete(page.id)}>
              削除
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
