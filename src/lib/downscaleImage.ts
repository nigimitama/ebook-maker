import { fitWithin } from './previewSizes'
import type { RawImage } from '../types'

// Browser-only, like decodeImage/encodeImage: createImageBitmap resamples
// during decode, so the full-resolution bitmap is never materialized. Covered
// by the preview-resolution E2E test, not by unit tests.

export interface Downscaled {
  /** Downscaled pixels, for the adjustment canvas or a histogram. */
  image: RawImage
  /** The same pixels as a PNG, for a thumbnail `<img>`. */
  toBlob: () => Promise<Blob>
  /** Dimensions of the untouched original — what the exported page must use. */
  originalWidth: number
  originalHeight: number
}

export async function downscale(blob: Blob, maxEdge: number): Promise<Downscaled> {
  const probe = await createImageBitmap(blob)
  const originalWidth = probe.width
  const originalHeight = probe.height
  const target = fitWithin(originalWidth, originalHeight, maxEdge)
  probe.close()

  const bitmap = await createImageBitmap(blob, {
    resizeWidth: target.width,
    resizeHeight: target.height,
    resizeQuality: 'high',
  })

  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('2D canvas context unavailable')
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return {
    image: { data: imageData.data, width: imageData.width, height: imageData.height },
    originalWidth,
    originalHeight,
    toBlob: () =>
      new Promise((resolve, reject) => {
        canvas.toBlob((out) => {
          if (out) resolve(out)
          else reject(new Error('canvas.toBlob failed'))
        }, 'image/png')
      }),
  }
}
