import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { applyAdjustment } from '../lib/applyAdjustment'
import { DEFAULT_JPEG_QUALITY } from '../types'
import type { AdjustmentParams, PageEntry, RawImage } from '../types'

// サムネイルは無加工の原本(thumbBlobId)なので、一覧でも調整の効果が一目で
// わかるようCSSフィルタで近似表示する。書き出し時のピクセル演算(applyAdjustment)
// とは別物で、あくまで見た目のプレビュー用。
function adjustmentPreviewStyle(adjustment: AdjustmentParams): CSSProperties {
  const contrastFactor = (100 + adjustment.contrast) / 100
  const brightnessFactor = 1 + adjustment.brightness / 100
  return { filter: `contrast(${contrastFactor}) brightness(${brightnessFactor})` }
}

interface AdjustedPreviewProps {
  image: RawImage
  adjustment: AdjustmentParams
}

// 拡大表示は原本の画素に実際の調整(明るさ・コントラスト・リサイズ)を
// 適用した結果を見せる。書き出し結果に一番近いプレビューにするため。
function AdjustedPreview({ image, adjustment }: AdjustedPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const preview = applyAdjustment(image, adjustment)
    canvas.width = preview.width
    canvas.height = preview.height
    const imageData = new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height)
    ctx.putImageData(imageData, 0, 0)
  }, [image, adjustment])

  return <canvas ref={canvasRef} data-testid="thumb-modal-canvas" className="thumb-modal__canvas" />
}

function resizeLabel(adjustment: AdjustmentParams): string | null {
  if (!adjustment.resizeMode || adjustment.resizeMode === 'none') return null
  if (adjustment.resizeMode === 'width' && adjustment.resizeWidth) {
    return `幅 ${adjustment.resizeWidth}px`
  }
  if (adjustment.resizeMode === 'height' && adjustment.resizeHeight) {
    return `高さ ${adjustment.resizeHeight}px`
  }
  return null
}

function toneLabel(adjustment: AdjustmentParams): string | null {
  if (adjustment.brightness === 0 && adjustment.contrast === 0) return null
  return `明るさ${adjustment.brightness} コントラスト${adjustment.contrast}`
}

function qualityLabel(adjustment: AdjustmentParams): string {
  const quality = adjustment.quality ?? DEFAULT_JPEG_QUALITY
  return `画質 ${quality}`
}

interface PageListProps {
  pages: PageEntry[]
  thumbnails: Record<string, string>
  selectedPageId: string | null
  // 拡大表示(調整反映プレビュー)用。選択中ページの画素がまだ届いていなければ null。
  selectedImage: RawImage | null
  onSelect: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  onDelete: (id: string) => void
  onConfirmMerge: (firstId: string, secondId: string) => void
}

// 削除ボタンを押してから実際にストアへ反映するまでの猶予。この間は
// 「元に戻す」で取り消せる。
const DELETE_UNDO_MS = 5000

type SortMode = 'name-asc' | 'name-desc' | 'custom'

function displayNameOf(page: PageEntry): string {
  return page.fileName ?? `ページ ${page.order + 1}`
}

// localeCompare の numeric オプションは "." を "_" より後ろとして扱う(ICUの
// デフォルト照合順序による、コードポイント順46<95とは逆の結果)ため、
// "scan.jpg" が "scan_001.jpg" より後ろに来てしまう。Windowsエクスプローラーの
// 自然順ソートに合わせるため、数字の並びだけを数値として比較する独自実装を使う。
function compareNatural(a: string, b: string): number {
  const chunksA = a.match(/\d+|\D+/g) ?? []
  const chunksB = b.match(/\d+|\D+/g) ?? []
  const len = Math.min(chunksA.length, chunksB.length)
  for (let i = 0; i < len; i++) {
    const chunkA = chunksA[i]
    const chunkB = chunksB[i]
    if (/^\d+$/.test(chunkA) && /^\d+$/.test(chunkB)) {
      const diff = Number(chunkA) - Number(chunkB)
      if (diff !== 0) return diff
    } else if (chunkA !== chunkB) {
      return chunkA < chunkB ? -1 : 1
    }
  }
  return chunksA.length - chunksB.length
}

