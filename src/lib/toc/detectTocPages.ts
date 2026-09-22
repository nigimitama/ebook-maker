import type { OcrResult } from '../ocr/types'
import { parseTocEntries } from './parseToc'

/** 目次は前付けにある想定なので、検出は先頭の一部のページだけを見る。 */
export const TOC_SCAN_MAX_PAGES = 40
const TOC_SCAN_RATIO = 0.3

const MIN_ENTRIES = 5
const HIT_SCORE = 0.5
const CONTINUATION_MIN_ENTRIES = 2

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
}

function scorePage(result: OcrResult): PageScore {
  const lines = result.lines
    .map((line) => line.text.normalize('NFKC').trim())
    .filter((text) => text !== '')
  if (lines.length === 0) return { entries: 0, ratio: 0, score: 0 }
  const entries = parseTocEntries(lines).length
  const ratio = Math.min(1, entries / lines.length)
  const hasKeyword = lines.some((text) => KEYWORD.test(text.replace(/\s+/g, '')))
  const leaderLines = lines.filter((text) => LEADER_LINE.test(text)).length
  return {
    entries,
    ratio,
    score: ratio + (hasKeyword ? 0.3 : 0) + (leaderLines >= 3 ? 0.2 : 0),
  }
}

function isTocPage(s: PageScore): boolean {
  return s.entries >= MIN_ENTRIES && s.score >= HIT_SCORE
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
