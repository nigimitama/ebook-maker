import { describe, it, expect } from 'vitest'
import { letterboxToTensor } from './layoutPre'
import { OCR_CONFIG } from './ocrConfig'
import type { RawImage } from '../../types'

const white2x1: RawImage = {
  data: new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]),
  width: 2,
  height: 1,
}

describe('letterboxToTensor', () => {
  it('2x1画像をsize=4に入れると左上寄せで下が黒パディングされ、scale=2', () => {
    const { data, scale } = letterboxToTensor(white2x1, 4)
    expect(scale).toBe(2)
    expect(data).toBeInstanceOf(Float32Array)
    expect(data.length).toBe(3 * 4 * 4)
    const { mean, std } = OCR_CONFIG.layout
    const plane = 16
    for (let c = 0; c < 3; c += 1) {
      const white = (255 - mean[c]) / std[c]
      const black = (0 - mean[c]) / std[c]
      // 画像領域(行0,1)は白、パディング(行2,3)は黒。NCHWなのでチャンネルごとの面に並ぶ
      expect(data[c * plane]).toBeCloseTo(white, 5)
      expect(data[c * plane + 1 * 4 + 3]).toBeCloseTo(white, 5)
      expect(data[c * plane + 2 * 4 + 0]).toBeCloseTo(black, 5)
      expect(data[c * plane + 3 * 4 + 3]).toBeCloseTo(black, 5)
    }
  })
  it('縦長画像は右側がパディングされる', () => {
    const tall: RawImage = { data: new Uint8ClampedArray(2 * 4).fill(255), width: 1, height: 2 }
    const { data, scale } = letterboxToTensor(tall, 4)
    expect(scale).toBe(2)
    const { mean, std } = OCR_CONFIG.layout
    expect(data[0]).toBeCloseTo((255 - mean[0]) / std[0], 5)
    expect(data[3]).toBeCloseTo((0 - mean[0]) / std[0], 5) // 行0の右端
  })
})
