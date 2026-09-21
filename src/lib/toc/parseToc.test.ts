import { describe, it, expect } from 'vitest'
import type { OcrResult } from '../ocr/types'
import { defaultBodyStartIndex, entriesToChapters, parseToc, parseTocEntries } from './parseToc'

function result(pageId: string, texts: string[]): OcrResult {
  return {
    pageId,
    modelVersion: 't',
    updatedAt: 1,
    lines: texts.map((text, i) => ({ id: `${pageId}-${i}`, x: 0, y: i * 10, w: 10, h: 10, text, edited: false })),
  }
}

describe('parseTocEntries', () => {
  it('reads dotted-leader lines', () => {
    expect(parseTocEntries(['第1章 はじめに ........ 3', '第2章 手法 ........ 25'])).toEqual([
      { title: '第1章 はじめに', printedPage: 3, level: 1 },
      { title: '第2章 手法', printedPage: 25, level: 1 },
    ])
  })

  it('normalizes full-width digits and ellipsis leaders', () => {
    expect(parseTocEntries(['第１章　はじめに………１２'])).toEqual([
      { title: '第1章 はじめに', printedPage: 12, level: 1 },
    ])
  })

  it('reads lines without leaders', () => {
    expect(parseTocEntries(['序章 出発 7'])).toEqual([
      { title: '序章 出発', printedPage: 7, level: 1 },
    ])
  })

  it('joins a title line with the following number-only line', () => {
    expect(parseTocEntries(['第3章 結果と考察', '48'])).toEqual([
      { title: '第3章 結果と考察', printedPage: 48, level: 1 },
    ])
  })

  it('detects level 2 for numbered sections', () => {
    const entries = parseTocEntries(['第1章 概要 ..... 3', '1.1 背景 ..... 4', '1-2 目的 ..... 6', '(1) 補足 ..... 7'])
    expect(entries.map((e) => e.level)).toEqual([1, 2, 2, 2])
  })

  it('treats "1. Title" as level 1 and unknown titles as level 1', () => {
    const entries = parseTocEntries(['1. Intro ..... 3', 'あとがき ..... 300'])
    expect(entries.map((e) => e.level)).toEqual([1, 1])
  })

  it('keeps roman numeral prefixes as level 1 titles', () => {
    expect(parseTocEntries(['Ⅰ 総論 ..... 9'])).toEqual([{ title: 'I 総論', printedPage: 9, level: 1 }])
  })

  it('ignores headers, bare headings and lines ending in a roman page number', () => {
    expect(parseTocEntries(['目次', 'Chapter 3', '序文 iv', '第1章 はじめに ..... 3'])).toEqual([
      { title: '第1章 はじめに', printedPage: 3, level: 1 },
    ])
  })

  it('ignores page number 0 and numbers of more than 4 digits', () => {
    expect(parseTocEntries(['付録 ..... 0', '年表 ..... 12345'])).toEqual([])
  })
})

describe('entriesToChapters', () => {
  const pageIds = ['p0', 'p1', 'p2', 'p3', 'p4']
  const entries = [
    { title: 'A', printedPage: 1, level: 1 as const },
    { title: 'B', printedPage: 3, level: 2 as const },
  ]

  it('converts printed pages using the body start index', () => {
    const chapters = entriesToChapters(entries, pageIds, 1)
    expect(chapters.map((c) => [c.title, c.pageId, c.level])).toEqual([
      ['A', 'p1', 1],
      ['B', 'p3', 2],
    ])
    expect(new Set(chapters.map((c) => c.id)).size).toBe(2)
  })

  it('clamps out-of-range pages to the first and last page', () => {
    const chapters = entriesToChapters([{ title: 'Z', printedPage: 99, level: 1 }], pageIds, 1)
    expect(chapters[0].pageId).toBe('p4')
    const early = entriesToChapters(entries, pageIds, -5)
    expect(early[0].pageId).toBe('p0')
  })

  it('returns nothing when there are no pages', () => {
    expect(entriesToChapters(entries, [], 0)).toEqual([])
  })
})

describe('defaultBodyStartIndex', () => {
  const pageIds = ['p0', 'p1', 'p2', 'p3']
  it('is the page after the last toc page', () => {
    expect(defaultBodyStartIndex(pageIds, ['p1', 'p0'])).toBe(2)
  })
  it('clamps to the last page and falls back to 0 without toc pages', () => {
    expect(defaultBodyStartIndex(pageIds, ['p3'])).toBe(3)
    expect(defaultBodyStartIndex(pageIds, [])).toBe(0)
  })
})

describe('parseToc', () => {
  it('reads the toc pages in book order and converts to chapters', () => {
    const pageIds = ['t1', 't2', 'b1', 'b2', 'b3']
    const results = {
      t2: result('t2', ['第2章 手法 ..... 2']),
      t1: result('t1', ['目次', '第1章 はじめに ..... 1']),
    }
    const chapters = parseToc(['t2', 't1'], results, pageIds, 2)
    expect(chapters.map((c) => [c.title, c.pageId])).toEqual([
      ['第1章 はじめに', 'b1'],
      ['第2章 手法', 'b2'],
    ])
  })

  it('skips toc pages that have no OCR result', () => {
    expect(parseToc(['t1'], {}, ['t1', 'b1'], 1)).toEqual([])
  })
})
