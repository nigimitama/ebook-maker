// Type-checked by tsconfig.worker.json, which supplies the WebWorker lib in
// place of DOM (a `/// <reference lib="webworker" />` here would leak those
// globals into the app project, which shares this file's imports).
import { runExport } from './exportCore'
import type { ExportRequest } from './exportCore'
import type { RawImage } from '../types'

function encodePngViaCanvas(image: RawImage): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('OffscreenCanvas 2D context unavailable'))
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  return canvas.convertToBlob({ type: 'image/png' }).then(async (blob) => {
    return new Uint8Array(await blob.arrayBuffer())
  })
}

// Mirrors src/lib/decodeImage.ts, but with OffscreenCanvas instead of a DOM
// <canvas> — both createImageBitmap and OffscreenCanvas exist in workers.
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
    const bytes = await runExport(event.data, encodePngViaCanvas, decodeBlobViaCanvas)
    ;(self as unknown as Worker).postMessage({ ok: true, bytes }, [bytes.buffer])
  } catch (error) {
    ;(self as unknown as Worker).postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
