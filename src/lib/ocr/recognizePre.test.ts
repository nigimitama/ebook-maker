import { describe, it, expect } from 'vitest'
import { cropLine, lineToTensor } from './recognizePre'
import type { RawImage } from '../../types'

// 各画素のR値に通し番号(0,1,2,...)を入れた画像
function numbered(width: number, height: number): RawImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = i
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}
const reds = (img: RawImage) => Array.from({ length: img.width * img.height }, (_, i) => img.data[i * 4])

describe('cropLine', () => {
  it('横長の箱はそのまま切り出す', () => {
    const out = cropLine(numbered(4, 3), { x: 1, y: 1, w: 3, h: 2 })
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
    expect(reds(out)).toEqual([5, 6, 7, 9, 10, 11])
  })
  it('範囲外にはみ出る箱は画像内にクランプする', () => {
    const out = cropLine(numbered(4, 3), { x: -5, y: 1, w: 7, h: 100 })
    // x: -5..2 -> 0..2, y: 1..101 -> 1..3
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    expect(reds(out)).toEqual([4, 5, 8, 9])
  })
  it('縦長(h>w)は反時計回りに90度回転して横長にする', () => {
    // 切り出し 2x3(w=2,h=3): 行 [0,1] [4,5] [8,9]
    const out = cropLine(numbered(4, 3), { x: 0, y: 0, w: 2, h: 3 })
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
    // 反時計回り: 右上(1)が左上へ、右下(9)が左下へ
    expect(reds(out)).toEqual([1, 5, 9, 0, 4, 8])
  })
  it('画像外に完全に出た箱でも1x1以上を返す', () => {
    const out = cropLine(numbered(4, 3), { x: 100, y: 100, w: 5, h: 5 })
    expect(out.width).toBeGreaterThanOrEqual(1)
    expect(out.height).toBeGreaterThanOrEqual(1)
  })
})

describe('lineToTensor', () => {
  it('指定H×WにリサイズしNCHWで[-1,1]に正規化する', () => {
    const line: RawImage = { data: new Uint8ClampedArray([0, 255, 128, 255]), width: 1, height: 1 }
    const t = lineToTensor(line, 2, 3)
    expect(t).toBeInstanceOf(Float32Array)
    expect(t.length).toBe(3 * 2 * 3)
    expect(t[0]).toBeCloseTo(-1, 5) // R=0
    expect(t[6]).toBeCloseTo(1, 5) // G面の先頭 G=255
    expect(t[12]).toBeCloseTo(2 * (128 / 255 - 0.5), 5) // B面
  })
})
