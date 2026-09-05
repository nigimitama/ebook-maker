import { applyAdjustment } from '../lib/applyAdjustment'
import { buildPdf, type ExportPage } from '../lib/pdfExport'
import { buildEpub } from '../lib/epubExport'
import type { AdjustmentParams, BookMetadata, RawImage } from '../types'

// Pages travel to the worker as the ORIGINAL image Blob plus its adjustment
// parameters, never as decoded RGBA pixels: structured clone copies a
// Uint8ClampedArray byte-for-byte (~15MB per A4 scan, x200 pages), while a
// Blob clones by reference to its already-stored data. Decoding happens
// inside the worker, one page at a time, so peak memory stays bounded.
export interface ExportRequestPage {
  blob: Blob
  adjustment: AdjustmentParams
}

export interface ExportRequest {
  format: 'pdf' | 'epub'
  metadata: BookMetadata
  pages: ExportRequestPage[]
}

export type PngEncoder = (image: RawImage) => Promise<Uint8Array>
export type BlobDecoder = (blob: Blob) => Promise<RawImage>

export async function runExport(
  request: ExportRequest,
  encodePng: PngEncoder,
  decodeBlob: BlobDecoder,
): Promise<Uint8Array> {
  const exportPages: ExportPage[] = []
  for (const page of request.pages) {
    const decoded = await decodeBlob(page.blob)
    const adjusted = applyAdjustment(decoded, page.adjustment)
    const png = await encodePng(adjusted)
    exportPages.push({ png, width: adjusted.width, height: adjusted.height })
  }
  return request.format === 'pdf'
    ? buildPdf(exportPages, request.metadata)
    : buildEpub(exportPages, request.metadata)
}
