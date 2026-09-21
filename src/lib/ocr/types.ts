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
}

export interface OcrResult {
  pageId: string
  lines: OcrLine[] // 配列順が読み順
  modelVersion: string
  updatedAt: number
}
