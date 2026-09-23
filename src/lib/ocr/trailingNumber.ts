import type { RawImage } from '../../types'
import type { Box } from './types'

// 縦書きの目次などでは、章名の行の下端にページ番号(横組みの「62」や漢数字の「二一」)が
// 置かれ、レイアウト検出がそれを章名と同じ1行として返すことがある。そのまま認識すると
// 番号が「a」「---」のように崩れるので、行の末尾の短い部分を切り離して別に認識できるよう、
// 画像のインクの並びから「末尾の番号らしい部分」の候補を探す。
// 候補を実際に番号として採るかどうかは、認識結果が数字だけかで決める(isTrailingNumberText)。

/** 縦長とみなす縦横比(高さ/幅)。 */
const VERTICAL_ASPECT = 1.5
/** 番号の手前の空きは、その行の字間(中央値)の何倍以上必要か。本文の均等な字間では切らない。 */
const GAP_TO_MEDIAN = 1.5
/** 番号の手前の空きの下限(行の幅=文字サイズに対する比)。 */
const MIN_GAP_RATIO = 0.3
/** 末尾部分の長さの上限(行の幅に対する比)。漢数字3桁程度まで。 */
const MAX_TAIL_RATIO = 3.5
/** インクとみなす明るさのしきい値に必要な、行内の明暗差。これ未満の行は解析しない。 */
const MIN_CONTRAST = 40
/** 罫線(「|」のような細い縦線)とみなす、長さの下限(行の幅比)と太さの上限(行の幅比)。 */
const RULE_MIN_LENGTH_RATIO = 0.25
const RULE_MAX_WIDTH_RATIO = 0.12

interface InkRun {
  start: number
  end: number
  minX: number
  maxX: number
}

export interface TrailingSplit {
  /** 番号を除いた行の本体。 */
  head: Box
  /** 末尾の番号の部分(インクに合わせた箱)。 */
  tail: Box
}

function luminance(img: RawImage, x: number, y: number): number {
  const i = (y * img.width + x) * 4
  return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3
}

// 行の箱の中を上から1画素行ずつ見て、インクのある画素行の連続(run)を求める。
function inkRuns(img: RawImage, box: Box): InkRun[] {
  const x0 = Math.max(0, Math.floor(box.x))
  const x1 = Math.min(img.width, Math.ceil(box.x + box.w))
  const y0 = Math.max(0, Math.floor(box.y))
  const y1 = Math.min(img.height, Math.ceil(box.y + box.h))
  let min = 255
  let max = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const v = luminance(img, x, y)
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (max - min < MIN_CONTRAST) return []
  const threshold = (min + max) / 2

  const runs: InkRun[] = []
  for (let y = y0; y < y1; y += 1) {
    let minX = Infinity
    let maxX = -Infinity
    for (let x = x0; x < x1; x += 1) {
      if (luminance(img, x, y) < threshold) {
        if (x < minX) minX = x
        maxX = x
      }
    }
    if (maxX < minX) continue
    const last = runs[runs.length - 1]
    if (last && last.end === y - 1) {
      last.end = y
      last.minX = Math.min(last.minX, minX)
      last.maxX = Math.max(last.maxX, maxX)
    } else {
      runs.push({ start: y, end: y, minX, maxX })
    }
  }
  return runs
}

function isRule(run: InkRun, lineWidth: number): boolean {
  const length = run.end - run.start + 1
  const width = run.maxX - run.minX + 1
  return length >= lineWidth * RULE_MIN_LENGTH_RATIO && width <= Math.max(2, lineWidth * RULE_MAX_WIDTH_RATIO)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * 縦長の行の末尾にある、番号らしい部分の切り分け候補を返す(末尾部分が長いものから順)。
 * 横長の行や、末尾に目立つ空きがない行では空配列。
 */
export function trailingSplitCandidates(img: RawImage, box: Box): TrailingSplit[] {
  if (box.h < box.w * VERTICAL_ASPECT) return []
  const lineWidth = box.w
  // 章名とページ番号の間の罫線は空きとして扱う(番号の一部として認識させない)。
  const runs = inkRuns(img, box).filter((run) => !isRule(run, lineWidth))
  if (runs.length < 2) return []

  const gaps = runs.slice(1).map((run, i) => run.start - runs[i].end - 1)
  const minGap = Math.max(lineWidth * MIN_GAP_RATIO, median(gaps) * GAP_TO_MEDIAN)
  const end = runs[runs.length - 1].end

  const candidates: TrailingSplit[] = []
  for (let i = runs.length - 1; i >= 1; i -= 1) {
    if (end - runs[i].start + 1 > lineWidth * MAX_TAIL_RATIO) break
    if (gaps[i - 1] < minGap) continue
    const tailRuns = runs.slice(i)
    const minX = Math.min(...tailRuns.map((run) => run.minX))
    const maxX = Math.max(...tailRuns.map((run) => run.maxX))
    const pad = 2
    const tailX = Math.max(box.x, minX - pad)
    const tailY = runs[i].start - pad
    candidates.push({
      head: { x: box.x, y: box.y, w: box.w, h: runs[i - 1].end + pad + 1 - box.y },
      tail: {
        x: tailX,
        y: tailY,
        w: Math.min(box.x + box.w, maxX + pad + 1) - tailX,
        h: end + pad + 1 - tailY,
      },
    })
  }
  // 末尾部分が長い候補を先に試す(「二一」を「一」だけで切らないため)。
  return candidates.reverse()
}

const ARABIC_NUMBER = /^\d{1,4}$/
const KANJI_NUMBER = /^[〇一二三四五六七八九]{1,4}$/

/** 末尾部分の認識結果がページ番号として採れる文字列なら、整えた文字列を返す。 */
export function trailingNumberText(text: string): string | null {
  const normalized = text.normalize('NFKC').replace(/\s+/g, '')
  if (ARABIC_NUMBER.test(normalized) || KANJI_NUMBER.test(normalized)) return normalized
  return null
}
