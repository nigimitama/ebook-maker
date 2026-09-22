import type { Chapter, ExportChapter } from '../../types'

let chapterCounter = 0
export function newChapterId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  chapterCounter += 1
  return `ch-${Date.now()}-${chapterCounter}-${Math.random().toString(36).slice(2, 8)}`
}

/** 開始ページ順に並べる。同一ページ内は元の配列順を保つ(安定ソート)。未知のpageIdは末尾。 */
export function sortChapters(chapters: Chapter[], pageIds: string[]): Chapter[] {
  const index = new Map(pageIds.map((id, i) => [id, i]))
  const key = (c: Chapter) => index.get(c.pageId) ?? Number.POSITIVE_INFINITY
  return chapters.slice().sort((a, b) => key(a) - key(b))
}

/**
 * ページの削除・結合で開始ページが消えた章を、残ったページへ寄せる。
 * 消えたページの元の位置から「それより前で消えたページ数」を引いた位置のページに移す。
 * 削除なら次の残存ページ(末尾なら直前のページ)、結合なら結合後のページになる。
 * 残るページがなければ章を捨てる。
 */
export function remapChapters(
  chapters: Chapter[],
  prevIds: string[],
  nextIds: string[],
): Chapter[] {
  if (nextIds.length === 0) return []
  const alive = new Set(nextIds)
  const result: Chapter[] = []
  for (const chapter of chapters) {
    if (alive.has(chapter.pageId)) {
      result.push(chapter)
      continue
    }
    const oldIndex = prevIds.indexOf(chapter.pageId)
    if (oldIndex === -1) continue
    const removedBefore = prevIds.slice(0, oldIndex).filter((id) => !alive.has(id)).length
    const newIndex = Math.min(oldIndex - removedBefore, nextIds.length - 1)
    result.push({ ...chapter, pageId: nextIds[newIndex] })
  }
  return result
}

/** 書き出し順のページindexへ変換する。未知のpageIdと空タイトルは除き、開始ページ順に並べる。 */
export function toExportChapters(chapters: Chapter[], pageIds: string[]): ExportChapter[] {
  const index = new Map(pageIds.map((id, i) => [id, i]))
  const result: ExportChapter[] = []
  for (const chapter of chapters) {
    const pageIndex = index.get(chapter.pageId)
    const title = chapter.title.trim()
    if (pageIndex === undefined || title === '') continue
    result.push({ title, pageIndex, level: chapter.level })
  }
  return result.sort((a, b) => a.pageIndex - b.pageIndex)
}

export interface OutlineNode {
  chapter: ExportChapter
  children: OutlineNode[]
}

/** level>=2 は直前のlevel1の子にする。直前にlevel1がなければ根として扱う。 */
export function buildOutlineTree(chapters: ExportChapter[]): OutlineNode[] {
  const roots: OutlineNode[] = []
  for (const chapter of chapters) {
    const node: OutlineNode = { chapter, children: [] }
    const parent = roots[roots.length - 1]
    if (chapter.level >= 2 && parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}
