import { describe, it, expect } from 'vitest'
import type { RawImage } from '../../types'
import { trailingNumberText, trailingSplitCandidates } from './trailingNumber'

// 白地の画像に、黒(または指定の明るさ)の矩形を描く。
function page(width: number, height: number, rects: [number, number, number, number][], ink = 0): RawImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (const [x, y, w, h] of rects) {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        const i = (yy * width + xx) * 4
        data[i] = data[i + 1] = data[i + 2] = ink
      }
    }
  }
  return { data, width, height }
}

// 幅30の縦書きの行(x=10..40)。字は24x24で、字間は6。
const LINE = { x: 10, y: 0, w: 30, h: 400 }
function glyphs(count: number, top = 4): [number, number, number, number][] {
  return Array.from({ length: count }, (_, i) => [13, top + i * 30, 24, 24] as [number, number, number, number])
}
const LAST_GLYPH_END = 4 + 5 * 30 + 24 // 6字目の下端(=178)

describe('trailingSplitCandidates', () => {
  it('横長の行は対象にしない', () => {
    const img = page(400, 60, [[10, 10, 300, 30]])
    expect(trailingSplitCandidates(img, { x: 0, y: 0, w: 400, h: 60 })).toEqual([])
  })

  it('字間が均等な本文の行は切らない', () => {
    const img = page(60, 400, glyphs(12))
    expect(trailingSplitCandidates(img, LINE)).toEqual([])
  })

  it('明暗差がない行は解析しない', () => {
    const img = page(60, 400, [...glyphs(6), [16, 230, 18, 12]], 230)
    expect(trailingSplitCandidates(img, LINE)).toEqual([])
  })

  it('大きく空いた後の末尾の短い部分(横組みのページ番号)を切り分ける', () => {
    // 6字の後、52px空けて 18x12 の番号。
    const img = page(60, 400, [...glyphs(6), [16, 230, 18, 12]])
    const [split, ...rest] = trailingSplitCandidates(img, LINE)
    expect(rest).toEqual([])
    // 本体は最後の字の下端(+余白)まで、番号の箱はインクに合わせて狭める。
    expect(split.head).toEqual({ x: 10, y: 0, w: 30, h: LAST_GLYPH_END + 2 })
    expect(split.tail).toEqual({ x: 14, y: 228, w: 22, h: 16 })
  })

  it('章名と番号の間の細い罫線は番号に含めない', () => {
    const img = page(60, 400, [...glyphs(6), [25, 200, 1, 12], [25, 216, 1, 12], [16, 234, 18, 12]])
    const [split] = trailingSplitCandidates(img, LINE)
    expect(split.head.h).toBe(LAST_GLYPH_END + 2)
    expect(split.tail.y).toBe(232)
  })

  it('末尾部分が長い候補から順に返す(漢数字「二一」を「一」だけで切らない)', () => {
    // 6字の後、40px空けて「二」(2画)、さらに16px空けて「一」。
    const img = page(60, 400, [...glyphs(6), [16, 218, 18, 3], [14, 230, 22, 3], [14, 249, 22, 3]])
    const candidates = trailingSplitCandidates(img, LINE)
    const ys = candidates.map((c) => c.tail.y)
    expect(ys[0]).toBe(216)
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    expect(ys).toContain(247)
  })

  it('末尾部分が長すぎる(行の幅の3.5倍超)なら候補にしない', () => {
    const img = page(60, 400, [...glyphs(4), ...glyphs(4, 200)])
    expect(trailingSplitCandidates(img, LINE)).toEqual([])
  })
})

describe('trailingNumberText', () => {
  it('算用数字・漢数字だけの文字列を採る', () => {
    expect(trailingNumberText('62')).toBe('62')
    expect(trailingNumberText('004')).toBe('004')
    expect(trailingNumberText('１５')).toBe('15')
    expect(trailingNumberText('二一')).toBe('二一')
  })

  it('数字以外を含む・長すぎる文字列は採らない', () => {
    expect(trailingNumberText('a')).toBeNull()
    expect(trailingNumberText('---')).toBeNull()
    expect(trailingNumberText('$35')).toBeNull()
    expect(trailingNumberText('発端')).toBeNull()
    expect(trailingNumberText('12345')).toBeNull()
    expect(trailingNumberText('')).toBeNull()
  })
})
