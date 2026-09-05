import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    ...overrides,
  }
}

describe('App', () => {
  it('shows only the import panel when there are no pages yet', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(mockBook())
    render(<App />)
    expect(screen.getByText('ファイルを選択')).toBeInTheDocument()
    expect(screen.queryByText('書き出し')).not.toBeInTheDocument()
  })

  it('shows the page list, metadata form, and export panel once pages exist', () => {
    const page = {
      id: 'a',
      order: 0,
      blobId: 'blob-a',
      width: 10,
      height: 10,
      adjustment: { brightness: 0, contrast: 0 },
    }
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    expect(screen.getByText('書き出し')).toBeInTheDocument()
    expect(screen.getByText('見開き結合')).toBeInTheDocument()
  })

  it('shows the AdjustmentEditor once a page is selected and its image is loaded', () => {
    const page = {
      id: 'a',
      order: 0,
      blobId: 'blob-a',
      width: 2,
      height: 2,
      adjustment: { brightness: 5, contrast: 0 },
    }
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({
        pages: [page],
        thumbnails: { a: 'blob:a' },
        selectedPageId: 'a',
        selectedImage: { data: new Uint8ClampedArray(16), width: 2, height: 2 },
      }),
    )
    render(<App />)
    expect(screen.getByTestId('brightness-slider')).toHaveValue('5')
  })
})
