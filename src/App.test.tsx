import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { App } from './App'
import * as useBookModule from './hooks/useBook'
import type { UseBookResult } from './hooks/useBook'

function mockBook(overrides: Partial<UseBookResult> = {}): UseBookResult {
  return {
    pages: [],
    thumbnails: {},
    metadata: { title: '', author: '' },
    selectedPageId: null,
    selectedImage: null,
    importFiles: vi.fn(),
    selectPage: vi.fn(),
    updateAdjustment: vi.fn(),
    applyAdjustmentToAllPages: vi.fn(),
    reorderPages: vi.fn(),
    deletePage: vi.fn(),
    confirmMerge: vi.fn(),
    setMetadata: vi.fn(),
    exportBook: vi.fn(),
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

  it('advances to the 並べ替え step and shows the page list and merge action', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('並べ替えへ進む'))
    expect(screen.getByText('見開き結合')).toBeInTheDocument()
  })

  it('advances to the 詳細＆書き出し step and shows the export panel', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('並べ替えへ進む'))
    fireEvent.click(screen.getByText('詳細情報へ進む'))
    expect(screen.getByText('書き出し')).toBeInTheDocument()
  })

  it('shows the AdjustmentEditor on the 調整 step once a page is selected and its image is loaded', () => {
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

  it('shows an error banner when the hook reports an error', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ error: '読み込みに失敗しました: a.heic' }),
    )
    render(<App />)
    expect(screen.getByTestId('error-banner')).toHaveTextContent('読み込みに失敗しました: a.heic')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('resets to the import step when the last page is removed', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    const { rerender } = render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    expect(screen.queryByText('ファイルを選択')).not.toBeInTheDocument()

    vi.spyOn(useBookModule, 'useBook').mockReturnValue(mockBook({ pages: [] }))
    rerender(<App />)
    expect(screen.getByText('ファイルを選択')).toBeInTheDocument()
  })

  it('does not allow jumping to a step ahead of the furthest one reached via the rail', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('並べ替え'))
    expect(screen.queryByText('見開き結合')).not.toBeInTheDocument()
    expect(screen.getByText('ファイルを選択')).toBeInTheDocument()
  })
})
