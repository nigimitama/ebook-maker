import type { RawImage } from '../../types'
import { resizeImage } from '../resizeImage'
import type { Box } from './types'

// 行の箱を画像から切り出す。範囲外は画像内にクランプし(最小1x1)、
// 縦長(h>w)は反時計回りに90度回転して横長にする。
export function cropLine(img: RawImage, box: Box): RawImage {
  const x0 = Math.min(img.width - 1, Math.max(0, Math.floor(box.x)))
  const y0 = Math.min(img.height - 1, Math.max(0, Math.floor(box.y)))
  const x1 = Math.min(img.width, Math.max(x0 + 1, Math.ceil(box.x + box.w)))
  const y1 = Math.min(img.height, Math.max(y0 + 1, Math.ceil(box.y + box.h)))
  const w = x1 - x0
  const h = y1 - y0
  const crop = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    const src = ((y0 + y) * img.width + x0) * 4
    crop.set(img.data.subarray(src, src + w * 4), y * w * 4)
  }
  if (h <= w) return { data: crop, width: w, height: h }

  // 反時計回り90度: 回転後(x',y')は元の(w-1-y', x')
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < w; y += 1) {
    for (let x = 0; x < h; x += 1) {
      const src = (x * w + (w - 1 - y)) * 4
      out.set(crop.subarray(src, src + 4), (y * h + x) * 4)
    }
  }
  return { data: out, width: h, height: w }
}

// PARSeq用。(W,H)へアスペクト無視でリサイズし、NCHW・RGBで 2*(v/255-0.5) → [-1,1]。
export function lineToTensor(line: RawImage, h: number, w: number): Float32Array {
  const r = resizeImage(line, w, h)
  const plane = h * w
  const out = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i += 1) {
    for (let c = 0; c < 3; c += 1) out[c * plane + i] = 2 * (r.data[i * 4 + c] / 255 - 0.5)
  }
  return out
}
