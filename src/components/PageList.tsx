import { useEffect, useRef, useState } from 'react'
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

// 削除ボタンを押してから実際にストアへ反映するまでの猶予。この間は
// 「元に戻す」で取り消せる。
const DELETE_UNDO_MS = 5000

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
  const [mergeSelection, setMergeSelection] = useState<string[]>([])
  const [previewPageId, setPreviewPageId] = useState<string | null>(null)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([])
  const deleteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const onDeleteRef = useRef(onDelete)
  useEffect(() => {
    onDeleteRef.current = onDelete
  }, [onDelete])

  // 画面を離れる(工程切り替えなど)ときは、待機中の削除を待たせず確定する。
  // タイマーだけ残して部品がアンマウントされると、戻ってきたときの状態と
  // 齟齬が起きるため。onDelete は参照が変わりやすい(deletePage の依存に
  // selectedPageId を含む)ので ref 経由で読み、effect 自体は一度だけ登録する。
  useEffect(() => {
    const timers = deleteTimers.current
    return () => {
      for (const [id, timer] of timers) {
        clearTimeout(timer)
        onDeleteRef.current(id)
      }
      timers.clear()
    }
  }, [])

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
    setMergeSelection((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      if (current.length >= 2) return [current[1], id]
      return [...current, id]
    })
  }

  function cancelMerge() {
    setMergeSelection([])
  }

  function confirmMerge() {
    const [first, second] = mergeSelection
    onConfirmMerge(first, second)
    cancelMerge()
  }

  function requestDelete(id: string) {
    setPendingDeleteIds((current) => [...current, id])
    const timer = setTimeout(() => {
      deleteTimers.current.delete(id)
      setPendingDeleteIds((current) => current.filter((x) => x !== id))
      onDelete(id)
    }, DELETE_UNDO_MS)
    deleteTimers.current.set(id, timer)
  }

  function undoDelete(id: string) {
    const timer = deleteTimers.current.get(id)
    if (timer) clearTimeout(timer)
    deleteTimers.current.delete(id)
    setPendingDeleteIds((current) => current.filter((x) => x !== id))
  }

  useEffect(() => {
    if (!previewPageId) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPreviewPageId(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewPageId])

  const previewPage = pages.find((p) => p.id === previewPageId) ?? null

  return (
    <div className="panel">
      {mergeSelection.length === 2 && (
        <div data-testid="merge-preview" className="merge-preview">
          <img src={thumbnails[mergeSelection[0]]} alt="left page" />
          <img src={thumbnails[mergeSelection[1]]} alt="right page" />
          <button type="button" onClick={confirmMerge}>
            結合を確定
          </button>
          <button type="button" className="btn-ghost" onClick={cancelMerge}>
            キャンセル
          </button>
        </div>
      )}

      <ul className="page-list__items">
        {pages.map((page) => {
          const isPendingDelete = pendingDeleteIds.includes(page.id)
          const mergeRank = mergeSelection.indexOf(page.id)
          const displayName = page.fileName ?? `ページ ${page.order + 1}`
          return (
            <li
              key={page.id}
              data-testid={`page-item-${page.id}`}
              draggable={!isPendingDelete}
              className={
                page.id === selectedPageId
                  ? 'page-row page-row--selected'
                  : isPendingDelete
                    ? 'page-row page-row--pending-delete'
                    : 'page-row'
              }
              onDragStart={() => {
                draggedId.current = page.id
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleDrop(page.id)}
            >
              {isPendingDelete ? (
                <>
                  <span className="page-row__removed-label">「{displayName}」を削除しました</span>
                  <button type="button" className="btn-ghost" onClick={() => undoDelete(page.id)}>
                    元に戻す
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="page-row__thumb-btn"
                    onClick={() => {
                      onSelect(page.id)
                      setPreviewPageId(page.id)
                    }}
                    aria-label={`${displayName}を拡大表示`}
                  >
                    <img
                      src={thumbnails[page.id]}
                      alt={`page ${page.order + 1}`}
                      className="page-list__thumb"
                    />
                  </button>
                  <span className="page-row__name" title={displayName}>
                    {displayName}
                  </span>
                  <div className="page-row__actions">
                    <button
                      type="button"
                      className={mergeRank >= 0 ? 'btn-ghost page-row__merge--active' : 'btn-ghost'}
                      onClick={() => toggleMergeSelection(page.id)}
                    >
                      {mergeRank >= 0 ? `見開き結合(${mergeRank + 1}/2)` : '見開き結合'}
                    </button>
                    <button
                      type="button"
                      data-testid={`delete-${page.id}`}
                      className="btn-ghost"
                      onClick={() => requestDelete(page.id)}
                    >
                      削除
                    </button>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>

      {previewPage && (
        <div
          className="thumb-modal"
          role="dialog"
          aria-modal="true"
          aria-label={previewPage.fileName ?? `page ${previewPage.order + 1}`}
          onClick={() => setPreviewPageId(null)}
        >
          <div className="thumb-modal__frame" onClick={(event) => event.stopPropagation()}>
            <img src={thumbnails[previewPage.id]} alt={`page ${previewPage.order + 1} preview`} />
            <button
              type="button"
              className="thumb-modal__close"
              onClick={() => setPreviewPageId(null)}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
