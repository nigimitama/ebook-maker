import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { PageList } from './PageList'
import type { PageEntry } from '../types'

function page(id: string, order: number, fileName?: string): PageEntry {
  return {
    id,
    order,
    blobId: `blob-${id}`,
    fileName,
    width: 10,
    height: 10,
    adjustment: { brightness: 0, contrast: 0 },
  }
}

const pages = [page('a', 0, 'scan-01.png'), page('b', 1, 'scan-02.png'), page('c', 2)]
const thumbnails = { a: 'blob:a', b: 'blob:b', c: 'blob:c' }

function baseProps() {
  return {
    pages,
    thumbnails,
    selectedPageId: null as string | null,
    onSelect: vi.fn(),
    onReorder: vi.fn(),
    onDelete: vi.fn(),
    onConfirmMerge: vi.fn(),
  }
}

describe('PageList', () => {
  it('renders one row per page in order, showing the file name', () => {
    render(<PageList {...baseProps()} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(screen.getByText('scan-01.png')).toBeInTheDocument()
    expect(screen.getByText('scan-02.png')).toBeInTheDocument()
    // ファイル名を持たない古いページはページ番号にフォールバックする。
    expect(screen.getByText('ページ 3')).toBeInTheDocument()
  })

  it('selects the page and opens an enlarged preview when its thumbnail is clicked', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    fireEvent.click(screen.getByAltText('page 2'))
    expect(props.onSelect).toHaveBeenCalledWith('b')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes the preview modal on Escape', () => {
    render(<PageList {...baseProps()} />)
    fireEvent.click(screen.getByAltText('page 1'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows an undo option instead of calling onDelete immediately', () => {
    vi.useFakeTimers()
    const props = baseProps()
    render(<PageList {...props} />)
    fireEvent.click(screen.getByTestId('delete-a'))
    expect(props.onDelete).not.toHaveBeenCalled()
    expect(screen.getByText('元に戻す')).toBeInTheDocument()
    act(() => {
      vi.runAllTimers()
    })
    expect(props.onDelete).toHaveBeenCalledWith('a')
    vi.useRealTimers()
  })

  it('cancels the deletion when 元に戻す is clicked', () => {
    vi.useFakeTimers()
    const props = baseProps()
    render(<PageList {...props} />)
    fireEvent.click(screen.getByTestId('delete-a'))
    fireEvent.click(screen.getByText('元に戻す'))
    act(() => {
      vi.runAllTimers()
    })
    expect(props.onDelete).not.toHaveBeenCalled()
    expect(screen.getByText('scan-01.png')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('reorders via drag and drop and calls onReorder with the new id order', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    const dragged = screen.getByTestId('page-item-a')
    const target = screen.getByTestId('page-item-c')
    fireEvent.dragStart(dragged)
    fireEvent.dragOver(target)
    fireEvent.drop(target)
    expect(props.onReorder).toHaveBeenCalledWith(['b', 'c', 'a'])
  })

  it('reorders to the front when dragging a later page onto the first page', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    const dragged = screen.getByTestId('page-item-c')
    const target = screen.getByTestId('page-item-a')
    fireEvent.dragStart(dragged)
    fireEvent.dragOver(target)
    fireEvent.drop(target)
    expect(props.onReorder).toHaveBeenCalledWith(['c', 'a', 'b'])
  })

  it('selects two pages for merge via their 見開き結合 buttons, previews, and confirms', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    const mergeButtons = screen.getAllByText('見開き結合')
    fireEvent.click(mergeButtons[0])
    fireEvent.click(mergeButtons[1])
    expect(screen.getByTestId('merge-preview')).toBeInTheDocument()
    fireEvent.click(screen.getByText('結合を確定'))
    expect(props.onConfirmMerge).toHaveBeenCalledWith('a', 'b')
  })

  it('replaces the oldest merge selection when a third page is picked', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    const mergeButtons = screen.getAllByText('見開き結合')
    fireEvent.click(mergeButtons[0])
    fireEvent.click(mergeButtons[1])
    fireEvent.click(mergeButtons[2])
    fireEvent.click(screen.getByText('結合を確定'))
    expect(props.onConfirmMerge).toHaveBeenCalledWith('b', 'c')
  })

  it('defaults to file-name ascending order, shown in the sort status', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    expect(screen.getByTestId('sort-status')).toHaveTextContent('ファイル名(昇順)')
    // 与えられたページは既にファイル名昇順なので、初期化のための並べ替えは走らない。
    expect(props.onReorder).not.toHaveBeenCalled()
  })

  it('sorts by file name ascending/descending when the buttons are clicked', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    fireEvent.click(screen.getByText('ファイル名降順'))
    expect(props.onReorder).toHaveBeenCalledWith(['c', 'b', 'a'])
    expect(screen.getByTestId('sort-status')).toHaveTextContent('ファイル名(降順)')
    fireEvent.click(screen.getByText('ファイル名昇順'))
    expect(props.onReorder).toHaveBeenCalledWith(['a', 'b', 'c'])
    expect(screen.getByTestId('sort-status')).toHaveTextContent('ファイル名(昇順)')
  })

  it('marks the sort status as manual after a drag-and-drop reorder', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    fireEvent.dragStart(screen.getByTestId('page-item-a'))
    fireEvent.dragOver(screen.getByTestId('page-item-c'))
    fireEvent.drop(screen.getByTestId('page-item-c'))
    expect(screen.getByTestId('sort-status')).toHaveTextContent('手動')
  })
})
