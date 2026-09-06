import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImportPanel } from './ImportPanel'

function makeImageFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

describe('ImportPanel', () => {
  it('calls onImport with dropped image files, ignoring non-image files', () => {
    const onImport = vi.fn()
    render(<ImportPanel onImport={onImport} />)
    const dropzone = screen.getByTestId('import-dropzone')
    const imageFile = makeImageFile('a.png')
    const textFile = new File(['x'], 'a.txt', { type: 'text/plain' })
    fireEvent.drop(dropzone, { dataTransfer: { files: [imageFile, textFile] } })
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onImport).toHaveBeenCalledWith([imageFile])
  })

  it('calls onImport with image files inside a dropped folder', async () => {
    const onImport = vi.fn()
    render(<ImportPanel onImport={onImport} />)
    const dropzone = screen.getByTestId('import-dropzone')
    const imageFile = makeImageFile('d.png')

    const fileEntry = {
      isFile: true,
      isDirectory: false,
      file: (resolve: (file: File) => void) => resolve(imageFile),
    }
    let readCalls = 0
    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (resolve: (entries: unknown[]) => void) => {
          readCalls += 1
          resolve(readCalls === 1 ? [fileEntry] : [])
        },
      }),
    }
    const item = { webkitGetAsEntry: () => directoryEntry }

    fireEvent.drop(dropzone, { dataTransfer: { items: [item], files: [] } })
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledWith([imageFile]))
  })

  it('calls onImport with files chosen via the file picker input', () => {
    const onImport = vi.fn()
    render(<ImportPanel onImport={onImport} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    const imageFile = makeImageFile('b.png')
    fireEvent.change(input, { target: { files: [imageFile] } })
    expect(onImport).toHaveBeenCalledWith([imageFile])
  })

  it('calls onImport with files chosen via the folder picker input', () => {
    const onImport = vi.fn()
    render(<ImportPanel onImport={onImport} />)
    const input = screen.getByTestId('folder-input') as HTMLInputElement
    const imageFile = makeImageFile('c.png')
    fireEvent.change(input, { target: { files: [imageFile] } })
    expect(onImport).toHaveBeenCalledWith([imageFile])
  })

  it('does not call onImport when no image files are present', () => {
    const onImport = vi.fn()
    render(<ImportPanel onImport={onImport} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } })
    expect(onImport).not.toHaveBeenCalled()
  })

  it('does not show a registered-count message when no files are registered', () => {
    render(<ImportPanel onImport={vi.fn()} />)
    expect(screen.queryByTestId('import-count')).not.toBeInTheDocument()
  })

  it('shows the registered-count message when files are already registered', () => {
    render(<ImportPanel onImport={vi.fn()} pageCount={3} />)
    expect(screen.getByTestId('import-count')).toHaveTextContent('3件登録済み')
  })

  it('does not show a clear-all button when onClearAll is not provided', () => {
    render(<ImportPanel onImport={vi.fn()} pageCount={3} />)
    expect(screen.queryByTestId('clear-all-button')).not.toBeInTheDocument()
  })

  it('calls onClearAll after confirmation when the clear-all button is clicked', () => {
    const onClearAll = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ImportPanel onImport={vi.fn()} pageCount={3} onClearAll={onClearAll} />)
    fireEvent.click(screen.getByTestId('clear-all-button'))
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })

  it('does not call onClearAll when the confirmation is dismissed', () => {
    const onClearAll = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ImportPanel onImport={vi.fn()} pageCount={3} onClearAll={onClearAll} />)
    fireEvent.click(screen.getByTestId('clear-all-button'))
    expect(onClearAll).not.toHaveBeenCalled()
  })
})
