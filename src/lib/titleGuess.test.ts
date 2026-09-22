import { describe, expect, it } from 'vitest'
import { guessTitle, lineFontSize, sortByFontSizeDesc } from './titleGuess'
import type { OcrLine, OcrResult } from './ocr/types'

function line(id: string, overrides: Partial<OcrLine> = {}): OcrLine {
  return { id, x: 0, y: 0, w: 10, h: 10, text: `text-${id}`, edited: false, ...overrides }
}

function result(lines: OcrLine[]): OcrResult {
  return { pageId: 'p1', modelVersion: 't', updatedAt: 1, lines }
}

describe('lineFontSize', () => {
  it('returns the shorter side of the bbox regardless of orientation', () => {
    // 横書き想定: 幅が広く高さが文字サイズに近い
    expect(lineFontSize(line('a', { w: 200, h: 24 }))).toBe(24)
    // 縦書き想定: 高さが長く幅が文字サイズに近い
    expect(lineFontSize(line('b', { w: 30, h: 300 }))).toBe(30)
    // 正方形
    expect(lineFontSize(line('c', { w: 40, h: 40 }))).toBe(40)
  })
})

describe('sortByFontSizeDesc', () => {
  it('sorts non-empty lines by font size, largest first', () => {
    const lines = [
      line('small', { w: 100, h: 12, text: '小' }),
      line('large', { w: 100, h: 48, text: '大' }),
      line('mid', { w: 100, h: 24, text: '中' }),
    ]
    const sorted = sortByFontSizeDesc(result(lines))
    expect(sorted.map((l) => l.text)).toEqual(['大', '中', '小'])
  })

  it('drops lines with empty or whitespace-only text', () => {
    const lines = [
      line('empty', { w: 100, h: 999, text: '' }),
      line('blank', { w: 100, h: 999, text: '   ' }),
      line('kept', { w: 100, h: 10, text: '本文' }),
    ]
    expect(sortByFontSizeDesc(result(lines)).map((l) => l.text)).toEqual(['本文'])
  })

  it('is stable (keeps reading order) for equal font sizes', () => {
    const lines = [
      line('first', { w: 100, h: 20, text: '先' }),
      line('second', { w: 20, h: 100, text: '後' }),
    ]
    expect(sortByFontSizeDesc(result(lines)).map((l) => l.text)).toEqual(['先', '後'])
  })

  it('returns an empty array when there is no OCR result', () => {
    expect(sortByFontSizeDesc(undefined)).toEqual([])
  })
})

describe('guessTitle', () => {
  it('picks the text of the largest line', () => {
    const lines = [
      line('sub', { w: 100, h: 14, text: 'サブタイトル' }),
      line('main', { w: 100, h: 60, text: 'メインタイトル' }),
    ]
    expect(guessTitle(result(lines))).toBe('メインタイトル')
  })

  it('returns an empty string when there is nothing to guess from', () => {
    expect(guessTitle(undefined)).toBe('')
    expect(guessTitle(result([]))).toBe('')
  })
})
