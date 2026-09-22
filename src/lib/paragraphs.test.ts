import { describe, it, expect } from 'vitest'
import { buildParagraphs } from './paragraphs'
import type { OcrLine } from './ocr/types'

function line(id: string, text: string, blockId?: string): OcrLine {
  return { id, x: 0, y: 0, w: 1, h: 1, text, edited: false, ...(blockId ? { blockId } : {}) }
}

describe('buildParagraphs', () => {
  it('同じblockIdの行を読み順に空文字連結して1段落にする', () => {
    const lines = [line('a', '吾輩は猫である。名前はまだ', 'b1'), line('b', '無い。', 'b1')]
    expect(buildParagraphs(lines)).toEqual([
      { id: 'a', text: '吾輩は猫である。名前はまだ無い。', lines },
    ])
  })

  it('blockIdが無い行はそれぞれ独立した段落にする', () => {
    const lines = [line('a', '一行目'), line('b', '二行目')]
    expect(buildParagraphs(lines)).toEqual([
      { id: 'a', text: '一行目', lines: [lines[0]] },
      { id: 'b', text: '二行目', lines: [lines[1]] },
    ])
  })

  it('段落の並びは各グループの先頭行が現れる位置で決まる', () => {
    const lines = [line('a', 'A', 'b1'), line('x', 'X'), line('b', 'B', 'b1')]
    const result = buildParagraphs(lines)
    expect(result.map((p) => p.id)).toEqual(['a', 'x'])
    expect(result[0].text).toBe('AB')
    expect(result[0].lines).toEqual([lines[0], lines[2]])
  })

  it('行が空配列なら空配列を返す', () => {
    expect(buildParagraphs([])).toEqual([])
  })
})
