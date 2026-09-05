/// <reference lib="webworker" />
import { runExport } from './exportCore'
import type { ExportRequest } from './exportCore'
import type { RawImage } from '../types'

function encodePngViaCanvas(image: RawImage): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('OffscreenCanvas 2D context unavailable'))
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0)
  return canvas.convertToBlob({ type: 'image/png' }).then(async (blob) => {
    return new Uint8Array(await blob.arrayBuffer())
  })
}

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  try {
    const bytes = await runExport(event.data, encodePngViaCanvas)
    ;(self as unknown as Worker).postMessage({ ok: true, bytes }, [bytes.buffer])
  } catch (error) {
    ;(self as unknown as Worker).postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
