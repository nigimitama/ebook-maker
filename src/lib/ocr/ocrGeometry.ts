import type { Box } from './types'

/** これ未満(表示px)のドラッグは枠の追加として扱わない。 */
export const MIN_DRAG_PX = 8

export interface Point {
  x: number
  y: number
}

/** 画像の表示領域(画面上のpx)。getBoundingClientRect の一部。 */
export interface ViewRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 画面上のドラッグ(clientX/Y)を、原本画像のpx座標の矩形に変換する。
 * 画像の外にはみ出した分は切り詰め、小さすぎる・表示サイズが0のときは null。
 */
export function dragToBox(
  start: Point,
  end: Point,
  view: ViewRect,
  original: { width: number; height: number },
): Box | null {
  if (view.width <= 0 || view.height <= 0) return null
  if (Math.abs(end.x - start.x) < MIN_DRAG_PX || Math.abs(end.y - start.y) < MIN_DRAG_PX) return null
  const sx = original.width / view.width
  const sy = original.height / view.height
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v))
  const x1 = clamp((Math.min(start.x, end.x) - view.left) * sx, original.width)
  const x2 = clamp((Math.max(start.x, end.x) - view.left) * sx, original.width)
  const y1 = clamp((Math.min(start.y, end.y) - view.top) * sy, original.height)
  const y2 = clamp((Math.max(start.y, end.y) - view.top) * sy, original.height)
  if (x2 <= x1 || y2 <= y1) return null
  return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) }
}
