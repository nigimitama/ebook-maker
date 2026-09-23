import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { App } from './App'
import * as useBookModule from './hooks/useBook'
import * as useChaptersModule from './hooks/useChapters'
import type { UseBookResult } from './hooks/useBook'

function mockBook(overrides: Partial<UseBookResult> = {}): UseBookResult {
  return {
    pages: [],
    getStore: vi.fn(async () => null),
    thumbnails: {},
    metadata: { title: '', author: '' },
    selectedPageId: null,
    selectedImage: null,
    getPagePreview: vi.fn(),
    importFiles: vi.fn(),
    selectPage: vi.fn(),
    updateAdjustment: vi.fn(),
    applyResizeToAllPages: vi.fn(),
    applyQualityToAllPages: vi.fn(),
    applyToneToAllPages: vi.fn(),
    autoAdjustAllPages: vi.fn(),
    reorderPages: vi.fn(),
    deletePage: vi.fn(),
    confirmMerge: vi.fn(),
    clearAllPages: vi.fn(),
    canUndoClearAll: false,
    undoClearAll: vi.fn(),
    setMetadata: vi.fn(),
    exportBook: vi.fn(),
    importProgress: null,
    error: null,
    clearError: vi.fn(),
    ...overrides,
  }
}

const page = {
  id: 'a',
  order: 0,
  blobId: 'blob-a',
  width: 10,
  height: 10,
  adjustment: { brightness: 0, contrast: 0 },
}

