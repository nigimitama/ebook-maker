import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildPdf } from './pdfExport'
import { decodeBase64Jpeg } from '../test/jpegFixture'

describe('buildPdf', () => {
  it('builds a PDF with one page per input image and embeds metadata', async () => {
    const jpeg = decodeBase64Jpeg()
    const pages = [
      { jpeg, width: 2, height: 1 },
      { jpeg, width: 2, height: 1 },
    ]
    const bytes = await buildPdf(pages, { title: 'My Book', author: 'Someone' })
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')

    const loaded = await PDFDocument.load(bytes)
    expect(loaded.getPageCount()).toBe(2)
    expect(loaded.getTitle()).toBe('My Book')
    expect(loaded.getAuthor()).toBe('Someone')
    const [page1] = loaded.getPages()
    expect(page1.getWidth()).toBe(2)
    expect(page1.getHeight()).toBe(1)
  })
})
