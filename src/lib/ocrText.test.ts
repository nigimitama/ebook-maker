import { describe, it, expect } from 'vitest'
import { buildPlainText, ocrFileName, hasOcrText } from './ocrText'
import type { OcrResult } from './ocr/types'

const line = (id: string, text: string) => ({ id, x: 0, y: 0, w: 1, h: 1, text, edited: false })
const res = (pageId: string, texts: string[]): OcrResult => ({
  pageId,
  modelVersion: 'v',
  updatedAt: 1,
  lines: texts.map((t, i) => line(`${pageId}${i}`, t)),
})

describe('buildPlainText', () => {
  it('ページ順に行を改行で連結し、ページ間は空行、未OCRと空行は飛ばす', () => {
    const pages = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]
    const results = { a: res('a', ['一行目', '二行目']), c: res('c', ['三', '', '四']) }
    expect(buildPlainText(pages, results)).toBe('一行目\n二行目\n\n三\n四')
  })

  it('結果が無ければ空文字', () => {
    expect(buildPlainText([{ id: 'a' }], {})).toBe('')
  })

  it('同じブロックの行は改行を入れずに連結する', () => {
    const withBlock: OcrResult = {
      pageId: 'a',
      modelVersion: 'v',
      updatedAt: 1,
      lines: [
        { id: 'a0', x: 0, y: 0, w: 1, h: 1, text: '吾輩は猫である。名前はまだ', edited: false, blockId: 'b1' },
        { id: 'a1', x: 0, y: 0, w: 1, h: 1, text: '無い。', edited: false, blockId: 'b1' },
      ],
    }
    expect(buildPlainText([{ id: 'a' }], { a: withBlock })).toBe('吾輩は猫である。名前はまだ無い。')
  })
})

describe('buildPlainText: 全行が空のページ', () => {
  it('空行だけのページは区切りの空行も出さない', () => {
    const pages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const results = { a: res('a', ['あ']), b: res('b', ['', '']), c: res('c', ['い']) }
    expect(buildPlainText(pages, results)).toBe('あ\n\nい')
  })
})

describe('hasOcrText', () => {
  it('空でない行が1つも無ければ false', () => {
    const pages = [{ id: 'a' }]
    expect(hasOcrText(pages, { a: res('a', ['', '']) })).toBe(false)
    expect(hasOcrText(pages, {})).toBe(false)
    expect(hasOcrText(pages, { a: res('a', ['', 'x']) })).toBe(true)
  })
})

describe('ocrFileName', () => {
  it.each([
    ['a\\b', 'a_b.txt'],
    ['a/b', 'a_b.txt'],
    ['a:b?', 'a_b_.txt'],
    ['a\u0001b\u001fc', 'a_b_c.txt'],
    ['..', 'ocr.txt'],
    ['.', 'ocr.txt'],
    ['   ', 'ocr.txt'],
    ['', 'ocr.txt'],
    [undefined, 'ocr.txt'],
    ['我輩は猫', '我輩は猫.txt'],
  ])('%j -> %s', (input, expected) => {
    expect(ocrFileName(input)).toBe(expected)
  })
})
