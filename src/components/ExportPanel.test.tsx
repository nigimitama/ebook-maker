import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExportPanel } from './ExportPanel'

describe('ExportPanel', () => {
  it('defaults to PDF and calls onExport with the selected format', async () => {
    const onExport = vi.fn().mockResolvedValue(new Blob(['x']))
    render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() => expect(onExport).toHaveBeenCalledWith('pdf'))
  })

  it('calls onExport with epub when the EPUB option is selected', async () => {
    const onExport = vi.fn().mockResolvedValue(new Blob(['x']))
    render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByLabelText('EPUB'))
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() => expect(onExport).toHaveBeenCalledWith('epub'))
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
})
