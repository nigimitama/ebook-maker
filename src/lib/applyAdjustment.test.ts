import { describe, it, expect } from 'vitest'
import { applyAdjustment } from './applyAdjustment'
import type { RawImage } from '../types'

function gray(value: number, w = 1, h = 1): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = value
    data[i * 4 + 1] = value
    data[i * 4 + 2] = value
    data[i * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}

describe('applyAdjustment', () => {
  it('leaves the image unchanged when brightness=0, contrast=0', () => {
    const out = applyAdjustment(gray(100), { brightness: 0, contrast: 0 })
    expect(Array.from(out.data)).toEqual([100, 100, 100, 255])
  })

  it('adds brightness as a flat offset', () => {
    const out = applyAdjustment(gray(100), { brightness: 20, contrast: 0 })
    expect(out.data[0]).toBe(120)
  })

  it('applies contrast around the midpoint (128)', () => {
    // contrast=100 は係数2: (200-128)*2+128 = 272 → 255に丸められる
    const out = applyAdjustment(gray(200), { brightness: 0, contrast: 100 })
    expect(out.data[0]).toBe(255)
    // contrast=-100 は係数0: どの値も128に収束する
    const out2 = applyAdjustment(gray(200), { brightness: 0, contrast: -100 })
    expect(out2.data[0]).toBe(128)
  })

  it('clamps output to the 0..255 range', () => {
    const out = applyAdjustment(gray(10), { brightness: -50, contrast: 0 })
    expect(out.data[0]).toBe(0)
  })

  it('preserves alpha and does not mutate the input', () => {
    const input = gray(50)
    const inputCopy = new Uint8ClampedArray(input.data)
    const out = applyAdjustment(input, { brightness: 10, contrast: 10 })
    expect(out.data[3]).toBe(255)
    expect(Array.from(input.data)).toEqual(Array.from(inputCopy))
  })

  it('leaves the size unchanged when resizeMode is missing or none', () => {
    const image = gray(100, 4, 2)
    expect(applyAdjustment(image, { brightness: 0, contrast: 0 }).width).toBe(4)
    expect(
      applyAdjustment(image, { brightness: 0, contrast: 0, resizeMode: 'none' }).height,
    ).toBe(2)
  })

  it('resizes to the requested width, preserving aspect ratio', () => {
    const image = gray(100, 4, 2)
    const out = applyAdjustment(image, { brightness: 0, contrast: 0, resizeMode: 'width', resizeWidth: 8 })
    expect(out.width).toBe(8)
    expect(out.height).toBe(4)
  })

  it('resizes to the requested height, preserving aspect ratio', () => {
    const image = gray(100, 4, 2)
    const out = applyAdjustment(image, {
      brightness: 0,
      contrast: 0,
      resizeMode: 'height',
      resizeHeight: 8,
    })
    expect(out.height).toBe(8)
    expect(out.width).toBe(16)
  })

  it('falls back to the default target size when resizeWidth/resizeHeight are missing', () => {
    const image = gray(100, 1080, 1920)
    const out = applyAdjustment(image, { brightness: 0, contrast: 0, resizeMode: 'width' })
    expect(out.width).toBe(1080)
  })
})
