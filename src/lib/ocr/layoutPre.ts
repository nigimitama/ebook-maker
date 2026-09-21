import type { RawImage } from '../../types'
import { resizeImage } from '../resizeImage'
import { OCR_CONFIG } from './ocrConfig'

// DEIM用の前処理。長辺を size に合わせてアスペクト維持でリサイズし、
// 左上寄せで黒(0,0,0)パディングして size×size にする。
// NCHW・RGBで、0-255の値に対し (v-mean)/std で正規化する。
// scale = size / 長辺。検出座標は /scale で原本座標へ戻る。
export function letterboxToTensor(img: RawImage, size: number): { data: Float32Array; scale: number } {
  const { mean, std } = OCR_CONFIG.layout
  const scale = size / Math.max(img.width, img.height)
  const resized = resizeImage(img, Math.min(size, Math.round(img.width * scale)), Math.min(size, Math.round(img.height * scale)))
  const plane = size * size
  const data = new Float32Array(3 * plane)
  // パディング部は黒(0)を正規化した値で埋める
  for (let c = 0; c < 3; c += 1) data.fill(-mean[c] / std[c], c * plane, (c + 1) * plane)
  for (let y = 0; y < resized.height; y += 1) {
    for (let x = 0; x < resized.width; x += 1) {
      const src = (y * resized.width + x) * 4
      const dst = y * size + x
      for (let c = 0; c < 3; c += 1) data[c * plane + dst] = (resized.data[src + c] - mean[c]) / std[c]
    }
  }
  return { data, scale }
}
