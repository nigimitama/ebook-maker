import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TitleStep, type TitleStepProps } from './TitleStep'
import { EMPTY_TITLE_SELECTION } from '../types'
import type { OcrResult } from '../lib/ocr/types'
import type { PageEntry, RawImage } from '../types'

function coverPage(): PageEntry {
  return {
    id: 'p1',
    order: 0,
    blobId: 'blob-p1',
    fileName: 'cover.jpg',
    width: 100,
    height: 140,
    adjustment: { brightness: 0, contrast: 0 },
  }
}

function ocrOf(texts: { text: string; w: number; h: number }[]): OcrResult {
  return {
    pageId: 'p1',
    modelVersion: 't',
    updatedAt: 1,
    lines: texts.map((t, i) => ({ id: `l${i}`, x: 0, y: i * 10, w: t.w, h: t.h, text: t.text, edited: false })),
  }
}

type HarnessProps = Omit<TitleStepProps, 'selection' | 'onSelectionChange'> & {
  /** false で工程を離れた(アンマウントした)状態を再現する。 */
  show?: boolean
}

// 候補の選択はApp側が持つ(工程をまたいでも消えないように)。その親の代わり。
function Harness({ show = true, ...props }: HarnessProps) {
  const [selection, setSelection] = useState(EMPTY_TITLE_SELECTION)
  if (!show) return null
  return <TitleStep {...props} selection={selection} onSelectionChange={setSelection} />
}

function setup(overrides: Partial<HarnessProps> = {}) {
  const props: HarnessProps = {
    coverPage: coverPage(),
    thumbnail: 'blob:thumb',
    ocrResult: undefined,
    ocrRunning: false,
    onRunOcr: vi.fn(),
    metadata: { title: '', author: '' },
    onChange: vi.fn(),
    getPagePreview: vi.fn(async () => ({ data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1 }) as RawImage),
    ...overrides,
  }
  const view = render(<Harness {...props} />)
  return {
    props,
    rerenderWith: (next: Partial<HarnessProps>) => view.rerender(<Harness {...props} {...next} />),
  }
}

