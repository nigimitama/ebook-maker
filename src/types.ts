// 'none': リサイズしない。'width'/'height': 縦横比を保ったまま指定辺を揃える。
export type ResizeMode = 'none' | 'width' | 'height'

export interface AdjustmentParams {
  brightness: number // -100..100、0で変化なし
  contrast: number // -100..100、0で変化なし
  // リサイズ機能の追加前に保存された調整値は持たないため任意。
  // 未指定は resizeMode==='none' 相当として扱う。
  resizeMode?: ResizeMode
  resizeWidth?: number
  resizeHeight?: number
  // 書き出し時のJPEG品質(1..100)。品質選択の追加前に保存された調整値は
  // 持たないため任意。未指定は DEFAULT_JPEG_QUALITY 相当として扱う。
  quality?: number
}

export const DEFAULT_ADJUSTMENT: AdjustmentParams = { brightness: 0, contrast: 0 }

export const DEFAULT_RESIZE_WIDTH = 1080
export const DEFAULT_RESIZE_HEIGHT = 1920
export const DEFAULT_JPEG_QUALITY = 75

export interface PageEntry {
  id: string
  order: number
  blobId: string
  // ページ一覧の描画に使う原本の縮小版。サムネイル導入前に保存された
  // ページは持たないため任意。読み込み時に生成して埋める。
  // `blobId` は常に無加工の原本を指す。
  thumbBlobId?: string
  // 読み込み元のファイル名。fileName導入前に保存されたページは持たないため任意。
  fileName?: string
  width: number
  height: number
  adjustment: AdjustmentParams
}

export interface BookMetadata {
  title: string
  author: string
}

// DOMの ImageData ({data, width, height}) と構造的に互換だが、画像処理の
// 純関数をブラウザ/canvasなしでユニットテストできるよう独自に定義している。
// jsdomは ImageData を実装していない(jsdom 30で確認: `new window.ImageData(...)`
// は "not a constructor" を投げる)。実際の
// `CanvasRenderingContext2D.getImageData()` の結果はそのままこの型を満たすので、
// 実行時の変換は不要。
export interface RawImage {
  data: Uint8ClampedArray
  width: number
  height: number
}
