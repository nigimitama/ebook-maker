import type { RawImage } from '../types'

export function mergeSpread(left: RawImage, right: RawImage): RawImage {
  const width = left.width + right.width
  const height = Math.max(left.height, right.height)
  const data = new Uint8ClampedArray(width * height * 4).fill(255)

  const blit = (src: RawImage, xOffset: number) => {
    for (let y = 0; y < src.height; y += 1) {
      for (let x = 0; x < src.width; x += 1) {
        const srcI = (y * src.width + x) * 4
        const dstI = (y * width + (x + xOffset)) * 4
        data[dstI] = src.data[srcI]
        data[dstI + 1] = src.data[srcI + 1]
        data[dstI + 2] = src.data[srcI + 2]
        data[dstI + 3] = src.data[srcI + 3]
      }
    }
  }

  blit(left, 0)
  blit(right, left.width)

  return { data, width, height }
}
