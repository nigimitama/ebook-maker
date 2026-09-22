import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TitleStep, type TitleStepProps } from './TitleStep'
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

function setup(overrides: Partial<TitleStepProps> = {}) {
  const props: TitleStepProps = {
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
  const view = render(<TitleStep {...props} />)
  return { props, ...view }
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
  })

  it('does not overwrite a title the user already set', () => {
    const onChange = vi.fn()
    setup({
      ocrResult: ocrOf([{ text: 'メインタイトル', w: 100, h: 60 }]),
      metadata: { title: '手入力タイトル', author: '' },
      onChange,
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('lists OCR lines largest-first with size labels and lets the user assign title/author', () => {
    const onChange = vi.fn()
    setup({
      ocrResult: ocrOf([
        { text: '著者名', w: 100, h: 20 },
        { text: 'タイトル候補', w: 100, h: 50 },
      ]),
      metadata: { title: 'タイトル候補', author: '' },
      onChange,
    })
    const candidates = screen.getAllByRole('listitem')
    expect(within(candidates[0]).getByText('タイトル候補')).toBeInTheDocument()
    expect(within(candidates[0]).getByText('50px')).toBeInTheDocument()
    expect(within(candidates[1]).getByText('著者名')).toBeInTheDocument()

    fireEvent.click(within(candidates[1]).getByText('著者にする'))
    expect(onChange).toHaveBeenCalledWith({ title: 'タイトル候補', author: '著者名' })
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
    const { rerender, props } = setup({
      ocrResult,
      metadata: { title: '', author: '' },
      onChange,
    })
    expect(onChange).toHaveBeenCalledWith({ title: 'メインタイトル', author: '' })
    onChange.mockClear()

    // ユーザーが自動入力されたタイトルを消した状態を再現する。ocrResult(と
    // updatedAt)は変わっていないので、再度自動入力されてはならない。
    rerender(
      <TitleStep {...props} ocrResult={ocrResult} metadata={{ title: '', author: '' }} onChange={onChange} />,
    )
    expect(onChange).not.toHaveBeenCalled()
  })
})
