import { useEffect, useRef, useState } from 'react'
import { dragToBox, type Point } from '../lib/ocr/ocrGeometry'
import type { Box, OcrLine } from '../lib/ocr/types'
import type { RawImage } from '../types'

interface OcrOverlayProps {
  image: RawImage | null
  /** 原本画像のpxサイズ。枠の座標はこの基準。 */
  originalWidth: number
  originalHeight: number
  lines: OcrLine[]
  selectedLineId: string | null
  onSelectLine: (id: string) => void
  addMode: boolean
  onAddBox: (box: Box) => void
}

// 画像(canvas)の上に、行の枠を原本px基準の割合(%)で重ねる。表示サイズに依らず
// 位置が合い、canvasが使えない環境(テスト)でも枠は描画される。
export function OcrOverlay({
  image,
  originalWidth,
  originalHeight,
  lines,
  selectedLineId,
  onSelectLine,
  addMode,
  onAddBox,
}: OcrOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<Point | null>(null)
  const [draft, setDraft] = useState<{ a: Point; b: Point; left: number; top: number; width: number; height: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = image.width
    canvas.height = image.height
    ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  }, [image])

  useEffect(() => {
    if (!addMode) {
      dragStart.current = null
      setDraft(null)
    }
  }, [addMode])

  const dragging = draft !== null
  useEffect(() => {
    if (!dragging) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelDrag()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dragging])

  function cancelDrag() {
    dragStart.current = null
    setDraft(null)
  }

  function pointOf(event: React.PointerEvent): Point {
    return { x: event.clientX, y: event.clientY }
  }

  function finish(event: React.PointerEvent) {
    const start = dragStart.current
    dragStart.current = null
    setDraft(null)
    areaRef.current?.releasePointerCapture?.(event.pointerId)
    const area = areaRef.current
    if (!start || !area) return
    const rect = area.getBoundingClientRect()
    const box = dragToBox(start, pointOf(event), rect, {
      width: originalWidth,
      height: originalHeight,
    })
    if (box) onAddBox(box)
  }

  const pct = (v: number, total: number) => `${(v / total) * 100}%`
  const draftStyle = (() => {
    if (!draft) return null
    const cx = (v: number) => Math.min(draft.width, Math.max(0, v - draft.left))
    const cy = (v: number) => Math.min(draft.height, Math.max(0, v - draft.top))
    const x1 = cx(draft.a.x)
    const x2 = cx(draft.b.x)
    const y1 = cy(draft.a.y)
    const y2 = cy(draft.b.y)
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
  })()

  return (
    <div
      ref={areaRef}
      className={addMode ? 'ocr-stage ocr-stage--adding' : 'ocr-stage'}
      data-testid="ocr-draw-area"
      style={{ aspectRatio: `${originalWidth} / ${originalHeight}` }}
      onPointerDown={(event) => {
        if (!addMode) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        const p = pointOf(event)
        const rect = event.currentTarget.getBoundingClientRect()
        dragStart.current = p
        setDraft({ a: p, b: p, left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      }}
      onPointerMove={(event) => {
        if (!dragStart.current) return
        setDraft((d) => (d ? { ...d, b: pointOf(event) } : d))
      }}
      onPointerUp={finish}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={cancelDrag}
    >
      <canvas ref={canvasRef} className="ocr-stage__canvas" aria-label="ページ画像" />
      {lines.map((line, index) => (
        <button
          key={line.id}
          type="button"
          className={line.id === selectedLineId ? 'ocr-box ocr-box--selected' : 'ocr-box'}
          data-testid={`ocr-box-${line.id}`}
          aria-label={`行${index + 1}の枠`}
          aria-current={line.id === selectedLineId ? 'true' : undefined}
          style={{
            left: pct(line.x, originalWidth),
            top: pct(line.y, originalHeight),
            width: pct(line.w, originalWidth),
            height: pct(line.h, originalHeight),
            pointerEvents: addMode ? 'none' : undefined,
          }}
          onClick={() => onSelectLine(line.id)}
        />
      ))}
      {draftStyle && <div className="ocr-box ocr-box--draft" style={draftStyle} />}
    </div>
  )
}
