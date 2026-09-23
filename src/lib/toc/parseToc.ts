import type { Chapter } from '../../types'
import type { OcrResult } from '../ocr/types'
import { newChapterId } from './chapters'

export interface TocEntry {
  title: string
  printedPage: number
  level: 1 | 2
}

// 点線リーダー・空白・ハイフン類。NFKC正規化後の文字を対象にする(… は ... になる)。
const LEADER_CLASS = String.raw`\s.·・…‥⋯_\-–—―`
const TAIL_NUMBER = new RegExp(String.raw`^(.*?)[${LEADER_CLASS}]*?(?<!\d)(\d{1,4})\s*$`, 'u')
const TRAILING_LEADER = new RegExp(`[${LEADER_CLASS}]+$`, 'u')

// 節(level 2)と判別する接頭辞。それ以外はすべて章(level 1)。
const LEVEL2_PATTERNS = [
  /^\d+[.-]\d+/, // 1.1 / 1-2
  /^第\s*[0-9一二三四五六七八九十百]+\s*節/,
  /^\(\s*\d+\s*\)/, // (1)
  /^\d+\)/, // 1)
  /^section\s*\d/i,
  /^§/,
]

// 「第」「Chapter」だけのような見出しの断片は、番号を続けてもタイトルとして採らない。
const HEADING_FRAGMENT = /^(chapter|part|section|page|no|p|第)\.?$/i

// 縦書きの本では、ページ番号が「二一」(=21)のように漢数字1文字ずつの並びで
// 組まれることがある(位取りの「十」「百」は使わない、桁ごとの置き換え式)。
// 「一」「二」等は通常の単語にもよく出るため、章名の末尾に付いた形での抽出は誤検出の
// リスクが高い。番号だけが単独の行になっているときに限って解釈する
// (単独の算用数字の行のみをページ番号として扱う既存の扱いと同じ考え方)。
const KANJI_DIGITS: Record<string, number> = {
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}
const BARE_KANJI_NUMBER = /^[〇一二三四五六七八九]{1,4}$/

function kanjiDigitsToNumber(text: string): number | null {
  let value = 0
  for (const ch of text) value = value * 10 + KANJI_DIGITS[ch]
  return value
}

/** 独立した1行が算用数字・漢数字いずれかのページ番号として読めれば、その値を返す。 */
function parseBareNumber(text: string): number | null {
  if (/^\d{1,4}$/.test(text)) return Number(text)
  if (BARE_KANJI_NUMBER.test(text)) return kanjiDigitsToNumber(text)
  return null
}

function cleanTitle(value: string): string {
  return value.replace(TRAILING_LEADER, '').trim()
}

function isValidTitle(title: string): boolean {
  return /\p{L}/u.test(title) && !HEADING_FRAGMENT.test(title)
}

function levelOf(title: string): 1 | 2 {
  return LEVEL2_PATTERNS.some((pattern) => pattern.test(title)) ? 2 : 1
}

export interface SourcedTocEntry extends TocEntry {
  /** 章名を取り出した行の、入力配列でのindex。 */
  titleLineIndex: number
  /** ページ番号を取り出した行のindex(章名と同じ行ならtitleLineIndexと同じ)。 */
  pageLineIndex: number
}

/**
 * 目次ページのOCR行(読み順)から、章名と印刷ページ番号の組を取り出す。
 * 「章名 ……… 12」形式と、章名の行と番号だけの行が分かれた形式に対応する。
 */
export function parseTocEntries(lines: string[]): TocEntry[] {
  return parseTocEntriesWithSource(lines).map(({ title, printedPage, level }) => ({ title, printedPage, level }))
}

/** parseTocEntries と同じ解析で、各項目の章名・ページ番号がどの行から来たかも返す(目次判定用)。 */
export function parseTocEntriesWithSource(lines: string[]): SourcedTocEntry[] {
  const entries: SourcedTocEntry[] = []
  let pending: { title: string; index: number } | null = null
  const push = (title: string, page: number, titleLineIndex: number, pageLineIndex: number) => {
    if (page >= 1) entries.push({ title, printedPage: page, level: levelOf(title), titleLineIndex, pageLineIndex })
  }
  lines.forEach((raw, index) => {
    const text = raw.normalize('NFKC').trim()
    if (text === '') return
    // 章名とページ番号の間の罫線(縦書きの「|」等)や単独の点線リーダーは、
    // 文字も数字も含まない。読み飛ばして、保留中の章名を番号と結び付けられるようにする。
    if (!/[\p{L}\p{N}]/u.test(text)) return
    const bareNumber = parseBareNumber(text)
    if (bareNumber !== null) {
      if (pending !== null && isValidTitle(pending.title)) push(pending.title, bareNumber, pending.index, index)
      pending = null
      return
    }
    const match = TAIL_NUMBER.exec(text)
    if (match) {
      const title = cleanTitle(match[1])
      if (isValidTitle(title)) {
        push(title, Number(match[2]), index, index)
        pending = null
        return
      }
    }
    pending = { title: cleanTitle(text), index }
  })
  return entries
}

/**
 * 印刷ページ番号を画像ページへ換算して章にする。
 * bodyStartIndex は「印刷ページ1ページ目」に当たる画像の0始まりindex。範囲外は先頭/末尾へ丸める。
 */
export function entriesToChapters(
  entries: TocEntry[],
  pageIds: string[],
  bodyStartIndex: number,
): Chapter[] {
  if (pageIds.length === 0) return []
  return entries.map((entry) => {
    const index = Math.min(Math.max(bodyStartIndex + entry.printedPage - 1, 0), pageIds.length - 1)
    return { id: newChapterId(), title: entry.title, pageId: pageIds[index], level: entry.level }
  })
}

/** 本文1ページ目の既定位置: 目次ページの最後の次のページ。 */
export function defaultBodyStartIndex(pageIds: string[], tocPageIds: string[]): number {
  const indexes = tocPageIds.map((id) => pageIds.indexOf(id)).filter((i) => i >= 0)
  if (indexes.length === 0) return 0
  return Math.min(Math.max(...indexes) + 1, pageIds.length - 1)
}

/** 指定した目次ページのOCR結果を書籍順に読み、章の候補を返す(保存はしない)。 */
export function parseToc(
  tocPageIds: string[],
  results: Record<string, OcrResult>,
  pageIds: string[],
  bodyStartIndex: number,
): Chapter[] {
  const wanted = new Set(tocPageIds)
  const lines = pageIds
    .filter((id) => wanted.has(id))
    .flatMap((id) => results[id]?.lines.map((line) => line.text) ?? [])
  return entriesToChapters(parseTocEntries(lines), pageIds, bodyStartIndex)
}
