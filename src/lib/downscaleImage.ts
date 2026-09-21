import { fitWithin } from './previewSizes'
import type { RawImage } from '../types'

// decodeImage/encodeImageと同様にブラウザ専用。createImageBitmapがデコード時に
// リサンプリングするため、フル解像度のビットマップは一度も生成されない。
// ユニットテストではなく preview-resolution のE2Eテストで担保している。

// 画素配列は数MBあり、Reactの開発ビルドはpropsやstateの中身を性能トラック用に
// 要素ごと走査するため、そのままpropsで渡すと選択のたびに数秒止まる。
// `data` を列挙不可にすれば走査対象から外れる(参照・読み取りは通常どおり)。
// スプレッドでコピーすると `data` が落ちるので、RawImageは丸ごと渡すこと。
export function hideFromDevtools(image: RawImage): RawImage {
  return Object.defineProperty(
    { width: image.width, height: image.height } as RawImage,
    'data',
    { value: image.data, enumerable: false },
  )
}

export interface Downscaled {
  /** 縮小した画素。調整キャンバスの描画やヒストグラム算出に使う。 */
  image: RawImage
  /** 同じ画素をPNGにしたもの。サムネイルの `<img>` 用。 */
  toBlob: () => Promise<Blob>
  /** 無加工の原本の寸法。書き出すページはこの値を使う必要がある。 */
  originalWidth: number
  originalHeight: number
}

// knownSize を渡すと、寸法取得のためだけに行っていた原本のフルデコードを省ける。
export async function downscale(
  blob: Blob,
  maxEdge: number,
  knownSize?: { width: number; height: number },
): Promise<Downscaled> {
  let originalWidth: number
  let originalHeight: number
  if (knownSize) {
    originalWidth = knownSize.width
    originalHeight = knownSize.height
  } else {
    const probe = await createImageBitmap(blob)
    originalWidth = probe.width
    originalHeight = probe.height
    probe.close()
  }
  const target = fitWithin(originalWidth, originalHeight, maxEdge)

  const bitmap = await createImageBitmap(blob, {
    resizeWidth: target.width,
    resizeHeight: target.height,
    resizeQuality: 'high',
  })

  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('2D canvas context unavailable')
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return {
    image: { data: imageData.data, width: imageData.width, height: imageData.height },
    originalWidth,
    originalHeight,
    toBlob: () =>
      new Promise((resolve, reject) => {
        canvas.toBlob((out) => {
          if (out) resolve(out)
          else reject(new Error('canvas.toBlob failed'))
        }, 'image/png')
      }),
  }
}
