import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExportPanel } from './ExportPanel'

describe('ExportPanel', () => {
  it('defaults to PDF and calls onExport with the selected format', async () => {
    const onExport = vi.fn().mockResolvedValue(new Blob(['x']))
    render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() =>
      expect(onExport).toHaveBeenCalledWith('pdf', expect.any(Function), { embedChapters: true }),
    )
  })

  it('calls onExport with epub when the EPUB option is selected', async () => {
    const onExport = vi.fn().mockResolvedValue(new Blob(['x']))
    render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByLabelText('EPUB'))
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() =>
      expect(onExport).toHaveBeenCalledWith('epub', expect.any(Function), { embedChapters: true }),
    )
  })

  it('shows a progress message while exporting, then a download link', async () => {
    let resolveExport: (blob: Blob) => void
    const onExport = vi.fn(
      () => new Promise<Blob>((resolve) => { resolveExport = resolve }),
    )
    render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByText('書き出し'))
    expect(screen.getByTestId('export-progress')).toBeInTheDocument()
    resolveExport!(new Blob(['x']))
    await waitFor(() => expect(screen.getByTestId('download-link')).toBeInTheDocument())
    expect(screen.queryByTestId('export-progress')).not.toBeInTheDocument()
  })

  it('shows an error message when onExport rejects', async () => {
    const onExport = vi.fn().mockRejectedValue(new Error('boom'))
    render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() => expect(screen.getByTestId('export-error')).toHaveTextContent('boom'))
  })

  it('shows the embed checkbox only when there are chapters and passes its value', async () => {
    const onExport = vi.fn(async () => new Blob(['x']))
    const { rerender } = render(<ExportPanel onExport={onExport} chapterCount={0} />)
    expect(screen.queryByLabelText('しおり・目次を埋め込む')).not.toBeInTheDocument()

    rerender(<ExportPanel onExport={onExport} chapterCount={3} />)
    const checkbox = screen.getByLabelText('しおり・目次を埋め込む') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() =>
      expect(onExport).toHaveBeenCalledWith('pdf', expect.any(Function), { embedChapters: false }),
    )
  })
})
