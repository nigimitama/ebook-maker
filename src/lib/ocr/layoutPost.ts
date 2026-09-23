import { OCR_CONFIG } from './ocrConfig'
import type { Box, Detection } from './types'

function iou(a: Detection, b: Detection): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const inter = ix * iy
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

// スコア降順に貪欲に採用し、採用済みとIoUが閾値を超える箱を捨てる。
export function nms(dets: Detection[], iouThreshold: number): Detection[] {
  const sorted = dets.slice().sort((a, b) => b.score - a.score)
  const kept: Detection[] = []
  for (const d of sorted) {
    if (kept.every((k) => iou(k, d) <= iouThreshold)) kept.push(d)
  }
  return kept
}

export interface DetectionResult {
  lines: Detection[]
  /** text_block(段・カラム境界)。パディング拡張・NMSはかけない。 */
  blocks: Box[]
}

// DEIMの生出力を原本座標のDetectionにする。
// - class = label-1(labelは1始まり)
// - 行クラス(lineClassIds)は上下2%拡張してNMSの対象にする。
// - ブロック(blockClassId=text_block、段境界)は拡張せず別枠のblocksとして返す。
// - char_count は int64 なので BigInt64Array で受け、Number() に変換する。
export function decodeDetections(
  raw: {
    boxes: Float32Array
    scores: Float32Array
    classIds: Int32Array | BigInt64Array
    charCounts?: BigInt64Array
  },
  scale: number,
  imgW: number,
  imgH: number,
): DetectionResult {
  const { scoreThreshold, lineBoxPadRatio, minBoxPx, lineClassIds, blockClassId } = OCR_CONFIG.layout
  const lineIds: readonly number[] = lineClassIds
  const lines: Detection[] = []
  const blocks: Box[] = []
  for (let i = 0; i < raw.scores.length; i += 1) {
    const score = raw.scores[i]
    if (score < scoreThreshold) continue
    const classId = Number(raw.classIds[i]) - 1
    const x1raw = raw.boxes[i * 4] / scale
    const y1raw = raw.boxes[i * 4 + 1] / scale
    const x2raw = raw.boxes[i * 4 + 2] / scale
    const y2raw = raw.boxes[i * 4 + 3] / scale

    if (classId === blockClassId) {
      const bx1 = Math.max(0, x1raw)
      const by1 = Math.max(0, y1raw)
      const bx2 = Math.min(imgW, x2raw)
      const by2 = Math.min(imgH, y2raw)
      const bw = bx2 - bx1
      const bh = by2 - by1
      if (bw < minBoxPx || bh < minBoxPx) continue
      blocks.push({ x: bx1, y: by1, w: bw, h: bh })
      continue
    }
    if (!lineIds.includes(classId)) continue
    // 行bboxは上下を2%拡張してから画像内に丸める。
    const pad = (y2raw - y1raw) * lineBoxPadRatio
    const cx1 = Math.max(0, x1raw)
    const cy1 = Math.max(0, y1raw - pad)
    const cx2 = Math.min(imgW, x2raw)
    const cy2 = Math.min(imgH, y2raw + pad)
    const w = cx2 - cx1
    const h = cy2 - cy1
    if (w < minBoxPx || h < minBoxPx) continue
    const det: Detection = { x: cx1, y: cy1, w, h, score, classId }
    if (raw.charCounts) det.charCount = Number(raw.charCounts[i])
    lines.push(det)
  }
  return { lines, blocks }
}
