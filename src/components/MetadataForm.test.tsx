import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MetadataForm } from './MetadataForm'

describe('MetadataForm', () => {
  it('renders the current title and author', () => {
    render(<MetadataForm metadata={{ title: 'T', author: 'A' }} onChange={vi.fn()} />)
    expect(screen.getByTestId('title-input')).toHaveValue('T')
    expect(screen.getByTestId('author-input')).toHaveValue('A')
  })

  it('calls onChange with an updated title, keeping author unchanged', () => {
    const onChange = vi.fn()
    render(<MetadataForm metadata={{ title: 'T', author: 'A' }} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('title-input'), { target: { value: 'New Title' } })
    expect(onChange).toHaveBeenCalledWith({ title: 'New Title', author: 'A' })
  })

  it('calls onChange with an updated author, keeping title unchanged', () => {
    const onChange = vi.fn()
    render(<MetadataForm metadata={{ title: 'T', author: 'A' }} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('author-input'), { target: { value: 'New Author' } })
    expect(onChange).toHaveBeenCalledWith({ title: 'T', author: 'New Author' })
  })
})
