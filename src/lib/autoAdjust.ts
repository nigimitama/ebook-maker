import type { AdjustmentParams, RawImage } from '../types'

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

export function computeAutoAdjustment(image: RawImage): AdjustmentParams {
  const src = image.data
  const pixelCount = src.length / 4
  const values = new Uint8ClampedArray(pixelCount)
  for (let i = 0; i < pixelCount; i += 1) {
    values[i] = luminance(src[i * 4], src[i * 4 + 1], src[i * 4 + 2])
  }
  const sorted = Array.from(values).sort((a, b) => a - b)
  const lo = sorted[Math.floor(sorted.length * 0.01)]
  const hi = sorted[Math.ceil(sorted.length * 0.99) - 1]
  const range = Math.max(hi - lo, 1)
  const factor = clamp(255 / range, 0.1, 4)
  const mid = (lo + hi) / 2
  const contrast = clamp(factor * 100 - 100, -100, 100)
  const brightness = clamp(-(mid - 128) * factor, -100, 100)
  return { brightness: Math.round(brightness), contrast: Math.round(contrast) }
}
