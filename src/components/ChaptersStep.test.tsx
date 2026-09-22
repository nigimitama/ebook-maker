import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChaptersStep, type ChaptersStepProps } from './ChaptersStep'
import type { OcrResult } from '../lib/ocr/types'
import type { Chapter, PageEntry } from '../types'

function page(id: string, order: number): PageEntry {
  return {
    id,
    order,
    blobId: `blob-${id}`,
    width: 10,
    height: 10,
    adjustment: { brightness: 0, contrast: 0 },
  }
}

function ocr(pageId: string, texts: string[]): OcrResult {
  return {
    pageId,
    modelVersion: 't',
    updatedAt: 1,
    lines: texts.map((text, i) => ({ id: `${pageId}-${i}`, x: 0, y: i, w: 1, h: 1, text, edited: false })),
  }
}

const tocTexts = [
  '目次',
  '第1章 はじめに ........ 1',
  '1.1 背景 ........ 2',
  '第2章 手法 ........ 5',
  '第3章 結果 ........ 9',
  '第4章 議論 ........ 12',
]

// 目次(p1) + 本文(p2..p10)。検出範囲は ceil(10*0.3)=3 枚。
const pages = Array.from({ length: 10 }, (_, i) => page(`p${i + 1}`, i))
const thumbnails = Object.fromEntries(pages.map((p) => [p.id, `blob:${p.id}`]))

function setup(overrides: Partial<ChaptersStepProps> = {}) {
  const props: ChaptersStepProps = {
    pages,
    thumbnails,
    ocrResults: { p1: ocr('p1', tocTexts), p2: ocr('p2', ['本文']), p3: ocr('p3', ['本文']) },
    ocrRunning: false,
    onRunOcr: vi.fn(),
    chapters: [],
    onChange: vi.fn(),
    ...overrides,
  }
  render(<ChaptersStep {...props} />)
  return props
}

describe('ChaptersStep', () => {
  it('auto-detects the toc page on open and parses it into chapters', () => {
    const props = setup()
    expect(screen.getByLabelText('1枚目を目次ページにする')).toBeChecked()
    // 本文1ページ目の既定値は目次の次の画像(2枚目)。
    expect(screen.getByLabelText('本文1ページ目は画像何枚目か')).toHaveValue(2)
    fireEvent.click(screen.getByText('目次を解析'))
    const chapters = vi.mocked(props.onChange).mock.calls[0][0]
    expect(chapters.map((c) => [c.title, c.pageId, c.level])).toEqual([
      ['第1章 はじめに', 'p2', 1],
      ['1.1 背景', 'p3', 2],
      ['第2章 手法', 'p6', 1],
      ['第3章 結果', 'p10', 1],
      ['第4章 議論', 'p10', 1],
    ])
  })

  it('says so when nothing can be detected', () => {
    setup({ ocrResults: { p1: ocr('p1', ['本文']), p2: ocr('p2', ['本文']), p3: ocr('p3', ['本文']) } })
    expect(screen.getByText('自動検出できませんでした。手動で選んでください')).toBeInTheDocument()
  })

  it('offers to OCR the unscanned pages in the scan window', () => {
    const props = setup({ ocrResults: { p1: ocr('p1', ['本文']) } })
    expect(screen.getByText('先頭3枚のうち2枚が未OCRです')).toBeInTheDocument()
    fireEvent.click(screen.getByText('先頭3枚をOCR'))
    expect(props.onRunOcr).toHaveBeenCalledWith(['p2', 'p3'])
  })

  it('does not let a page without OCR be chosen as a toc page', () => {
    setup({ ocrResults: { p1: ocr('p1', ['本文']) } })
    expect(screen.getByLabelText('5枚目を目次ページにする')).toBeDisabled()
  })

  it('reports when the toc has no readable entries', () => {
    setup({ ocrResults: { p1: ocr('p1', ['読めない']) } })
    fireEvent.click(screen.getByLabelText('1枚目を目次ページにする'))
    fireEvent.click(screen.getByText('目次を解析'))
    expect(screen.getByText('目次から章を読み取れませんでした')).toBeInTheDocument()
  })

  it('edits, adds and deletes chapters manually', () => {
    const chapters: Chapter[] = [
      { id: 'c1', title: '第1章', pageId: 'p2', level: 1 },
      { id: 'c2', title: '第2章', pageId: 'p5', level: 1 },
    ]
    const props = setup({ chapters })
    fireEvent.change(screen.getByLabelText('章1のタイトル'), { target: { value: '序章' } })
    expect(vi.mocked(props.onChange).mock.calls.at(-1)![0][0].title).toBe('序章')

    fireEvent.change(screen.getByLabelText('章1の階層'), { target: { value: '2' } })
    expect(vi.mocked(props.onChange).mock.calls.at(-1)![0][0].level).toBe(2)

    fireEvent.click(screen.getByLabelText('章2を削除'))
    expect(vi.mocked(props.onChange).mock.calls.at(-1)![0].map((c) => c.id)).toEqual(['c1'])

    fireEvent.click(screen.getByText('章を追加'))
    const added = vi.mocked(props.onChange).mock.calls.at(-1)![0]
    expect(added).toHaveLength(3)
    expect(added[2]).toMatchObject({ title: '', level: 1 })
  })

  it('re-sorts by start page when a chapter page is changed', () => {
    const chapters: Chapter[] = [
      { id: 'c1', title: 'A', pageId: 'p2', level: 1 },
      { id: 'c2', title: 'B', pageId: 'p5', level: 1 },
    ]
    const props = setup({ chapters })
    fireEvent.change(screen.getByLabelText('章1の開始ページ'), { target: { value: 'p8' } })
    expect(vi.mocked(props.onChange).mock.calls.at(-1)![0].map((c) => c.id)).toEqual(['c2', 'c1'])
  })

  it('labels the parse button as a replacement when chapters already exist', () => {
    setup({ chapters: [{ id: 'c1', title: 'A', pageId: 'p2', level: 1 }] })
    expect(screen.getByText('目次を解析して置き換える')).toBeInTheDocument()
  })
  it('keeps a hand-edited body offset when toc pages are toggled', () => {
    setup()
    fireEvent.change(screen.getByLabelText('本文1ページ目は画像何枚目か'), { target: { value: '7' } })
    fireEvent.click(screen.getByLabelText('2枚目を目次ページにする'))
    expect(screen.getByLabelText('本文1ページ目は画像何枚目か')).toHaveValue(7)
  })

  it('opens an enlarged preview of a toc-page thumbnail without toggling its checkbox', () => {
    setup()
    fireEvent.click(screen.getByLabelText('3枚目を拡大表示'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('3枚目を目次ページにする')).not.toBeChecked()
  })

  it('opens an enlarged preview of a chapter row thumbnail', () => {
    setup({ chapters: [{ id: 'c1', title: 'A', pageId: 'p2', level: 1 }] })
    fireEvent.click(screen.getByLabelText('章1の開始ページを拡大表示'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes the enlarged preview on Escape', () => {
    setup()
    fireEvent.click(screen.getByLabelText('3枚目を拡大表示'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
