import { describe, it, expect } from 'vitest'
import { buildParagraphs } from './paragraphs'
import type { OcrLine } from './ocr/types'

function line(
  id: string,
  text: string,
  blockId?: string,
  box: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 1, h: 1 },
): OcrLine {
  return { id, ...box, text, edited: false, ...(blockId ? { blockId } : {}) }
}

describe('buildParagraphs', () => {
  it('同じblockIdの行を読み順に空文字連結して1段落にする', () => {
    const lines = [line('a', '吾輩は猫である。名前はまだ', 'b1'), line('b', '無い。', 'b1')]
    expect(buildParagraphs(lines)).toEqual([
      { id: 'a', text: '吾輩は猫である。名前はまだ無い。', lines, box: { x: 0, y: 0, w: 1, h: 1 } },
    ])
  })

  it('blockIdが無い行はそれぞれ独立した段落にする', () => {
    const lines = [line('a', '一行目'), line('b', '二行目')]
    expect(buildParagraphs(lines)).toEqual([
      { id: 'a', text: '一行目', lines: [lines[0]], box: { x: 0, y: 0, w: 1, h: 1 } },
      { id: 'b', text: '二行目', lines: [lines[1]], box: { x: 0, y: 0, w: 1, h: 1 } },
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

  it('段落のboxは所属する行の外接矩形になる', () => {
    const lines = [
      line('a', 'A', 'b1', { x: 10, y: 0, w: 50, h: 20 }),
      line('b', 'B', 'b1', { x: 0, y: 30, w: 40, h: 20 }),
    ]
    const [paragraph] = buildParagraphs(lines)
    // x: min(10,0)=0, y: min(0,30)=0
    // x2: max(10+50,0+40)=60 -> w=60, y2: max(0+20,30+20)=50 -> h=50
    expect(paragraph.box).toEqual({ x: 0, y: 0, w: 60, h: 50 })
  })

  it('1行だけの段落のboxはその行自身のboxと一致する', () => {
    const lines = [line('a', 'A', undefined, { x: 5, y: 6, w: 7, h: 8 })]
    expect(buildParagraphs(lines)[0].box).toEqual({ x: 5, y: 6, w: 7, h: 8 })
  })
})
