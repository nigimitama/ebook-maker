import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { ChaptersStep, type ChaptersStepProps } from './ChaptersStep'
import type { OcrResult } from '../lib/ocr/types'
import type { Chapter, PageEntry, RawImage } from '../types'

function rawImage(): RawImage {
  return { data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1 }
}

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
    getPagePreview: vi.fn(async () => rawImage()),
    onUpdateOcrLine: vi.fn(),
    onDeleteOcrLine: vi.fn(),
    onMoveOcrLine: vi.fn(),
    ...overrides,
  }
  render(<ChaptersStep {...props} />)
  return props
}

// 章の変更を実際に反映させるため、chapters を状態として持つ親の代わり。
function StatefulChaptersStep({ initial, ...rest }: Omit<ChaptersStepProps, 'chapters' | 'onChange'> & { initial: Chapter[] }) {
  const [chapters, setChapters] = useState(initial)
  return <ChaptersStep {...rest} chapters={chapters} onChange={setChapters} />
}

function setupStateful(initial: Chapter[]) {
  render(
    <StatefulChaptersStep
      initial={initial}
      pages={pages}
      thumbnails={thumbnails}
      ocrResults={{ p1: ocr('p1', tocTexts), p2: ocr('p2', ['本文']), p3: ocr('p3', ['本文']) }}
      ocrRunning={false}
      onRunOcr={vi.fn()}
      getPagePreview={vi.fn(async () => rawImage())}
      onUpdateOcrLine={vi.fn()}
      onDeleteOcrLine={vi.fn()}
      onMoveOcrLine={vi.fn()}
    />,
  )
}

const handMade: Chapter[] = [
  { id: 'c1', title: '手で直した章', pageId: 'p2', level: 1 },
  { id: 'c2', title: '別の章', pageId: 'p5', level: 1 },
]

const titles = () =>
  screen.queryAllByRole('textbox', { name: /章\d+のタイトル/ }).map((el) => (el as HTMLInputElement).value)

describe('ChaptersStep', () => {
  // 解析で置き換えると手で直した章立てが消えるので、直後に取り消せるようにする。
  it('undoes replacing the chapters with a fresh parse', () => {
    setupStateful(handMade)
    fireEvent.click(screen.getByText('目次を解析して置き換える'))
    expect(titles()).toContain('第2章 手法')
    fireEvent.click(screen.getByRole('button', { name: '「目次の置き換え」を取り消す' }))
    expect(titles()).toEqual(['手で直した章', '別の章'])
    expect(screen.queryByRole('button', { name: /を取り消す/ })).not.toBeInTheDocument()
  })

  it('undoes deleting a chapter', () => {
    setupStateful(handMade)
    fireEvent.click(screen.getByLabelText('章1を削除'))
    expect(titles()).toEqual(['別の章'])
    expect(screen.getByRole('status')).toHaveTextContent('「手で直した章」を削除しました')
    fireEvent.click(screen.getByRole('button', { name: '「章の削除」を取り消す' }))
    expect(titles()).toEqual(['手で直した章', '別の章'])
  })

  // 取り消しのあとに加えた編集を巻き戻さないよう、ほかの編集をしたら取り消しは消える。
  it('drops the undo once the chapters are edited again', () => {
    setupStateful(handMade)
    fireEvent.click(screen.getByLabelText('章1を削除'))
    fireEvent.change(screen.getByLabelText('章1のタイトル'), { target: { value: '改題' } })
    expect(screen.queryByRole('button', { name: /を取り消す/ })).not.toBeInTheDocument()
  })

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

  it('opens an enlarged preview of a toc-page thumbnail without toggling its checkbox', async () => {
    const props = setup()
    fireEvent.click(screen.getByLabelText('3枚目を拡大表示'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('3枚目を目次ページにする')).not.toBeChecked()
    // サムネイルをそのまま引き延ばすのではなく、原本から生成した高精細プレビューを取得する。
    expect(props.getPagePreview).toHaveBeenCalledWith('p3')
    await waitFor(() => expect(screen.getByTestId('thumb-modal-canvas')).toBeInTheDocument())
  })

  it('shows an error message when the enlarged preview fails to load', async () => {
    setup({ getPagePreview: vi.fn(async () => Promise.reject(new Error('boom'))) })
    fireEvent.click(screen.getByLabelText('3枚目を拡大表示'))
    await waitFor(() => expect(screen.getByText('画像の読み込みに失敗しました')).toBeInTheDocument())
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

  it('shows the OCR result text next to the enlarged image', () => {
    setup()
    // p3のOCR結果は setup() の既定値(ocr('p3', ['本文'])) を使う。
    fireEvent.click(screen.getByLabelText('3枚目を拡大表示'))
    expect(screen.getByText('本文')).toBeInTheDocument()
  })

  it('marks an edited OCR line in the side panel', () => {
    const editedResult: OcrResult = {
      pageId: 'p3',
      modelVersion: 't',
      updatedAt: 1,
      lines: [{ id: 'p3-0', x: 0, y: 0, w: 1, h: 1, text: '直した行', edited: true }],
    }
    setup({ ocrResults: { p3: editedResult } })
    fireEvent.click(screen.getByLabelText('3枚目を拡大表示'))
    expect(screen.getByText('直した行')).toBeInTheDocument()
    expect(screen.getByText('修正済み')).toBeInTheDocument()
  })

  it('says OCR has not run yet when the enlarged page has no OCR result', () => {
    setup()
    // p4はsetup()の既定のocrResultsに含まれない。
    fireEvent.click(screen.getByLabelText('4枚目を拡大表示'))
    expect(screen.getByText('OCR未実施です。')).toBeInTheDocument()
  })

  it('lets the user edit an OCR line text in the side panel and commits it on blur', () => {
    const props = setup({
      ocrResults: { p3: ocr('p3', ['一行目', '二行目']) },
    })
    fireEvent.click(screen.getByLabelText('3枚目を拡大表示'))
    const textarea = screen.getByLabelText('行1の文字')
    fireEvent.change(textarea, { target: { value: '直した一行目' } })
    fireEvent.blur(textarea)
    expect(props.onUpdateOcrLine).toHaveBeenCalledWith('p3', 'p3-0', '直した一行目')
  })

  it('lets the user delete and reorder an OCR line from the side panel', () => {
    const props = setup({
      ocrResults: { p3: ocr('p3', ['一行目', '二行目']) },
    })
    fireEvent.click(screen.getByLabelText('3枚目を拡大表示'))
    const row = screen.getByTestId('ocr-line-p3-1')
    fireEvent.click(within(row).getByRole('button', { name: '上へ移動' }))
    expect(props.onMoveOcrLine).toHaveBeenCalledWith('p3', 'p3-1', 0)
    fireEvent.click(within(row).getByRole('button', { name: '行を削除' }))
    expect(props.onDeleteOcrLine).toHaveBeenCalledWith('p3', 'p3-1')
  })
})
