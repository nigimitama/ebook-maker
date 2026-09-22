import { describe, it, expect } from 'vitest'
import type { Chapter } from '../../types'
import {
  buildOutlineTree,
  newChapterId,
  remapChapters,
  sortChapters,
  toExportChapters,
} from './chapters'

function ch(id: string, pageId: string, level = 1, title = id): Chapter {
  return { id, title, pageId, level }
}

describe('newChapterId', () => {
  it('returns distinct ids', () => {
    expect(newChapterId()).not.toBe(newChapterId())
  })
})

describe('sortChapters', () => {
  it('sorts by page order and keeps array order for the same page', () => {
    const sorted = sortChapters(
      [ch('c2', 'b'), ch('c1', 'a'), ch('c3', 'b', 2)],
      ['a', 'b', 'c'],
    )
    expect(sorted.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('puts chapters with an unknown page last', () => {
    const sorted = sortChapters([ch('x', 'zzz'), ch('c1', 'a')], ['a'])
    expect(sorted.map((c) => c.id)).toEqual(['c1', 'x'])
  })
})

describe('toExportChapters', () => {
  it('maps to page indexes in book order, skipping unknown pages and empty titles', () => {
    const result = toExportChapters(
      [ch('c2', 'b', 2, '節'), ch('c1', 'a', 1, '章'), ch('x', 'zzz'), ch('e', 'a', 1, '  ')],
      ['a', 'b'],
    )
    expect(result).toEqual([
      { title: '章', pageIndex: 0, level: 1 },
      { title: '節', pageIndex: 1, level: 2 },
    ])
  })
})

describe('remapChapters', () => {
  it('moves a chapter on a deleted page to the next surviving page', () => {
    const result = remapChapters([ch('c', 'b')], ['a', 'b', 'c'], ['a', 'c'])
    expect(result[0].pageId).toBe('c')
  })

  it('moves a chapter on a deleted last page to the previous page', () => {
    const result = remapChapters([ch('c', 'c')], ['a', 'b', 'c'], ['a', 'b'])
    expect(result[0].pageId).toBe('b')
  })

  it('moves chapters on both pages of a merged spread to the merged page', () => {
    const result = remapChapters(
      [ch('c1', 'a'), ch('c2', 'b')],
      ['x', 'a', 'b', 'c'],
      ['x', 'm', 'c'],
    )
    expect(result.map((c) => c.pageId)).toEqual(['m', 'm'])
  })

  it('drops all chapters when no page remains', () => {
    expect(remapChapters([ch('c', 'a')], ['a'], [])).toEqual([])
  })

  it('leaves chapters on surviving pages untouched', () => {
    const chapters = [ch('c', 'a')]
    expect(remapChapters(chapters, ['a', 'b'], ['a'])).toEqual(chapters)
  })
})

describe('buildOutlineTree', () => {
  const e = (title: string, level: number) => ({ title, pageIndex: 0, level })

  it('nests level 2 under the preceding level 1', () => {
    const tree = buildOutlineTree([e('A', 1), e('A1', 2), e('A2', 2), e('B', 1), e('B1', 2)])
    expect(tree.map((n) => n.chapter.title)).toEqual(['A', 'B'])
    expect(tree[0].children.map((n) => n.chapter.title)).toEqual(['A1', 'A2'])
    expect(tree[1].children.map((n) => n.chapter.title)).toEqual(['B1'])
  })

  it('treats a leading level 2 as a root', () => {
    const tree = buildOutlineTree([e('orphan', 2), e('A', 1)])
    expect(tree.map((n) => n.chapter.title)).toEqual(['orphan', 'A'])
  })
})
