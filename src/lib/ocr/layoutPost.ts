import { OCR_CONFIG } from './ocrConfig'
import type { Detection } from './types'

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

// DEIMの生出力を原本座標のDetectionにする。
// - class = label-1(labelは1始まり)
// - 下流で使うのは行クラス(lineClassIds)だけ。text_block(段境界)など
//   それ以外のクラスはここで捨てる。
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
): Detection[] {
  const { scoreThreshold, lineBoxPadRatio, minBoxPx, lineClassIds } = OCR_CONFIG.layout
  const lineIds: readonly number[] = lineClassIds
  const out: Detection[] = []
  for (let i = 0; i < raw.scores.length; i += 1) {
    const score = raw.scores[i]
    if (score < scoreThreshold) continue
    const classId = Number(raw.classIds[i]) - 1
    if (!lineIds.includes(classId)) continue
    // 検出座標(x1,y1,x2,y2)を原本座標へ。行bboxは上下を2%拡張してから画像内に丸める。
    const x1 = raw.boxes[i * 4] / scale
    const y1 = raw.boxes[i * 4 + 1] / scale
    const x2 = raw.boxes[i * 4 + 2] / scale
    const y2 = raw.boxes[i * 4 + 3] / scale
    const pad = (y2 - y1) * lineBoxPadRatio
    const cx1 = Math.max(0, x1)
    const cy1 = Math.max(0, y1 - pad)
    const cx2 = Math.min(imgW, x2)
    const cy2 = Math.min(imgH, y2 + pad)
    const w = cx2 - cx1
    const h = cy2 - cy1
    if (w < minBoxPx || h < minBoxPx) continue
    const det: Detection = { x: cx1, y: cy1, w, h, score, classId }
    if (raw.charCounts) det.charCount = Number(raw.charCounts[i])
    out.push(det)
  }
  return out
}
