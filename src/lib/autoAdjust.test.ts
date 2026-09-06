import { describe, it, expect } from 'vitest'
import { computeAutoAdjustment } from './autoAdjust'
import type { RawImage } from '../types'

function image(values: number[]): RawImage {
  const data = new Uint8ClampedArray(values.length * 4)
  values.forEach((v, i) => {
    data[i * 4] = v
    data[i * 4 + 1] = v
    data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  })
  return { data, width: values.length, height: 1 }
}

describe('computeAutoAdjustment', () => {
  it('returns near-zero adjustment for an already-flat 0..255 image', () => {
    const values = Array.from({ length: 101 }, (_, i) => Math.round((i / 100) * 255))
    const result = computeAutoAdjustment(image(values))
    expect(Math.abs(result.brightness)).toBeLessThan(5)
    expect(Math.abs(result.contrast)).toBeLessThan(5)
  })

  it('boosts contrast for a low-contrast (narrow range) scan', () => {
    // 全画素が100..150に固まっている、コントラストの浅いスキャン
    const values = Array.from({ length: 51 }, (_, i) => 100 + i)
    const result = computeAutoAdjustment(image(values))
    expect(result.contrast).toBeGreaterThan(0)
  })

  it('shifts brightness for a dark image toward mid-gray', () => {
    const values = Array.from({ length: 51 }, () => 40)
    const result = computeAutoAdjustment(image(values))
    expect(result.brightness).toBeGreaterThan(0)
  })

  it('clamps returned params to -100..100', () => {
    const values = Array.from({ length: 10 }, () => 0)
    const result = computeAutoAdjustment(image(values))
    expect(result.brightness).toBeLessThanOrEqual(100)
    expect(result.brightness).toBeGreaterThanOrEqual(-100)
    expect(result.contrast).toBeLessThanOrEqual(100)
    expect(result.contrast).toBeGreaterThanOrEqual(-100)
  })
})
