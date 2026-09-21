import { describe, it, expect } from 'vitest'
import { dragToBox, MIN_DRAG_PX } from './ocrGeometry'

const view = { left: 100, top: 50, width: 200, height: 400 } // 表示px
const size = { width: 1000, height: 2000 } // 原本px(倍率5)

describe('dragToBox', () => {
  it('表示pxのドラッグを原本pxの矩形に変換する', () => {
    expect(dragToBox({ x: 110, y: 60 }, { x: 150, y: 100 }, view, size)).toEqual({
      x: 50,
      y: 50,
      w: 200,
      h: 200,
    })
  })
  it('逆方向のドラッグでも正の幅・高さになる', () => {
    expect(dragToBox({ x: 150, y: 100 }, { x: 110, y: 60 }, view, size)).toEqual({
      x: 50,
      y: 50,
      w: 200,
      h: 200,
    })
  })
  it('画像の外にはみ出した分は切り詰める', () => {
    const box = dragToBox({ x: 50, y: 0 }, { x: 400, y: 600 }, view, size)
    expect(box).toEqual({ x: 0, y: 0, w: 1000, h: 2000 })
  })
  it('小さすぎるドラッグは無視する', () => {
    expect(MIN_DRAG_PX).toBe(8)
    expect(dragToBox({ x: 110, y: 60 }, { x: 117, y: 100 }, view, size)).toBeNull()
    expect(dragToBox({ x: 110, y: 60 }, { x: 150, y: 67 }, view, size)).toBeNull()
  })
  it('表示サイズが0なら null', () => {
    const empty = { left: 0, top: 0, width: 0, height: 0 }
    expect(dragToBox({ x: 0, y: 0 }, { x: 50, y: 50 }, empty, size)).toBeNull()
  })
})
