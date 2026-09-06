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
})