describe('TitleStep', () => {
  it('shows a message and no crash when there is no cover page', () => {
    setup({ coverPage: undefined })
    expect(screen.getByText(/ページがありません/)).toBeInTheDocument()
  })

  it('auto-fills the title with the largest OCR line when the title is still empty', () => {
    const onChange = vi.fn()
    setup({
      ocrResult: ocrOf([
        { text: 'サブタイトル', w: 100, h: 14 },
        { text: 'メインタイトル', w: 100, h: 60 },
      ]),
      metadata: { title: '', author: '' },
      onChange,
    })
    expect(onChange).toHaveBeenCalledWith({ title: 'メインタイトル', author: '' })
    expect(screen.getByLabelText('「メインタイトル」をタイトルに含める')).toBeChecked()
  })

  it('does not overwrite a title the user already set', () => {
    const onChange = vi.fn()
    setup({
      ocrResult: ocrOf([{ text: 'メインタイトル', w: 100, h: 60 }]),
      metadata: { title: '手入力タイトル', author: '' },
      onChange,
    })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('「メインタイトル」をタイトルに含める')).not.toBeChecked()
  })

  it('lists OCR lines largest-first with size labels', () => {
    setup({
      ocrResult: ocrOf([
        { text: '著者名', w: 100, h: 20 },
        { text: 'タイトル候補', w: 100, h: 50 },
      ]),
      metadata: { title: 'タイトル候補', author: '' },
    })
    const candidates = screen.getAllByRole('listitem')
    expect(within(candidates[0]).getByText('タイトル候補')).toBeInTheDocument()
    expect(within(candidates[0]).getByText('50px')).toBeInTheDocument()
    expect(within(candidates[1]).getByText('著者名')).toBeInTheDocument()
  })

  it('checks a single candidate for the author field', () => {
    const onChange = vi.fn()
    setup({
      ocrResult: ocrOf([
        { text: '著者名', w: 100, h: 20 },
        { text: 'タイトル候補', w: 100, h: 50 },
      ]),
      metadata: { title: 'タイトル候補', author: '' },
      onChange,
    })
    fireEvent.click(screen.getByLabelText('「著者名」を著者に含める'))
    expect(onChange).toHaveBeenCalledWith({ title: 'タイトル候補', author: '著者名' })
  })

  it('joins multiple checked candidates in reading order, not check order, for the title', () => {
    const onChange = vi.fn()
    const ocrResult = ocrOf([
      { text: 'ebook', w: 100, h: 30 },
      { text: 'maker', w: 100, h: 25 },
      { text: 'すごい', w: 100, h: 50 },
    ])
    // タイトルは既に入力済みにして自動入力の影響を避け、チェック操作だけを見る。
    setup({ ocrResult, metadata: { title: '既存', author: '' }, onChange })

    fireEvent.click(screen.getByLabelText('「maker」をタイトルに含める'))
    fireEvent.click(screen.getByLabelText('「ebook」をタイトルに含める'))

    expect(onChange).toHaveBeenLastCalledWith({ title: 'ebookmaker', author: '' })
  })

  it('unchecking a candidate removes it from the joined title', () => {
    const onChange = vi.fn()
    const ocrResult = ocrOf([
      { text: 'ebook', w: 100, h: 30 },
      { text: 'maker', w: 100, h: 25 },
    ])
    setup({ ocrResult, metadata: { title: '既存', author: '' }, onChange })

    fireEvent.click(screen.getByLabelText('「ebook」をタイトルに含める'))
    fireEvent.click(screen.getByLabelText('「maker」をタイトルに含める'))
    expect(onChange).toHaveBeenLastCalledWith({ title: 'ebookmaker', author: '' })

    fireEvent.click(screen.getByLabelText('「ebook」をタイトルに含める'))
    expect(onChange).toHaveBeenLastCalledWith({ title: 'maker', author: '' })
  })

  it('lets a candidate be checked for title and author independently at the same time', () => {
    const onChange = vi.fn()
    const ocrResult = ocrOf([{ text: '著者名', w: 100, h: 20 }])
    setup({ ocrResult, metadata: { title: '既存', author: '' }, onChange })

    fireEvent.click(screen.getByLabelText('「著者名」を著者に含める'))
    expect(onChange).toHaveBeenLastCalledWith({ title: '既存', author: '著者名' })

    fireEvent.click(screen.getByLabelText('「著者名」をタイトルに含める'))
    expect(onChange).toHaveBeenLastCalledWith({ title: '著者名', author: '' })
  })

  it('shows a caption noting it assumes the first page is the cover, in place of a "表紙" heading', () => {
    setup()
    expect(screen.getByText('入力画像の1枚目を表紙と仮定しています')).toBeInTheDocument()
    expect(screen.queryByText('表紙', { selector: 'h3' })).not.toBeInTheDocument()
  })

  it('runs OCR on the cover page on demand', () => {
    const onRunOcr = vi.fn()
    setup({ onRunOcr })
    fireEvent.click(screen.getByText('表紙をOCR'))
    expect(onRunOcr).toHaveBeenCalled()
  })

  it('renders the title/author text inputs and forwards edits', () => {
    const onChange = vi.fn()
    setup({ metadata: { title: 'T', author: 'A' }, onChange })
    fireEvent.change(screen.getByTestId('title-input'), { target: { value: 'New' } })
    expect(onChange).toHaveBeenCalledWith({ title: 'New', author: 'A' })
  })

  it('rounds a non-integer font size for the candidate size label', () => {
    setup({
      ocrResult: ocrOf([{ text: 'メインタイトル', w: 100, h: 47.31294250488281 }]),
    })
    expect(screen.getByText('47px')).toBeInTheDocument()
  })

  it('does not re-fill the title once the user clears it, for the same OCR result', () => {
    const onChange = vi.fn()
    const ocrResult = ocrOf([{ text: 'メインタイトル', w: 100, h: 60 }])
    const { rerenderWith } = setup({
      ocrResult,
      metadata: { title: '', author: '' },
      onChange,
    })
    expect(onChange).toHaveBeenCalledWith({ title: 'メインタイトル', author: '' })
    onChange.mockClear()

    // ユーザーが自動入力されたタイトルを消した状態を再現する。ocrResult(と
    // updatedAt)は変わっていないので、再度自動入力されてはならない。
    rerenderWith({ ocrResult, metadata: { title: '', author: '' }, onChange })
    expect(onChange).not.toHaveBeenCalled()
  })

  // 工程を離れて戻ってきても、チェックした候補は残り、消したタイトルが再入力されることもない。
  it('keeps the checked candidates, and does not re-fill, when the step is left and reopened', () => {
    const onChange = vi.fn()
    const ocrResult = ocrOf([
      { text: '著者名', w: 100, h: 20 },
      { text: 'メインタイトル', w: 100, h: 60 },
    ])
    const { rerenderWith } = setup({ ocrResult, metadata: { title: '', author: '' }, onChange })
    fireEvent.click(screen.getByLabelText('「著者名」を著者に含める'))
    onChange.mockClear()

    rerenderWith({ show: false })
    rerenderWith({ show: true })

    expect(screen.getByLabelText('「メインタイトル」をタイトルに含める')).toBeChecked()
    expect(screen.getByLabelText('「著者名」を著者に含める')).toBeChecked()
    expect(onChange).not.toHaveBeenCalled()
  })

  // 候補のチェックは手入力したタイトルを置き換えるので、その場で元に戻せるようにする。
  it('offers to restore a hand-typed title replaced by checking a candidate', () => {
    const onChange = vi.fn()
    setup({
      ocrResult: ocrOf([{ text: 'ebook', w: 100, h: 30 }]),
      metadata: { title: '手入力タイトル', author: '著者' },
      onChange,
    })
    fireEvent.click(screen.getByLabelText('「ebook」をタイトルに含める'))
    expect(onChange).toHaveBeenLastCalledWith({ title: 'ebook', author: '著者' })
    expect(screen.getByRole('status')).toHaveTextContent('「手入力タイトル」を置き換えました')

    fireEvent.click(screen.getByRole('button', { name: '「タイトルの置き換え」を取り消す' }))
    expect(onChange).toHaveBeenLastCalledWith({ title: '手入力タイトル', author: '著者' })
  })

  it('offers to restore a hand-typed author replaced by checking a candidate', () => {
    const onChange = vi.fn()
    setup({
      ocrResult: ocrOf([{ text: '著者名', w: 100, h: 20 }]),
      metadata: { title: 'T', author: '手入力著者' },
      onChange,
    })
    fireEvent.click(screen.getByLabelText('「著者名」を著者に含める'))
    fireEvent.click(screen.getByRole('button', { name: '「著者の置き換え」を取り消す' }))
    expect(onChange).toHaveBeenLastCalledWith({ title: 'T', author: '手入力著者' })
  })

  it('does not offer undo when the replaced title was empty', () => {
    setup({ ocrResult: ocrOf([{ text: 'ebook', w: 100, h: 30 }]), metadata: { title: '', author: '' } })
    // 空のタイトルは自動入力でebookになる(静的なmetadataなので表示上はまだ空)。
    fireEvent.click(screen.getByLabelText('「ebook」をタイトルに含める'))
    expect(screen.queryByRole('button', { name: /を取り消す/ })).not.toBeInTheDocument()
  })
})
