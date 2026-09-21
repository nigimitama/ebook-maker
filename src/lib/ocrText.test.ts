import { describe, it, expect } from 'vitest'
import { buildPlainText } from './ocrText'
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
})
