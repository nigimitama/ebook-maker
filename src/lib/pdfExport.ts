import { PDFDocument, PDFName } from 'pdf-lib'
import type { BookMetadata } from '../types'

export interface ExportPage {
  jpeg: Uint8Array
  width: number
  height: number
}

export async function buildPdf(pages: ExportPage[], metadata: BookMetadata): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  if (metadata.title) doc.setTitle(metadata.title)
  if (metadata.author) doc.setAuthor(metadata.author)

  for (const page of pages) {
    const image = await doc.embedJpg(page.jpeg)
    const pdfPage = doc.addPage([page.width, page.height])
    pdfPage.drawImage(image, { x: 0, y: 0, width: page.width, height: page.height })
  }

  if (pages.length > 0) {
    const firstPage = doc.getPage(0)
    const openAction = doc.context.obj([firstPage.ref, PDFName.of('FitH'), null])
    doc.catalog.set(PDFName.of('OpenAction'), openAction)
  }

  return doc.save()
}
