import { describe, it, expect } from 'vitest'
import { mergeSpread } from './mergeSpread'
import type { RawImage } from '../types'

function solid(w: number, h: number, r: number, g: number, b: number): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}

function pixelAt(img: RawImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}

describe('mergeSpread', () => {
  it('places left image at the left half and right image at the right half', () => {
    const left = solid(2, 2, 255, 0, 0)
    const right = solid(2, 2, 0, 255, 0)
    const merged = mergeSpread(left, right)
    expect(merged.width).toBe(4)
    expect(merged.height).toBe(2)
    expect(pixelAt(merged, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixelAt(merged, 3, 0)).toEqual([0, 255, 0, 255])
  })

  it('uses the taller image height and pads the shorter one with white', () => {
    const left = solid(2, 4, 10, 10, 10)
    const right = solid(2, 2, 20, 20, 20)
    const merged = mergeSpread(left, right)
    expect(merged.height).toBe(4)
    expect(pixelAt(merged, 3, 3)).toEqual([255, 255, 255, 255])
  })
})
