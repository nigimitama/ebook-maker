import type { AdjustmentParams, RawImage } from '../types'

export function applyAdjustment(image: RawImage, params: AdjustmentParams): RawImage {
  const factor = (100 + params.contrast) / 100
  const src = image.data
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < src.length; i += 4) {
    out[i] = (src[i] - 128) * factor + 128 + params.brightness
    out[i + 1] = (src[i + 1] - 128) * factor + 128 + params.brightness
    out[i + 2] = (src[i + 2] - 128) * factor + 128 + params.brightness
    out[i + 3] = src[i + 3]
  }
  return { data: out, width: image.width, height: image.height }
}
