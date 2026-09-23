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

  // 書き出し後に形式を変えると、古いBlob(PDF)が新しい拡張子(.epub)で落ちてしまう。
  it('hides the download link when the format changes after exporting', async () => {
    const onExport = vi.fn(async () => new Blob(['x']))
    render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() => expect(screen.getByTestId('download-link')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('EPUB'))
    expect(screen.queryByTestId('download-link')).not.toBeInTheDocument()
  })

  it('hides the download link when the embed option changes after exporting', async () => {
    const onExport = vi.fn(async () => new Blob(['x']))
    render(<ExportPanel onExport={onExport} chapterCount={2} />)
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() => expect(screen.getByTestId('download-link')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('しおり・目次を埋め込む'))
    expect(screen.queryByTestId('download-link')).not.toBeInTheDocument()
  })

  it('names the file after the format actually exported, even if switched mid-export', async () => {
    let resolveExport: (blob: Blob) => void
    const onExport = vi.fn(() => new Promise<Blob>((resolve) => { resolveExport = resolve }))
    render(<ExportPanel onExport={onExport} title="本" />)
    fireEvent.click(screen.getByText('書き出し'))
    fireEvent.click(screen.getByLabelText('EPUB'))
    resolveExport!(new Blob(['x']))
    await waitFor(() => expect(screen.getByTestId('download-link')).toHaveAttribute('download', '本.pdf'))
  })

  it('releases the previous object URL when exporting again and on unmount', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    let n = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++n}`)
    const onExport = vi.fn(async () => new Blob(['x']))
    const { unmount } = render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() => expect(screen.getByTestId('download-link')).toHaveAttribute('href', 'blob:1'))
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() => expect(screen.getByTestId('download-link')).toHaveAttribute('href', 'blob:2'))
    expect(revoke).toHaveBeenCalledWith('blob:1')
    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:2')
    vi.restoreAllMocks()
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
