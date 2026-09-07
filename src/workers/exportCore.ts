import { applyAdjustment } from '../lib/applyAdjustment'
import { buildPdf, type ExportPage } from '../lib/pdfExport'
import { buildEpub } from '../lib/epubExport'
import { DEFAULT_JPEG_QUALITY } from '../types'
import type { AdjustmentParams, BookMetadata, RawImage } from '../types'

// ページはデコード済みRGBA画素ではなく、原本のBlobと調整パラメータの形で
// Workerへ渡す。構造化複製は Uint8ClampedArray をバイト単位でコピーする
// (A4スキャン1枚あたり約15MB × 200ページ)のに対し、Blobは保存済みデータへの
// 参照として複製されるため。デコードはWorker内で1ページずつ行うので、
// ピーク時のメモリ使用量が抑えられる。
export interface ExportRequestPage {
  blob: Blob
  adjustment: AdjustmentParams
}

export interface ExportRequest {
  format: 'pdf' | 'epub'
  metadata: BookMetadata
  pages: ExportRequestPage[]
}

export type JpegEncoder = (image: RawImage, quality: number) => Promise<Uint8Array>
export type BlobDecoder = (blob: Blob) => Promise<RawImage>
export type ExportProgress = (done: number, total: number) => void

export async function runExport(
  request: ExportRequest,
  encodeJpeg: JpegEncoder,
  decodeBlob: BlobDecoder,
  onProgress?: ExportProgress,
): Promise<Uint8Array> {
  const exportPages: ExportPage[] = []
  const total = request.pages.length
  for (const [index, page] of request.pages.entries()) {
    const decoded = await decodeBlob(page.blob)
    const adjusted = applyAdjustment(decoded, page.adjustment)
    const quality = page.adjustment.quality ?? DEFAULT_JPEG_QUALITY
    const jpeg = await encodeJpeg(adjusted, quality)
    exportPages.push({ jpeg, width: adjusted.width, height: adjusted.height })
    onProgress?.(index + 1, total)
  }
  return request.format === 'pdf'
    ? buildPdf(exportPages, request.metadata)
    : buildEpub(exportPages, request.metadata)
}
