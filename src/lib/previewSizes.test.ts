import { describe, it, expect } from 'vitest'
import { fitWithin, THUMBNAIL_MAX_EDGE, PREVIEW_MAX_EDGE } from './previewSizes'

describe('fitWithin', () => {
  it('scales a portrait scan down so its long edge hits the cap', () => {
    expect(fitWithin(2480, 3508, 320)).toEqual({ width: 226, height: 320 })
  })

  it('scales a landscape image down by its width instead', () => {
    expect(fitWithin(3508, 2480, 320)).toEqual({ width: 320, height: 226 })
  })

  it('leaves an image already within the cap untouched', () => {
    expect(fitWithin(100, 140, 320)).toEqual({ width: 100, height: 140 })
  })

  it('never rounds an extreme aspect ratio down to zero', () => {
    const { width, height } = fitWithin(4000, 3, 320)
    expect(width).toBe(320)
    expect(height).toBe(1)
  })

  it('caps the thumbnail far smaller than the adjustment preview', () => {
    expect(THUMBNAIL_MAX_EDGE).toBeLessThan(PREVIEW_MAX_EDGE)
  })
})
