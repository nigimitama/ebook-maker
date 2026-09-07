import type { RawImage, ResizeMode } from '../types'

// 指定モードに合わせて出力サイズを決める。縦横比は常に維持する。
// 'none' のときは何もしない(元のサイズをそのまま返す)。
export function computeTargetSize(
  width: number,
  height: number,
  mode: ResizeMode,
  targetWidth: number,
  targetHeight: number,
): { width: number; height: number } {
  if (mode === 'width') {
    const w = Math.max(1, Math.round(targetWidth))
    return { width: w, height: Math.max(1, Math.round((height / width) * w)) }
  }
  if (mode === 'height') {
    const h = Math.max(1, Math.round(targetHeight))
    return { width: Math.max(1, Math.round((width / height) * h)), height: h }
  }
  return { width, height }
}

// バイリニア補間によるリサイズ。ブラウザ/Worker双方の<canvas>に依存せず
// 純粋な計算だけで行う(applyAdjustmentがWorker内で呼ばれるため)。
export function resizeImage(image: RawImage, targetWidth: number, targetHeight: number): RawImage {
  const width = Math.max(1, Math.round(targetWidth))
  const height = Math.max(1, Math.round(targetHeight))
  if (width === image.width && height === image.height) return image

  const src = image.data
  const sw = image.width
  const sh = image.height
  const out = new Uint8ClampedArray(width * height * 4)
  const xRatio = sw / width
  const yRatio = sh / height

  for (let y = 0; y < height; y += 1) {
    const srcY = Math.min(sh - 1, Math.max(0, (y + 0.5) * yRatio - 0.5))
    const y0 = Math.floor(srcY)
    const y1 = Math.min(sh - 1, y0 + 1)
    const wy = srcY - y0
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.min(sw - 1, Math.max(0, (x + 0.5) * xRatio - 0.5))
      const x0 = Math.floor(srcX)
      const x1 = Math.min(sw - 1, x0 + 1)
      const wx = srcX - x0
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const outIdx = (y * width + x) * 4
      for (let c = 0; c < 4; c += 1) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * wx
        const bottom = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * wx
        out[outIdx + c] = top + (bottom - top) * wy
      }
    }
  }
  return { data: out, width, height }
}
