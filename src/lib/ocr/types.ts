export interface Box {
  x: number
  y: number
  w: number
  h: number
} // 原本画像のpx座標

export interface Detection extends Box {
  score: number
  classId: number
  charCount?: number
}

export interface OcrLine extends Box {
  id: string
  text: string
  edited: boolean
  /** 読み順推定で割り当てたブロック(段落)ID。手動追加した行やブロック未使用時はundefined。 */
  blockId?: string
}

export interface OcrResult {
  pageId: string
  lines: OcrLine[] // 配列順が読み順
  modelVersion: string
  updatedAt: number
}
