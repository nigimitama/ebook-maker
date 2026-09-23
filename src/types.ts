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

// 章立て(目次)の1項目。開始ページは、並べ替え・削除に追従できるよう番号ではなくIDで持つ。
// level は 1=章, 2=節(2階層まで)。同一ページに複数の章があってよく、その順序は配列順。
export interface Chapter {
  id: string
  title: string
  pageId: string
  level: number
}

/** 目次ページの選択と本文の開始位置。工程を離れて戻っても消えないよう、App側で持つ。 */
export interface TocSelection {
  tocPageIds: string[]
  /** 画像の何枚目が印刷ページ1か(1始まり)。 */
  bodyStart: number
  /** ユーザーが本文の開始位置を直したか。直したあとは目次ページに合わせて動かさない。 */
  bodyStartEdited: boolean
}

export const EMPTY_TOC_SELECTION: TocSelection = { tocPageIds: [], bodyStart: 1, bodyStartEdited: false }

/**
 * どのOCR行をタイトル/著者に含めるか、と自動入力済みのOCR結果。工程を離れて
 * 戻っても消えないよう、App側で持つ。改行でbboxが分かれた行を複数選んで結合
 * できるよう、テキストの完全一致ではなく行IDで持つ。
 */
export interface TitleSelection {
  titleLineIds: readonly string[]
  authorLineIds: readonly string[]
  /** 自動入力に使ったOCR結果の updatedAt。同じ結果で二度自動入力しないために使う。 */
  appliedOcrKey: number | null
}

export const EMPTY_TITLE_SELECTION: TitleSelection = {
  titleLineIds: [],
  authorLineIds: [],
  appliedOcrKey: null,
}

// 書き出し用に、章を書き出し順のページindex(0始まり)へ変換したもの。
export interface ExportChapter {
  title: string
  pageIndex: number
  level: number
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
