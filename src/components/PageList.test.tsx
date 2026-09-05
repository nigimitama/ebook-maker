import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PageList } from './PageList'
import type { PageEntry } from '../types'

function page(id: string, order: number): PageEntry {
  return { id, order, blobId: `blob-${id}`, width: 10, height: 10, adjustment: { brightness: 0, contrast: 0 } }
}

const pages = [page('a', 0), page('b', 1), page('c', 2)]
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
  it('renders one item per page in order', () => {
    render(<PageList {...baseProps()} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
  })

  it('calls onSelect with the page id when a thumbnail is clicked', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    fireEvent.click(screen.getByAltText('page 2'))
    expect(props.onSelect).toHaveBeenCalledWith('b')
  })

  it('calls onDelete with the page id when its delete button is clicked', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    fireEvent.click(screen.getByTestId('delete-a'))
    expect(props.onDelete).toHaveBeenCalledWith('a')
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

  it('enters merge mode, previews the two selected pages, and confirms the merge', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    fireEvent.click(screen.getByText('見開き結合'))
    fireEvent.click(screen.getByTestId('merge-checkbox-a'))
    fireEvent.click(screen.getByTestId('merge-checkbox-b'))
    expect(screen.getByTestId('merge-preview')).toBeInTheDocument()
    fireEvent.click(screen.getByText('結合を確定'))
    expect(props.onConfirmMerge).toHaveBeenCalledWith('a', 'b')
  })

  it('does not allow selecting a third page for merge', () => {
    render(<PageList {...baseProps()} />)
    fireEvent.click(screen.getByText('見開き結合'))
    fireEvent.click(screen.getByTestId('merge-checkbox-a'))
    fireEvent.click(screen.getByTestId('merge-checkbox-b'))
    expect(screen.getByTestId('merge-checkbox-c')).toBeDisabled()
  })
})