function sortIdsByName(pages: PageEntry[], direction: 'asc' | 'desc'): string[] {
  const sorted = [...pages].sort((a, b) => compareNatural(displayNameOf(a), displayNameOf(b)))
  if (direction === 'desc') sorted.reverse()
  return sorted.map((p) => p.id)
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

export function PageList({
  pages,
  thumbnails,
  selectedPageId,
  selectedImage,
  onSelect,
  onReorder,
  onDelete,
  onConfirmMerge,
}: PageListProps) {
  const draggedId = useRef<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('name-asc')
  const didInitialSort = useRef(false)
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

  // ページ一覧を開いた最初の時点で、ファイル名昇順になっていなければ
  // 一度だけ並べ替えて確定する。デフォルトの並び順として仕様が求めるため。
  useEffect(() => {
    if (didInitialSort.current || pages.length === 0) return
    didInitialSort.current = true
    const nameAsc = sortIdsByName(pages, 'asc')
    if (!arraysEqual(
      nameAsc,
      pages.map((p) => p.id),
    )) {
      onReorder(nameAsc)
    }
  }, [pages, onReorder])

  function sortByName(direction: 'asc' | 'desc') {
    setSortMode(direction === 'asc' ? 'name-asc' : 'name-desc')
    onReorder(sortIdsByName(pages, direction))
  }

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
    setSortMode('custom')
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
      <div className="page-list__sort" data-testid="sort-controls">
        <span className="page-list__sort-label" data-testid="sort-status">
          並び順:{' '}
          {sortMode === 'name-asc'
            ? 'ファイル名(昇順)'
            : sortMode === 'name-desc'
              ? 'ファイル名(降順)'
              : '手動'}
        </span>
        <button
          type="button"
          className={sortMode === 'name-asc' ? 'btn-ghost page-row__merge--active' : 'btn-ghost'}
          onClick={() => sortByName('asc')}
        >
          ファイル名昇順
        </button>
        <button
          type="button"
          className={sortMode === 'name-desc' ? 'btn-ghost page-row__merge--active' : 'btn-ghost'}
          onClick={() => sortByName('desc')}
        >
          ファイル名降順
        </button>
      </div>

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
              onClick={() => {
                if (!isPendingDelete) onSelect(page.id)
              }}
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
                      style={adjustmentPreviewStyle(page.adjustment)}
                    />
                  </button>
                  <span className="page-row__name-block">
                    <span className="page-row__name" title={displayName}>
                      {displayName}
                    </span>
                    <span className="page-row__badges">
                      {toneLabel(page.adjustment) && (
                        <span className="page-row__tone-badge" data-testid={`tone-badge-${page.id}`}>
                          {toneLabel(page.adjustment)}
                        </span>
                      )}
                      {resizeLabel(page.adjustment) && (
                        <span className="page-row__resize-badge" data-testid={`resize-badge-${page.id}`}>
                          {resizeLabel(page.adjustment)}
                        </span>
                      )}
                      <span
                        className={
                          (page.adjustment.quality ?? DEFAULT_JPEG_QUALITY) === DEFAULT_JPEG_QUALITY
                            ? 'page-row__quality-badge page-row__quality-badge--default'
                            : 'page-row__quality-badge'
                        }
                        data-testid={`quality-badge-${page.id}`}
                      >
                        {qualityLabel(page.adjustment)}
                      </span>
                    </span>
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
            {previewPage.id === selectedPageId && selectedImage ? (
              <AdjustedPreview image={selectedImage} adjustment={previewPage.adjustment} />
            ) : (
              <img src={thumbnails[previewPage.id]} alt={`page ${previewPage.order + 1} preview`} />
            )}
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
