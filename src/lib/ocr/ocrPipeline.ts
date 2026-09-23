import type { RawImage } from '../../types'
import { letterboxToTensor } from './layoutPre'
import { decodeDetections, nms } from './layoutPost'
import { OCR_CONFIG, type RecognizerKey } from './ocrConfig'
import { sortReadingOrder } from './readingOrder'
import { cropLine, lineToTensor } from './recognizePre'
import { decodeSequence, pickRecognizer } from './recognizePost'
import { trailingNumberText, trailingSplitCandidates } from './trailingNumber'
import type { Box, OcrLine, OcrResult } from './types'

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

// 縦書きの行の末尾にページ番号がまとまって検出されていれば、番号の部分を別に認識する。
// 候補の末尾部分が数字だけに読めたときに限って切り分ける(それ以外は行をそのまま扱う)。
async function splitTrailingNumber(
  img: RawImage,
  det: Box,
  recognize: (key: RecognizerKey, box: Box) => Promise<string>,
): Promise<{ head: Box; tail: Box; tailText: string } | null> {
  for (const { head, tail } of trailingSplitCandidates(img, det)) {
    const tailText = trailingNumberText(await recognize(30, tail))
    if (tailText !== null) return { head, tail, tailText }
  }
  return null
}

// 1ページ分のOCR。レイアウト検出 -> 行の抽出・ブロック割当て -> 読み順 -> 行ごとの文字認識。
// 行ごとに逐次実行する(同時実行するとメモリを食うため。バッチ化はしない)。
export async function runOcr(
  img: RawImage,
  sessions: OcrSessions,
  charset: string[],
): Promise<Omit<OcrResult, 'pageId' | 'modelVersion' | 'updatedAt'>> {
  const size = OCR_CONFIG.layout.inputSize
  const { data, scale } = letterboxToTensor(img, size)
  const raw = await sessions.detect(data, size)
  const { lines: dets, blocks } = decodeDetections(raw, scale, img.width, img.height)
  const ordered = sortReadingOrder(nms(dets, OCR_CONFIG.layout.nmsIou), blocks)

  const recognize = async (key: RecognizerKey, box: Box): Promise<string> => {
    const spec = OCR_CONFIG.recognizers[key]
    const tensor = lineToTensor(cropLine(img, box), spec.height, spec.width)
    const { logits, seqLen, vocab } = await sessions.recognize(key, tensor)
    return decodeSequence(logits, seqLen, vocab, charset)
  }
  const toLine = (box: Box, text: string, blockId: string | null | undefined): OcrLine => ({
    id: newLineId(),
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    text,
    edited: false,
    ...(blockId ? { blockId } : {}),
  })

  const lines: OcrLine[] = []
  for (const { detection: det, blockId } of ordered) {
    const split = await splitTrailingNumber(img, det, recognize)
    if (split) {
      const headText = await recognize(pickRecognizer(det.charCount, split.head), split.head)
      lines.push(toLine(split.head, headText, blockId), toLine(split.tail, split.tailText, blockId))
      continue
    }
    lines.push(toLine(det, await recognize(pickRecognizer(det.charCount, det), det), blockId))
  }
  return { lines }
}