describe('App', () => {
  it('shows only the import step when there are no pages yet, with 次へ disabled', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(mockBook())
    render(<App />)
    expect(screen.getByText('ファイルを選択')).toBeInTheDocument()
    expect(screen.queryByText('書き出し')).not.toBeInTheDocument()
    expect(screen.getByText('次へ')).toBeDisabled()
  })

  it('advances to the 並べ替え・調整 step and shows the page list and merge action', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    expect(screen.getByText('見開き結合')).toBeInTheDocument()
  })

  it('shows the six steps of the flow', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(mockBook())
    render(<App />)
    for (const label of [
      '読み込み',
      '並べ替え・調整',
      'OCR確認・修正',
      'タイトルの設定',
      '目次の作成',
      '詳細＆書き出し',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('advances from 並べ替え・調整 to the OCR確認・修正 step', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('OCRへ進む'))
    expect(screen.getByText('このページをOCR')).toBeInTheDocument()
  })

  it('advances from the OCR確認・修正 step to タイトルの設定, then 目次の作成, then to 詳細＆書き出し', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('OCRへ進む'))
    fireEvent.click(screen.getByText('タイトルの設定へ進む'))
    fireEvent.click(screen.getByText('目次の作成へ進む'))
    expect(screen.getByText('章を追加')).toBeInTheDocument()
    fireEvent.click(screen.getByText('詳細情報へ進む'))
    expect(screen.getByText('書き出し')).toBeInTheDocument()
  })

  // タイトル・目次の設定も任意工程。OCR確認から直接書き出しへ進める。
  // (タイトルは書き出し工程でも入力できる。文言は飛ばす工程を正しく名指しする)
  it('lets the user skip the タイトル・目次 steps', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('OCRへ進む'))
    fireEvent.click(screen.getByText('タイトル・目次の設定をスキップして書き出しへ'))
    expect(screen.getByText('書き出し')).toBeInTheDocument()
    expect(screen.queryByText('章を追加')).not.toBeInTheDocument()
  })

  // OCRは任意工程。飛ばしても書き出しに進める。
  it('lets the user skip the OCR step and export directly', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('OCRをスキップして書き出しへ'))
    expect(screen.getByText('書き出し')).toBeInTheDocument()
    expect(screen.queryByText('このページをOCR')).not.toBeInTheDocument()
  })

  it('returns from the 書き出し step to the 目次の作成 step', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('OCRへ進む'))
    fireEvent.click(screen.getByText('タイトルの設定へ進む'))
    fireEvent.click(screen.getByText('目次の作成へ進む'))
    fireEvent.click(screen.getByText('詳細情報へ進む'))
    fireEvent.click(screen.getByText('目次の作成へ戻る'))
    expect(screen.getByText('章を追加')).toBeInTheDocument()
  })

  // 書き出しの「戻る」は、飛ばしてきた工程ではなく来た工程へ戻す。
  it('returns from 書き出し to 並べ替え・調整 when OCR was skipped', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('OCRをスキップして書き出しへ'))
    expect(screen.queryByText('目次の作成へ戻る')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('並べ替え・調整へ戻る'))
    expect(screen.getByText('見開き結合')).toBeInTheDocument()
  })

  it('returns from 書き出し to OCR確認・修正 when the タイトル・目次 steps were skipped', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('OCRへ進む'))
    fireEvent.click(screen.getByText('タイトル・目次の設定をスキップして書き出しへ'))
    fireEvent.click(screen.getByText('OCR確認・修正へ戻る'))
    expect(screen.getByText('このページをOCR')).toBeInTheDocument()
  })

  // 飛ばした工程は「済」に見せない。ただし後から戻って作業できるよう、選べるままにする。
  it('marks skipped steps as skipped, not done, while keeping them reachable', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('OCRをスキップして書き出しへ'))
    const railStep = (label: string) => screen.getByText(label, { selector: '.rail span' }).closest('.step')!
    expect(railStep('並べ替え・調整')).toHaveClass('step--done')
    for (const label of ['OCR確認・修正', 'タイトルの設定', '目次の作成']) {
      expect(railStep(label)).toHaveClass('step--skipped')
      expect(railStep(label)).not.toHaveClass('step--done')
    }
    fireEvent.click(railStep('目次の作成'))
    expect(screen.getByText('章を追加')).toBeInTheDocument()
  })

  it('shows the AdjustmentEditor on the 並べ替え・調整 step once a page is selected and its image is loaded', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({
        pages: [{ ...page, adjustment: { brightness: 5, contrast: 0 } }],
        thumbnails: { a: 'blob:a' },
        selectedPageId: 'a',
        selectedImage: { data: new Uint8ClampedArray(16), width: 2, height: 2 },
      }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    expect(screen.getByTestId('brightness-slider')).toHaveValue('5')
  })

  it('shows a placeholder, not another page’s image, while the preview decodes', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({
        pages: [{ ...page, adjustment: { brightness: 5, contrast: 0 } }],
        thumbnails: { a: 'blob:a' },
        selectedPageId: 'a',
        // 選択は済んでいるが画素がまだ届いていない状態。
        selectedImage: null,
      }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    expect(screen.getByTestId('preview-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('adjustment-canvas')).not.toBeInTheDocument()
  })

  it('selects the first page automatically on entering the 並べ替え・調整 step', () => {
    const props = mockBook({ pages: [page], thumbnails: { a: 'blob:a' } })
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(props)
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    expect(props.selectPage).toHaveBeenCalledWith('a')
  })

  // OCR画面も選択中ページの画素(selectedImage)に頼るため、自動選択が要る。
  it('selects the first page automatically on entering the OCR確認・修正 step', () => {
    const props = mockBook({ pages: [page], thumbnails: { a: 'blob:a' } })
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(props)
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('OCRをスキップして書き出しへ'))
    ;(props.selectPage as ReturnType<typeof vi.fn>).mockClear()
    fireEvent.click(screen.getByText('OCR確認・修正'))
    expect(props.selectPage).toHaveBeenCalledWith('a')
  })

  it('shows an error banner when the hook reports an error', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ error: '読み込みに失敗しました: a.heic' }),
    )
    render(<App />)
    expect(screen.getByTestId('error-banner')).toHaveTextContent('読み込みに失敗しました: a.heic')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('shows the chapter save error in the banner and clears it with 閉じる', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(mockBook())
    const clearError = vi.fn()
    vi.spyOn(useChaptersModule, 'useChapters').mockReturnValue({
      chapters: [],
      setChapters: vi.fn(),
      error: '目次の保存に失敗しました: x',
      clearError,
    })
    render(<App />)
    expect(screen.getByTestId('error-banner')).toHaveTextContent('目次の保存に失敗しました: x')
    fireEvent.click(screen.getByText('閉じる'))
    expect(clearError).toHaveBeenCalled()
  })

  it('parseToc throws for an unknown bodyStartPageId', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(mockBook())
    render(<App />)
    expect(() => window.EbookMaker?.parseToc([], 'no-such-id')).toThrow('no-such-id')
  })

  it('does not allow jumping to a step ahead of the furthest one reached via the rail', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('並べ替え・調整'))
    expect(screen.queryByText('見開き結合')).not.toBeInTheDocument()
    expect(screen.getByText('ファイルを選択')).toBeInTheDocument()
  })

  it('exposes an automation API on window.EbookMaker that reflects the current step and pages', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' }, selectedPageId: 'a' }),
    )
    render(<App />)

    const state = window.EbookMaker?.getState()

    expect(state?.step).toBe(0)
    expect(state?.pages).toEqual([
      { id: 'a', order: 0, fileName: undefined, width: 10, height: 10, adjustment: page.adjustment },
    ])
    expect(state?.selectedPageId).toBe('a')
    expect(state?.chapters).toEqual([])
    expect(window.EbookMaker?.getChapters()).toEqual([])

    act(() => window.EbookMaker?.goToStep(1))
    expect(screen.getByText('見開き結合')).toBeInTheDocument()
  })
})
