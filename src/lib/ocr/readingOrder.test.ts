import { describe, it, expect } from 'vitest'
import { sortReadingOrder } from './readingOrder'

const d = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, score: 1, classId: 1 })

describe('sortReadingOrder', () => {
  it('縦書き(細長い行)は右の行から左へ、同じ列なら上から', () => {
    const left = d(10, 0, 20, 300)
    const right = d(100, 0, 20, 300)
    expect(sortReadingOrder([left, right])).toEqual([right, left])
  })
  it('横書き(平たい行)は上の行から下へ、同じ行なら左から', () => {
    const top = d(0, 10, 300, 20)
    const bottom = d(0, 100, 300, 20)
    expect(sortReadingOrder([bottom, top])).toEqual([top, bottom])
  })
  it('空配列は空配列を返す', () => {
    expect(sortReadingOrder([])).toEqual([])
  })
  it('縦書きで列の中心が少しずれていても同じ列として上から読む', () => {
    const colRightLower = d(102, 200, 20, 150) // 中心 112
    const colRightUpper = d(100, 0, 20, 150) // 中心 110(わずかに左)
    const colLeft = d(10, 0, 20, 300)
    expect(sortReadingOrder([colLeft, colRightLower, colRightUpper])).toEqual([
      colRightUpper,
      colRightLower,
      colLeft,
    ])
  })
  it('横書きで行の中心が少しずれていても同じ行として左から読む', () => {
    const rowRight = d(200, 12, 150, 20) // 中心 22
    const rowLeft = d(0, 10, 150, 20) // 中心 20
    const rowBottom = d(0, 100, 300, 20)
    expect(sortReadingOrder([rowBottom, rowRight, rowLeft])).toEqual([rowLeft, rowRight, rowBottom])
  })
})
