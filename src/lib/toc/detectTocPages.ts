import type { OcrLine, OcrResult } from '../ocr/types'
import { lineFontSize } from '../titleGuess'
import { parseTocEntriesWithSource } from './parseToc'

/** 目次は前付けにある想定なので、検出は先頭の一部のページだけを見る。 */
export const TOC_SCAN_MAX_PAGES = 40
const TOC_SCAN_RATIO = 0.3

const MIN_ENTRIES = 5
const HIT_SCORE = 0.5
const CONTINUATION_MIN_ENTRIES = 2

// 章ごとに要約文が付く目次(1ページに数章だけ)は、項目数も行に占める割合も少ない。
// 章名が本文より明らかに大きい文字で組まれていれば、少ない項目数でも目次とみなす。
const HEADLINE_MIN_ENTRIES = 2
/**
 * 章名の推定文字サイズが、ページの行の文字サイズの中央値の何倍以上なら見出しとみなすか。
 * 09_fontsize_contrast_chapter_preview.png の実OCRでは、中央値(要約文)に対して章名が約2.5倍、
 * 副題が約1.4倍だった。副題程度の大きさの行を見出しと取り違えないよう、その間に置く。
 */
const HEADLINE_SIZE_RATIO = 1.8

const KEYWORD = /^(目次|もくじ|contents|tableofcontents)$/i
const LEADER_LINE = /[.·・…‥⋯]{2,}\s*\d{1,4}\s*$/u

export function tocScanWindow(pageCount: number): number {
  return Math.min(Math.ceil(pageCount * TOC_SCAN_RATIO), TOC_SCAN_MAX_PAGES)
}

export interface TocDetection {
  /** 目次ページと判定したページ(書籍順)。見つからなければ空。 */
  pageIds: string[]
  /** 検出範囲内でOCR未実施のページ。OCRすれば検出できる可能性がある。 */
  unscannedPageIds: string[]
}

interface PageScore {
  entries: number
  ratio: number
  score: number
  /** 全項目の章名が大きい文字で、ページ番号が昇順に並んでいるか。 */
  headlineToc: boolean
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function scorePage(result: OcrResult): PageScore {
  const lines: { line: OcrLine; text: string }[] = result.lines
    .map((line) => ({ line, text: line.text.normalize('NFKC').trim() }))
    .filter(({ text }) => text !== '')
  if (lines.length === 0) return { entries: 0, ratio: 0, score: 0, headlineToc: false }
  const texts = lines.map(({ text }) => text)
  const parsed = parseTocEntriesWithSource(texts)
  const entries = parsed.length
  // 項目に使われた行(章名の行とページ番号の行)の割合。章名と番号が別の行に分かれた目次でも、
  // 1行に収まった目次と同じ尺度になる。
  const entryLines = new Set(parsed.flatMap((entry) => [entry.titleLineIndex, entry.pageLineIndex]))
  const ratio = entryLines.size / lines.length
  const hasKeyword = texts.some((text) => KEYWORD.test(text.replace(/\s+/g, '')))
  const leaderLines = texts.filter((text) => LEADER_LINE.test(text)).length

  const threshold = median(lines.map(({ line }) => lineFontSize(line))) * HEADLINE_SIZE_RATIO
  const headlineToc =
    entries >= HEADLINE_MIN_ENTRIES &&
    parsed.every((entry) => lineFontSize(lines[entry.titleLineIndex].line) >= threshold) &&
    parsed.every((entry, i) => i === 0 || entry.printedPage > parsed[i - 1].printedPage)

  return {
    entries,
    ratio,
    score: ratio + (hasKeyword ? 0.3 : 0) + (leaderLines >= 3 ? 0.2 : 0),
    headlineToc,
  }
}

function isTocPage(s: PageScore): boolean {
  return (s.entries >= MIN_ENTRIES && s.score >= HIT_SCORE) || s.headlineToc
}

// 目次の最終ページは項目が少ないので、続きのページには緩い基準を使う。
function isContinuation(s: PageScore): boolean {
  return s.entries >= CONTINUATION_MIN_ENTRIES && s.ratio >= HIT_SCORE
}

export function detectTocPages(
  pageIds: string[],
  results: Record<string, OcrResult>,
): TocDetection {
  const windowIds = pageIds.slice(0, tocScanWindow(pageIds.length))
  const unscannedPageIds = windowIds.filter((id) => !results[id])
  const scores = windowIds.map((id) => (results[id] ? scorePage(results[id]) : null))

  const start = scores.findIndex((s) => s !== null && isTocPage(s))
  if (start === -1) return { pageIds: [], unscannedPageIds }

  const found = [windowIds[start]]
  for (let i = start + 1; i < windowIds.length; i += 1) {
    const s = scores[i]
    if (s === null || !(isTocPage(s) || isContinuation(s))) break
    found.push(windowIds[i])
  }
  return { pageIds: found, unscannedPageIds }
}
