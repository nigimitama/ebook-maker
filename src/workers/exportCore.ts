import { applyAdjustment } from '../lib/applyAdjustment'
import { buildPdf, type ExportPage } from '../lib/pdfExport'
import { buildEpub } from '../lib/epubExport'
import type { AdjustmentParams, BookMetadata, RawImage } from '../types'

export interface ExportRequestPage {
  image: RawImage
  adjustment: AdjustmentParams
}

export interface ExportRequest {
  format: 'pdf' | 'epub'
  metadata: BookMetadata
  pages: ExportRequestPage[]
}

export type PngEncoder = (image: RawImage) => Promise<Uint8Array>

export async function runExport(
  request: ExportRequest,
  encodePng: PngEncoder,
): Promise<Uint8Array> {
  const exportPages: ExportPage[] = []
  for (const page of request.pages) {
    const adjusted = applyAdjustment(page.image, page.adjustment)
    const png = await encodePng(adjusted)
    exportPages.push({ png, width: adjusted.width, height: adjusted.height })
  }
  return request.format === 'pdf'
    ? buildPdf(exportPages, request.metadata)
    : buildEpub(exportPages, request.metadata)
}
