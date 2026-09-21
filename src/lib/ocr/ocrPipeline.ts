import type { RawImage } from '../../types'
import { letterboxToTensor } from './layoutPre'
import { decodeDetections, nms } from './layoutPost'
import { OCR_CONFIG, type RecognizerKey } from './ocrConfig'
import { sortReadingOrder } from './readingOrder'
import { cropLine, lineToTensor } from './recognizePre'
import { decodeSequence, pickRecognizer } from './recognizePost'
import type { OcrLine, OcrResult } from './types'

// ONNXセッションをここで抽象化する。実体は Worker 側で ort から作り、
// テストでは偽のセッションを差し込む(runOcr 自体は ort に依存しない)。
export interface OcrSessions {
  detect(
    tensor: Float32Array,
    size: number,
  ): Promise<{
    boxes: Float32Array
    scores: Float32Array
    classIds: Int32Array | BigInt64Array
    charCounts?: BigInt64Array
  }>
  recognize(
    key: RecognizerKey,
    tensor: Float32Array,
  ): Promise<{ logits: Float32Array; seqLen: number; vocab: number }>
}

let idCounter = 0
function newLineId(): string {
  idCounter += 1
  return `line-${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`
}

// 1ページ分のOCR。レイアウト検出 -> 行の抽出 -> 読み順 -> 行ごとの文字認識。
// 行ごとに逐次実行する(同時実行するとメモリを食うため。バッチ化はしない)。
export async function runOcr(
  img: RawImage,
  sessions: OcrSessions,
  charset: string[],
): Promise<Omit<OcrResult, 'pageId' | 'modelVersion' | 'updatedAt'>> {
  const size = OCR_CONFIG.layout.inputSize
  const { data, scale } = letterboxToTensor(img, size)
  const raw = await sessions.detect(data, size)
  const dets = decodeDetections(raw, scale, img.width, img.height)
  const ordered = sortReadingOrder(nms(dets, OCR_CONFIG.layout.nmsIou))

  const lines: OcrLine[] = []
  for (const det of ordered) {
    const key = pickRecognizer(det.charCount, det)
    const spec = OCR_CONFIG.recognizers[key]
    const tensor = lineToTensor(cropLine(img, det), spec.height, spec.width)
    const { logits, seqLen, vocab } = await sessions.recognize(key, tensor)
    lines.push({
      id: newLineId(),
      x: det.x,
      y: det.y,
      w: det.w,
      h: det.h,
      text: decodeSequence(logits, seqLen, vocab, charset),
      edited: false,
    })
  }
  return { lines }
}
