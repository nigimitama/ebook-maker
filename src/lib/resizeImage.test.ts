import { describe, it, expect } from 'vitest'
import { computeTargetSize, resizeImage } from './resizeImage'
import type { RawImage } from '../types'

function checkerboard(w: number, h: number): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4
      const on = (x + y) % 2 === 0
      data[i] = on ? 255 : 0
      data[i + 1] = on ? 255 : 0
      data[i + 2] = on ? 255 : 0
      data[i + 3] = 255
    }
  }
  return { data, width: w, height: h }
}

describe('computeTargetSize', () => {
  it('returns the original size when mode is none', () => {
    expect(computeTargetSize(400, 200, 'none', 1080, 1920)).toEqual({ width: 400, height: 200 })
  })

  it('matches the target width and scales height to preserve aspect ratio', () => {
    expect(computeTargetSize(400, 200, 'width', 1000, 1920)).toEqual({ width: 1000, height: 500 })
  })

  it('matches the target height and scales width to preserve aspect ratio', () => {
    expect(computeTargetSize(400, 200, 'height', 1080, 1000)).toEqual({ width: 2000, height: 1000 })
  })
})

describe('resizeImage', () => {
  it('returns the same object when the target size matches the source', () => {
    const image = checkerboard(2, 2)
    expect(resizeImage(image, 2, 2)).toBe(image)
  })

  it('produces a buffer with the requested dimensions and preserves alpha', () => {
    const image = checkerboard(4, 4)
    const out = resizeImage(image, 2, 2)
    expect(out.width).toBe(2)
    expect(out.height).toBe(2)
    expect(out.data.length).toBe(2 * 2 * 4)
    for (let i = 3; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(255)
    }
  })

  it('does not mutate the input buffer', () => {
    const image = checkerboard(4, 4)
    const copy = new Uint8ClampedArray(image.data)
    resizeImage(image, 2, 2)
    expect(Array.from(image.data)).toEqual(Array.from(copy))
  })
})
