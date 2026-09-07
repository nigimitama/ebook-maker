// 型チェックは tsconfig.worker.json が担当し、DOMの代わりにWebWorkerのlibを
// 与える(ここに `/// <reference lib="webworker" />` を書くと、このファイルの
// importを共有するappプロジェクト側にWorkerのグローバルが漏れてしまう)。
import { runExport } from './exportCore'
import type { ExportRequest } from './exportCore'
import type { RawImage } from '../types'

function encodeJpegViaCanvas(image: RawImage, quality: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('OffscreenCanvas 2D context unavailable'))
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  return canvas
    .convertToBlob({ type: 'image/jpeg', quality: Math.min(100, Math.max(1, quality)) / 100 })
    .then(async (blob) => {
      return new Uint8Array(await blob.arrayBuffer())
    })
}

// src/lib/decodeImage.ts と同じ処理を、DOMの<canvas>ではなく
// OffscreenCanvasで行う。createImageBitmapとOffscreenCanvasはどちらも
// Worker内で利用できる。
async function decodeBlobViaCanvas(blob: Blob): Promise<RawImage> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    return { data: imageData.data, width: imageData.width, height: imageData.height }
  } finally {
    bitmap.close()
  }
}

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  try {
    const bytes = await runExport(event.data, encodeJpegViaCanvas, decodeBlobViaCanvas, (done, total) => {
      ;(self as unknown as Worker).postMessage({ type: 'progress', done, total })
    })
    ;(self as unknown as Worker).postMessage({ ok: true, bytes }, [bytes.buffer])
  } catch (error) {
    ;(self as unknown as Worker).postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
