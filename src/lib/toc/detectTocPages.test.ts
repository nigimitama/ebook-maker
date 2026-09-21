import { describe, it, expect } from 'vitest'
import type { OcrResult } from '../ocr/types'
import { detectTocPages, tocScanWindow } from './detectTocPages'

function result(pageId: string, texts: string[]): OcrResult {
  return {
    pageId,
    modelVersion: 't',
    updatedAt: 1,
    lines: texts.map((text, i) => ({ id: `${pageId}-${i}`, x: 0, y: i, w: 1, h: 1, text, edited: false })),
  }
}

const tocLines = [
  '目次',
  '第1章 はじめに ........ 3',
  '第2章 背景 ........ 15',
  '第3章 手法 ........ 31',
  '第4章 結果 ........ 52',
  '第5章 議論 ........ 70',
]
const proseLines = [
  'これは本文の段落です。',
  '吾輩は猫である。名前はまだ無い。',
  'どこで生れたかとんと見当がつかぬ。',
  '何でも薄暗いじめじめした所で泣いていた。',
  '12',
]

describe('tocScanWindow', () => {
  it('is 30% of the pages, capped at 40', () => {
    expect(tocScanWindow(10)).toBe(3)
    expect(tocScanWindow(100)).toBe(30)
    expect(tocScanWindow(500)).toBe(40)
  })
})

describe('detectTocPages', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `p${i}`)

  it('finds a single toc page among prose pages', () => {
    const results = {
      p0: result('p0', proseLines),
      p1: result('p1', tocLines),
      p2: result('p2', proseLines),
    }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p1'])
  })

  it('groups a toc spanning several pages, including a short last page', () => {
    const results = {
      p0: result('p0', tocLines),
      p1: result('p1', tocLines.slice(1)),
      p2: result('p2', ['付録 ........ 90', '索引 ........ 95', '奥付 ........ 99']),
      p3: result('p3', proseLines),
    }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p0', 'p1', 'p2'])
  })

  it('detects a toc page without the heading keyword', () => {
    const results = { p1: result('p1', tocLines.slice(1)) }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p1'])
  })

  it('returns nothing for a book without a toc', () => {
    const results = { p0: result('p0', proseLines), p1: result('p1', proseLines) }
    expect(detectTocPages(ids, results).pageIds).toEqual([])
  })

  it('ignores toc-like pages beyond the scan window', () => {
    const results = { p5: result('p5', tocLines) }
    expect(detectTocPages(ids, results).pageIds).toEqual([])
  })

  it('reports pages inside the window that have no OCR result yet', () => {
    const results = { p0: result('p0', proseLines) }
    expect(detectTocPages(ids, results).unscannedPageIds).toEqual(['p1', 'p2'])
  })

  it('returns only the first block', () => {
    const results = {
      p0: result('p0', tocLines),
      p1: result('p1', proseLines),
      p2: result('p2', tocLines),
    }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p0'])
  })
})
