# 章立て(目次)ステップ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OCR確認・修正の後にスキップ可能な「章立て」ステップを追加し、目次ページのOCR結果から章名と開始ページを構造化して、PDFのしおり・EPUBの目次に埋め込めるようにする。

**Architecture:** 章立ては `Chapter { id, title, pageId, level }` の配列としてIndexedDBの新ストア `chapters`(単一レコード、配列順が同一ページ内の順序)に保存する。目次ページの自動検出(`detectTocPages`)と目次の解析(`parseToc`)は `RawImage` 不要の純関数として `src/lib/toc/` に置き、Vitestで先にテストを書く。書き出しでは `useBook.exportBook` が章を書き出し順のページindexへ変換し(`toExportChapters`)、Workerへ `ExportChapter[]` として渡す。`buildPdf`/`buildEpub` はindexだけを扱い、入れ子の木は共通の `buildOutlineTree` で組む。

**Tech Stack:** React 19, TypeScript, Vite, pdf-lib(低レベルAPIでアウトライン), JSZip, Vitest(jsdom, fake-indexeddb), Playwright

**Spec:** `docs/superpowers/specs/2026-09-21-chapter-toc-design.md`

## Global Constraints

- 画像・OCR結果・章立てを一切サーバーへ送信しない。LLM/外部APIは使わない(ルールベース＋手動修正)。
- 章の階層は最大2階層(level 1=章, 2=節)。3階層以上は対象外。
- スキップした場合、または章が0件の場合、出力は従来と同一。スキップは既存の章を消さない。
- 同一開始ページに複数の章を許可する。同一ページ内の順序は保存された配列順。
- 章は `pageId`(ページID)で持つ。ページの削除・結合に追従して寄せる。
- UI文言・コードコメントは日本語(既存に合わせる)。lint は `npm run lint`(oxlint)、型検査は `npm run typecheck`。`npm test` は型検査しないので、変更のたびに `npm run typecheck` も実行する。
- `window.EbookMaker`(`src/lib/automationApi.ts`)と `public/llms.txt` を `useBook` 相当の操作追加と同期させる。
- 工程番号は 0:読み込み / 1:並べ替え・調整 / 2:OCR確認・修正 / 3:章立て / 4:詳細＆書き出し。

## File Structure

| ファイル | 責務 |
|---|---|
| `src/types.ts` (修正) | `Chapter`, `ExportChapter` 型 |
| `src/lib/toc/chapters.ts` (新規) | 章の純関数: `newChapterId`, `sortChapters`, `remapChapters`, `toExportChapters`, `buildOutlineTree` |
| `src/lib/toc/parseToc.ts` (新規) | 目次のOCR行 → 章候補: `parseTocEntries`, `entriesToChapters`, `defaultBodyStartIndex`, `parseToc` |
| `src/lib/toc/detectTocPages.ts` (新規) | 目次ページの自動検出: `tocScanWindow`, `detectTocPages` |
| `src/lib/imageStore.ts` (修正) | DB v3、`chapters` ストア、`listChapters`/`putChapters`、clearAll/restorePages対応 |
| `src/hooks/useChapters.ts` (新規) | 章の状態・保存・ページ変更への追従 |
| `src/hooks/useBook.ts` (修正) | clearAll取り消しで章を復元、`exportBook` が章をWorkerへ渡す |
| `src/lib/pdfExport.ts` / `src/lib/epubExport.ts` (修正) | しおり/nav生成 |
| `src/workers/exportCore.ts` (修正) | `ExportRequest.chapters` |
| `src/components/ChaptersStep.tsx` (新規) | 章立てステップのUI |
| `src/components/ExportPanel.tsx` (修正) | 「しおり・目次を埋め込む」チェック |
| `src/App.tsx` (修正) | 5工程化、`useChapters` の配線 |
| `src/lib/automationApi.ts`, `public/llms.txt`, `README.md`, `CLAUDE.md` (修正) | API・ドキュメント同期 |

---

## Task 1: 章の型と純関数(chapters.ts)

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/toc/chapters.ts`
- Test: `src/lib/toc/chapters.test.ts`

**Interfaces:**
- Produces:
  - `interface Chapter { id: string; title: string; pageId: string; level: number }`
  - `interface ExportChapter { title: string; pageIndex: number; level: number }`
  - `newChapterId(): string`
  - `sortChapters(chapters: Chapter[], pageIds: string[]): Chapter[]` — 開始ページ順(安定ソート。未知のpageIdは末尾)
  - `remapChapters(chapters: Chapter[], prevIds: string[], nextIds: string[]): Chapter[]`
  - `toExportChapters(chapters: Chapter[], pageIds: string[]): ExportChapter[]` — 開始ページ順、未知のpageIdと空タイトルは除く
  - `interface OutlineNode { chapter: ExportChapter; children: OutlineNode[] }`
  - `buildOutlineTree(chapters: ExportChapter[]): OutlineNode[]` — level>=2 は直前のlevel1の子。直前がなければ根

- [ ] **Step 1: 型を追加する**

`src/types.ts` の `BookMetadata` の直後に追加:

```ts
// 章立て(目次)の1項目。開始ページは、並べ替え・削除に追従できるよう番号ではなくIDで持つ。
// level は 1=章, 2=節(2階層まで)。同一ページに複数の章があってよく、その順序は配列順。
export interface Chapter {
  id: string
  title: string
  pageId: string
  level: number
}

// 書き出し用に、章を書き出し順のページindex(0始まり)へ変換したもの。
export interface ExportChapter {
  title: string
  pageIndex: number
  level: number
}
```

- [ ] **Step 2: 失敗するテストを書く**

`src/lib/toc/chapters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Chapter } from '../../types'
import {
  buildOutlineTree,
  newChapterId,
  remapChapters,
  sortChapters,
  toExportChapters,
} from './chapters'

function ch(id: string, pageId: string, level = 1, title = id): Chapter {
  return { id, title, pageId, level }
}

describe('newChapterId', () => {
  it('returns distinct ids', () => {
    expect(newChapterId()).not.toBe(newChapterId())
  })
})

describe('sortChapters', () => {
  it('sorts by page order and keeps array order for the same page', () => {
    const sorted = sortChapters(
      [ch('c2', 'b'), ch('c1', 'a'), ch('c3', 'b', 2)],
      ['a', 'b', 'c'],
    )
    expect(sorted.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('puts chapters with an unknown page last', () => {
    const sorted = sortChapters([ch('x', 'zzz'), ch('c1', 'a')], ['a'])
    expect(sorted.map((c) => c.id)).toEqual(['c1', 'x'])
  })
})

describe('toExportChapters', () => {
  it('maps to page indexes in book order, skipping unknown pages and empty titles', () => {
    const result = toExportChapters(
      [ch('c2', 'b', 2, '節'), ch('c1', 'a', 1, '章'), ch('x', 'zzz'), ch('e', 'a', 1, '  ')],
      ['a', 'b'],
    )
    expect(result).toEqual([
      { title: '章', pageIndex: 0, level: 1 },
      { title: '節', pageIndex: 1, level: 2 },
    ])
  })
})

describe('remapChapters', () => {
  it('moves a chapter on a deleted page to the next surviving page', () => {
    const result = remapChapters([ch('c', 'b')], ['a', 'b', 'c'], ['a', 'c'])
    expect(result[0].pageId).toBe('c')
  })

  it('moves a chapter on a deleted last page to the previous page', () => {
    const result = remapChapters([ch('c', 'c')], ['a', 'b', 'c'], ['a', 'b'])
    expect(result[0].pageId).toBe('b')
  })

  it('moves chapters on both pages of a merged spread to the merged page', () => {
    const result = remapChapters(
      [ch('c1', 'a'), ch('c2', 'b')],
      ['x', 'a', 'b', 'c'],
      ['x', 'm', 'c'],
    )
    expect(result.map((c) => c.pageId)).toEqual(['m', 'm'])
  })

  it('drops all chapters when no page remains', () => {
    expect(remapChapters([ch('c', 'a')], ['a'], [])).toEqual([])
  })

  it('leaves chapters on surviving pages untouched', () => {
    const chapters = [ch('c', 'a')]
    expect(remapChapters(chapters, ['a', 'b'], ['a'])).toEqual(chapters)
  })
})

describe('buildOutlineTree', () => {
  const e = (title: string, level: number) => ({ title, pageIndex: 0, level })

  it('nests level 2 under the preceding level 1', () => {
    const tree = buildOutlineTree([e('A', 1), e('A1', 2), e('A2', 2), e('B', 1), e('B1', 2)])
    expect(tree.map((n) => n.chapter.title)).toEqual(['A', 'B'])
    expect(tree[0].children.map((n) => n.chapter.title)).toEqual(['A1', 'A2'])
    expect(tree[1].children.map((n) => n.chapter.title)).toEqual(['B1'])
  })

  it('treats a leading level 2 as a root', () => {
    const tree = buildOutlineTree([e('orphan', 2), e('A', 1)])
    expect(tree.map((n) => n.chapter.title)).toEqual(['orphan', 'A'])
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run src/lib/toc/chapters.test.ts`
Expected: FAIL(`./chapters` が存在しない)

- [ ] **Step 4: 実装する**

`src/lib/toc/chapters.ts`:

```ts
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
```

- [ ] **Step 5: 通過を確認する**

Run: `npx vitest run src/lib/toc/chapters.test.ts && npm run typecheck`
Expected: PASS、型エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/types.ts src/lib/toc/chapters.ts src/lib/toc/chapters.test.ts
git commit -m "feat: 章立ての型と純関数(並べ替え・ページ追従・アウトライン木)を追加する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: 目次の解析(parseToc.ts)

**Files:**
- Create: `src/lib/toc/parseToc.ts`
- Test: `src/lib/toc/parseToc.test.ts`

**Interfaces:**
- Consumes: `newChapterId` (Task 1), `Chapter` (Task 1), `OcrResult` from `src/lib/ocr/types.ts`
- Produces:
  - `interface TocEntry { title: string; printedPage: number; level: 1 | 2 }`
  - `parseTocEntries(lines: string[]): TocEntry[]`
  - `entriesToChapters(entries: TocEntry[], pageIds: string[], bodyStartIndex: number): Chapter[]` — `bodyStartIndex` は「印刷ページ1ページ目」に当たる画像の0始まりindex
  - `defaultBodyStartIndex(pageIds: string[], tocPageIds: string[]): number` — 目次ページの最後の次(範囲内に丸める。目次が空なら0)
  - `parseToc(tocPageIds: string[], results: Record<string, OcrResult>, pageIds: string[], bodyStartIndex: number): Chapter[]`

仕様の補足: ローマ数字は**章番号の接頭辞**(`Ⅰ 総論` など)としてのみ扱い、末尾がローマ数字の行はページ番号とみなさない(前付けのページ番号は本文への換算ができないため)。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/toc/parseToc.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { OcrResult } from '../ocr/types'
import { defaultBodyStartIndex, entriesToChapters, parseToc, parseTocEntries } from './parseToc'

function result(pageId: string, texts: string[]): OcrResult {
  return {
    pageId,
    modelVersion: 't',
    updatedAt: 1,
    lines: texts.map((text, i) => ({ id: `${pageId}-${i}`, x: 0, y: i * 10, w: 10, h: 10, text, edited: false })),
  }
}

describe('parseTocEntries', () => {
  it('reads dotted-leader lines', () => {
    expect(parseTocEntries(['第1章 はじめに ........ 3', '第2章 手法 ........ 25'])).toEqual([
      { title: '第1章 はじめに', printedPage: 3, level: 1 },
      { title: '第2章 手法', printedPage: 25, level: 1 },
    ])
  })

  it('normalizes full-width digits and ellipsis leaders', () => {
    expect(parseTocEntries(['第１章　はじめに………１２'])).toEqual([
      { title: '第1章 はじめに', printedPage: 12, level: 1 },
    ])
  })

  it('reads lines without leaders', () => {
    expect(parseTocEntries(['序章 出発 7'])).toEqual([
      { title: '序章 出発', printedPage: 7, level: 1 },
    ])
  })

  it('joins a title line with the following number-only line', () => {
    expect(parseTocEntries(['第3章 結果と考察', '48'])).toEqual([
      { title: '第3章 結果と考察', printedPage: 48, level: 1 },
    ])
  })

  it('detects level 2 for numbered sections', () => {
    const entries = parseTocEntries(['第1章 概要 ..... 3', '1.1 背景 ..... 4', '1-2 目的 ..... 6', '(1) 補足 ..... 7'])
    expect(entries.map((e) => e.level)).toEqual([1, 2, 2, 2])
  })

  it('treats "1. Title" as level 1 and unknown titles as level 1', () => {
    const entries = parseTocEntries(['1. Intro ..... 3', 'あとがき ..... 300'])
    expect(entries.map((e) => e.level)).toEqual([1, 1])
  })

  it('keeps roman numeral prefixes as level 1 titles', () => {
    expect(parseTocEntries(['Ⅰ 総論 ..... 9'])).toEqual([{ title: 'I 総論', printedPage: 9, level: 1 }])
  })

  it('ignores headers, bare headings and lines ending in a roman page number', () => {
    expect(parseTocEntries(['目次', 'Chapter 3', '序文 iv', '第1章 はじめに ..... 3'])).toEqual([
      { title: '第1章 はじめに', printedPage: 3, level: 1 },
    ])
  })

  it('ignores page number 0 and numbers of more than 4 digits', () => {
    expect(parseTocEntries(['付録 ..... 0', '年表 ..... 12345'])).toEqual([])
  })
})

describe('entriesToChapters', () => {
  const pageIds = ['p0', 'p1', 'p2', 'p3', 'p4']
  const entries = [
    { title: 'A', printedPage: 1, level: 1 as const },
    { title: 'B', printedPage: 3, level: 2 as const },
  ]

  it('converts printed pages using the body start index', () => {
    const chapters = entriesToChapters(entries, pageIds, 1)
    expect(chapters.map((c) => [c.title, c.pageId, c.level])).toEqual([
      ['A', 'p1', 1],
      ['B', 'p3', 2],
    ])
    expect(new Set(chapters.map((c) => c.id)).size).toBe(2)
  })

  it('clamps out-of-range pages to the first and last page', () => {
    const chapters = entriesToChapters([{ title: 'Z', printedPage: 99, level: 1 }], pageIds, 1)
    expect(chapters[0].pageId).toBe('p4')
    const early = entriesToChapters(entries, pageIds, -5)
    expect(early[0].pageId).toBe('p0')
  })

  it('returns nothing when there are no pages', () => {
    expect(entriesToChapters(entries, [], 0)).toEqual([])
  })
})

describe('defaultBodyStartIndex', () => {
  const pageIds = ['p0', 'p1', 'p2', 'p3']
  it('is the page after the last toc page', () => {
    expect(defaultBodyStartIndex(pageIds, ['p1', 'p0'])).toBe(2)
  })
  it('clamps to the last page and falls back to 0 without toc pages', () => {
    expect(defaultBodyStartIndex(pageIds, ['p3'])).toBe(3)
    expect(defaultBodyStartIndex(pageIds, [])).toBe(0)
  })
})

describe('parseToc', () => {
  it('reads the toc pages in book order and converts to chapters', () => {
    const pageIds = ['t1', 't2', 'b1', 'b2', 'b3']
    const results = {
      t2: result('t2', ['第2章 手法 ..... 2']),
      t1: result('t1', ['目次', '第1章 はじめに ..... 1']),
    }
    const chapters = parseToc(['t2', 't1'], results, pageIds, 2)
    expect(chapters.map((c) => [c.title, c.pageId])).toEqual([
      ['第1章 はじめに', 'b1'],
      ['第2章 手法', 'b2'],
    ])
  })

  it('skips toc pages that have no OCR result', () => {
    expect(parseToc(['t1'], {}, ['t1', 'b1'], 1)).toEqual([])
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/toc/parseToc.test.ts`
Expected: FAIL(`./parseToc` が存在しない)

- [ ] **Step 3: 実装する**

`src/lib/toc/parseToc.ts`:

```ts
import type { Chapter } from '../../types'
import type { OcrResult } from '../ocr/types'
import { newChapterId } from './chapters'

export interface TocEntry {
  title: string
  printedPage: number
  level: 1 | 2
}

// 点線リーダー・空白・ハイフン類。NFKC正規化後の文字を対象にする(… は ... になる)。
const LEADER_CLASS = '\\s.·・…‥⋯_\\-–—―'
const TAIL_NUMBER = new RegExp(`^(.*?)[${LEADER_CLASS}]*?(\\d{1,4})\\s*$`, 'u')
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

function cleanTitle(value: string): string {
  return value.replace(TRAILING_LEADER, '').trim()
}

function isValidTitle(title: string): boolean {
  return /\p{L}/u.test(title) && !HEADING_FRAGMENT.test(title)
}

function levelOf(title: string): 1 | 2 {
  return LEVEL2_PATTERNS.some((pattern) => pattern.test(title)) ? 2 : 1
}

/**
 * 目次ページのOCR行(読み順)から、章名と印刷ページ番号の組を取り出す。
 * 「章名 ……… 12」形式と、章名の行と番号だけの行が分かれた形式に対応する。
 */
export function parseTocEntries(lines: string[]): TocEntry[] {
  const entries: TocEntry[] = []
  let pending: string | null = null
  const push = (title: string, page: number) => {
    if (page >= 1) entries.push({ title, printedPage: page, level: levelOf(title) })
  }
  for (const raw of lines) {
    const text = raw.normalize('NFKC').trim()
    if (text === '') continue
    if (/^\d{1,4}$/.test(text)) {
      if (pending !== null && isValidTitle(pending)) push(pending, Number(text))
      pending = null
      continue
    }
    const match = TAIL_NUMBER.exec(text)
    if (match) {
      const title = cleanTitle(match[1])
      if (isValidTitle(title)) {
        push(title, Number(match[2]))
        pending = null
        continue
      }
    }
    pending = cleanTitle(text)
  }
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
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/lib/toc/parseToc.test.ts && npm run typecheck`
Expected: PASS。失敗するケースがあれば、テストではなく実装の正規表現を直す(テストの期待値は仕様どおり)。

- [ ] **Step 5: コミット**

```bash
git add src/lib/toc/parseToc.ts src/lib/toc/parseToc.test.ts
git commit -m "feat: 目次のOCR行から章候補を作るparseTocを追加する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: 目次ページの自動検出(detectTocPages.ts)

**Files:**
- Create: `src/lib/toc/detectTocPages.ts`
- Test: `src/lib/toc/detectTocPages.test.ts`

**Interfaces:**
- Consumes: `parseTocEntries` (Task 2), `OcrResult`
- Produces:
  - `tocScanWindow(pageCount: number): number` — `min(ceil(pageCount*0.3), 40)`
  - `interface TocDetection { pageIds: string[]; unscannedPageIds: string[] }`
  - `detectTocPages(pageIds: string[], results: Record<string, OcrResult>): TocDetection` — `pageIds` は書籍順。`unscannedPageIds` は検出範囲内でOCR未実施のページ

検出ルール(spec準拠): 検出範囲は先頭 `tocScanWindow` 枚のOCR済みページ。1ページのスコア = 「目次の項目として読めた数 / 空でない行数」+ 見出しキーワード(目次/もくじ/Contents)があれば0.3 + 点線リーダー付きの行が3行以上なら0.2。項目数5以上かつスコア0.5以上なら目次ページ。最初にヒットしたページから、連続する目次ページをまとめる。2ページ目以降は継続ページとして「項目数2以上かつ項目の割合0.5以上」でも採る(最終ページが短いため)。最初のブロックだけを返す。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/toc/detectTocPages.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { OcrResult } from '../ocr/types'
import { detectTocPages, tocScanWindow } from './detectTocPages'

function result(pageId: string, texts: string[]): OcrResult {
  return {
    pageId,
    modelVersion: 't',
    updatedAt: 1,
    lines: texts.map((text, i) => ({ id: `${pageId}-${i}`, x: 0, y: i, w: 1, h: 1, text, edited: false })),
  }
}

const tocLines = [
  '目次',
  '第1章 はじめに ........ 3',
  '第2章 背景 ........ 15',
  '第3章 手法 ........ 31',
  '第4章 結果 ........ 52',
  '第5章 議論 ........ 70',
]
const proseLines = [
  'これは本文の段落です。',
  '吾輩は猫である。名前はまだ無い。',
  'どこで生れたかとんと見当がつかぬ。',
  '何でも薄暗いじめじめした所で泣いていた。',
  '12',
]

describe('tocScanWindow', () => {
  it('is 30% of the pages, capped at 40', () => {
    expect(tocScanWindow(10)).toBe(3)
    expect(tocScanWindow(100)).toBe(30)
    expect(tocScanWindow(500)).toBe(40)
  })
})

describe('detectTocPages', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `p${i}`)

  it('finds a single toc page among prose pages', () => {
    const results = {
      p0: result('p0', proseLines),
      p1: result('p1', tocLines),
      p2: result('p2', proseLines),
    }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p1'])
  })

  it('groups a toc spanning several pages, including a short last page', () => {
    const results = {
      p0: result('p0', tocLines),
      p1: result('p1', tocLines.slice(1)),
      p2: result('p2', ['付録 ........ 90', '索引 ........ 95', '奥付 ........ 99']),
      p3: result('p3', proseLines),
    }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p0', 'p1', 'p2'])
  })

  it('detects a toc page without the heading keyword', () => {
    const results = { p1: result('p1', tocLines.slice(1)) }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p1'])
  })

  it('returns nothing for a book without a toc', () => {
    const results = { p0: result('p0', proseLines), p1: result('p1', proseLines) }
    expect(detectTocPages(ids, results).pageIds).toEqual([])
  })

  it('ignores toc-like pages beyond the scan window', () => {
    const results = { p5: result('p5', tocLines) }
    expect(detectTocPages(ids, results).pageIds).toEqual([])
  })

  it('reports pages inside the window that have no OCR result yet', () => {
    const results = { p0: result('p0', proseLines) }
    expect(detectTocPages(ids, results).unscannedPageIds).toEqual(['p1', 'p2'])
  })

  it('returns only the first block', () => {
    const results = {
      p0: result('p0', tocLines),
      p1: result('p1', proseLines),
      p2: result('p2', tocLines),
    }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p0'])
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/toc/detectTocPages.test.ts`
Expected: FAIL(`./detectTocPages` が存在しない)

- [ ] **Step 3: 実装する**

`src/lib/toc/detectTocPages.ts`:

```ts
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
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/lib/toc/detectTocPages.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: コミット**

```bash
git add src/lib/toc/detectTocPages.ts src/lib/toc/detectTocPages.test.ts
git commit -m "feat: 目次ページの自動検出を追加する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: IndexedDBに章を保存する(imageStore v3)

**Files:**
- Modify: `src/lib/imageStore.ts`
- Modify: `src/lib/imageStore.test.ts` (versionchangeテストが開く版を 3 → 4 に)
- Test: `src/lib/imageStore.test.ts`

**Interfaces:**
- Consumes: `Chapter` (Task 1)
- Produces:
  - `ImageStore.listChapters(): Promise<Chapter[]>` — 未保存なら `[]`
  - `ImageStore.putChapters(chapters: Chapter[]): Promise<void>` — 全置換
  - `ImageStore.clearAll()` が章も消す
  - `ImageStore.restorePages(pages, blobs, ocr = [], chapters = [])`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/imageStore.test.ts` の末尾の `describe` 内(既存の最後の `it` の後ろ)に追加。ファイル冒頭の import に `Chapter` を足す(`import type { Chapter } from '../types'`)。既存のstoreの作り方(`ImageStore.open(...)`)に合わせる:

```ts
  it('stores chapters as one ordered list and returns [] when none are saved', async () => {
    const store = await ImageStore.open(`ch-db-${Math.random()}`)
    expect(await store.listChapters()).toEqual([])
    const chapters: Chapter[] = [
      { id: 'c1', title: '第1章', pageId: 'p1', level: 1 },
      { id: 'c2', title: '1.1', pageId: 'p1', level: 2 },
    ]
    await store.putChapters(chapters)
    expect(await store.listChapters()).toEqual(chapters)
    await store.putChapters([chapters[1]])
    expect(await store.listChapters()).toEqual([chapters[1]])
    store.close()
  })

  it('clearAll removes chapters and restorePages brings them back', async () => {
    const store = await ImageStore.open(`ch-db-${Math.random()}`)
    const chapters: Chapter[] = [{ id: 'c1', title: '第1章', pageId: 'p1', level: 1 }]
    await store.putChapters(chapters)
    await store.clearAll()
    expect(await store.listChapters()).toEqual([])
    await store.restorePages([], [], [], chapters)
    expect(await store.listChapters()).toEqual(chapters)
    store.close()
  })
```

また、`より新しいバージョンが開かれるとversionchangeで自分から閉じる` テスト内の `indexedDB.open(name, 3)` を `indexedDB.open(name, 4)` に変える(現行版が3になるため、同じ3を開いても versionchange が起きなくなる)。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/imageStore.test.ts`
Expected: FAIL(`listChapters is not a function`)

- [ ] **Step 3: 実装する**

`src/lib/imageStore.ts`:

1. import を変更: `import type { AdjustmentParams, Chapter, PageEntry } from '../types'`
2. 定数を追加(`OCR_STORE` の下):

```ts
const CHAPTER_STORE = 'chapters'
// 章は配列順が意味を持つ(同一ページ内の順序)ので、1レコードに配列ごと入れる。
const CHAPTER_KEY = 'all'
```

3. `indexedDB.open(name, 2)` を `indexedDB.open(name, 3)` に。`onupgradeneeded` の OCR ストア作成の直後に追加:

```ts
      if (!db.objectStoreNames.contains(CHAPTER_STORE)) {
        db.createObjectStore(CHAPTER_STORE)
      }
```

4. `deleteOcr` の後ろにメソッドを追加:

```ts
  async listChapters(): Promise<Chapter[]> {
    const tx = this.db.transaction(CHAPTER_STORE, 'readonly')
    const stored = await reqToPromise(tx.objectStore(CHAPTER_STORE).get(CHAPTER_KEY))
    return (stored as Chapter[] | undefined) ?? []
  }

  async putChapters(chapters: Chapter[]): Promise<void> {
    const tx = this.db.transaction(CHAPTER_STORE, 'readwrite')
    tx.objectStore(CHAPTER_STORE).put(chapters, CHAPTER_KEY)
    await txDone(tx)
  }
```

5. `clearAll` を変更:

```ts
  async clearAll(): Promise<void> {
    const tx = this.db.transaction([BLOB_STORE, PAGE_STORE, OCR_STORE, CHAPTER_STORE], 'readwrite')
    tx.objectStore(PAGE_STORE).clear()
    tx.objectStore(OCR_STORE).clear()
    tx.objectStore(CHAPTER_STORE).clear()
    tx.objectStore(BLOB_STORE).clear()
    await txDone(tx)
  }
```

6. `restorePages` を変更:

```ts
  async restorePages(
    pages: PageEntry[],
    blobs: [string, Blob][],
    ocr: OcrResult[] = [],
    chapters: Chapter[] = [],
  ): Promise<void> {
    const tx = this.db.transaction([BLOB_STORE, PAGE_STORE, OCR_STORE, CHAPTER_STORE], 'readwrite')
    const ocrStore = tx.objectStore(OCR_STORE)
    for (const result of ocr) ocrStore.put(result)
    if (chapters.length > 0) tx.objectStore(CHAPTER_STORE).put(chapters, CHAPTER_KEY)
    const blobStore = tx.objectStore(BLOB_STORE)
    for (const [id, blob] of blobs) blobStore.put(blob, id)
    const pageStore = tx.objectStore(PAGE_STORE)
    for (const page of pages) pageStore.put(page)
    await txDone(tx)
  }
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/lib/imageStore.test.ts && npm run typecheck`
Expected: PASS(既存テストも通ること)

- [ ] **Step 5: コミット**

```bash
git add src/lib/imageStore.ts src/lib/imageStore.test.ts
git commit -m "feat: IndexedDB v3で章立てを保存できるようにする

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: useChaptersフックと全削除の取り消し

**Files:**
- Create: `src/hooks/useChapters.ts`
- Modify: `src/hooks/useBook.ts` (clearAllの退避・復元)
- Test: `src/hooks/useChapters.test.ts`, `src/hooks/useBook.test.ts`

**Interfaces:**
- Consumes: `ImageStore.listChapters/putChapters` (Task 4), `remapChapters` (Task 1), `Chapter`
- Produces:
  - `useChapters(getStore: () => Promise<ImageStore | null>, options?: { pageIds?: string[] }): UseChaptersResult`
  - `interface UseChaptersResult { chapters: Chapter[]; setChapters: (next: Chapter[]) => Promise<void> }`
  - `setChapters` は状態を即時に更新し(入力欄が遅れない)、保存は直列に行う。`level` は 1 か 2 に丸める。
  - `pageIds` が変わるたびに保存済みの章を読み直す。前回が空でない `pageIds` から一部のページが消えた場合は、消えたページの章を `remapChapters` で寄せて保存する。前回が空/未設定の場合(初回読み込み・全削除の取り消し)は寄せずにそのまま読む。

- [ ] **Step 1: useChaptersの失敗するテストを書く**

`src/hooks/useChapters.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ImageStore } from '../lib/imageStore'
import type { Chapter } from '../types'
import { useChapters } from './useChapters'

const ch = (id: string, pageId: string, level = 1): Chapter => ({ id, title: id, pageId, level })

describe('useChapters', () => {
  let store: ImageStore
  const getStore = async () => store

  function setup(ids?: string[]) {
    return renderHook((props: { ids?: string[] }) => useChapters(getStore, { pageIds: props.ids }), {
      initialProps: { ids },
    })
  }

  beforeEach(async () => {
    store = await ImageStore.open(`chapters-test-${Math.random()}`)
  })

  it('loads saved chapters', async () => {
    await store.putChapters([ch('c1', 'a')])
    const { result } = setup(['a', 'b'])
    await waitFor(() => expect(result.current.chapters).toEqual([ch('c1', 'a')]))
  })

  it('setChapters updates state immediately, saves, and clamps levels to 1 or 2', async () => {
    const { result } = setup(['a'])
    await act(async () => {
      await result.current.setChapters([ch('c1', 'a', 5), ch('c2', 'a', 0)])
    })
    expect(result.current.chapters.map((c) => c.level)).toEqual([2, 1])
    expect((await store.listChapters()).map((c) => c.level)).toEqual([2, 1])
  })

  it('moves a chapter to the next page when its page is deleted', async () => {
    await store.putChapters([ch('c1', 'b')])
    const { result, rerender } = setup(['a', 'b', 'c'])
    await waitFor(() => expect(result.current.chapters).toHaveLength(1))
    rerender({ ids: ['a', 'c'] })
    await waitFor(() => expect(result.current.chapters[0].pageId).toBe('c'))
    expect((await store.listChapters())[0].pageId).toBe('c')
  })

  it('does not drop chapters while the page list is still empty on first load', async () => {
    await store.putChapters([ch('c1', 'a')])
    const { result, rerender } = setup([])
    rerender({ ids: ['a', 'b'] })
    await waitFor(() => expect(result.current.chapters).toEqual([ch('c1', 'a')]))
    expect(await store.listChapters()).toEqual([ch('c1', 'a')])
  })

  it('drops all chapters when the last page is deleted', async () => {
    await store.putChapters([ch('c1', 'a')])
    const { result, rerender } = setup(['a'])
    await waitFor(() => expect(result.current.chapters).toHaveLength(1))
    rerender({ ids: [] })
    await waitFor(() => expect(result.current.chapters).toEqual([]))
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/hooks/useChapters.test.ts`
Expected: FAIL(`./useChapters` が存在しない)

- [ ] **Step 3: useChaptersを実装する**

`src/hooks/useChapters.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageStore } from '../lib/imageStore'
import { remapChapters } from '../lib/toc/chapters'
import type { Chapter } from '../types'

export interface UseChaptersResult {
  chapters: Chapter[]
  setChapters: (next: Chapter[]) => Promise<void>
}

export interface UseChaptersOptions {
  /** 現在のページID一覧(書籍順)。変わるたびに保存済みの章を読み直し、消えたページの章を寄せる。 */
  pageIds?: string[]
}

function clampLevels(chapters: Chapter[]): Chapter[] {
  return chapters.map((c) => ({ ...c, level: c.level >= 2 ? 2 : 1 }))
}

export function useChapters(
  getStore: () => Promise<ImageStore | null>,
  options: UseChaptersOptions = {},
): UseChaptersResult {
  const { pageIds } = options
  const [chapters, setChaptersState] = useState<Chapter[]>([])
  const getStoreRef = useRef(getStore)
  useEffect(() => {
    getStoreRef.current = getStore
  })
  const mountedRef = useRef(true)
  const prevIdsRef = useRef<string[] | null>(null)
  // 保存は直列にする。入力のたびに呼ばれるので、順序が入れ替わると古い値が残る。
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const pagesKey = pageIds ? pageIds.join(',') : null
  useEffect(() => {
    if (!pageIds) return
    const prev = prevIdsRef.current
    prevIdsRef.current = pageIds
    void (async () => {
      const store = await getStoreRef.current()
      if (!store || !mountedRef.current) return
      const stored = await store.listChapters()
      const alive = new Set(pageIds)
      // 前回のページ一覧が空(初回読み込み・全削除の取り消し)のときは、まだ全ページが
      // 揃っていないだけの可能性があるので寄せない。寄せると章を誤って捨ててしまう。
      const shouldRemap = prev !== null && prev.length > 0 && stored.some((c) => !alive.has(c.pageId))
      const next = shouldRemap ? remapChapters(stored, prev, pageIds) : stored
      if (shouldRemap) await store.putChapters(next)
      if (mountedRef.current) setChaptersState(next)
    })().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageIds の中身は pagesKey で見る
  }, [pagesKey])

  const setChapters = useCallback(async (next: Chapter[]) => {
    const normalized = clampLevels(next)
    setChaptersState(normalized)
    const write = writeChainRef.current.then(async () => {
      const store = await getStoreRef.current()
      if (store) await store.putChapters(normalized)
    })
    writeChainRef.current = write.catch(() => {})
    await write
  }, [])

  return { chapters, setChapters }
}
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/hooks/useChapters.test.ts && npm run typecheck && npm run lint`
Expected: PASS。lintが `react-hooks/exhaustive-deps` の disable コメントを不要と言う場合(oxlintが該当ルールを持たない場合)は、そのコメント行だけ削除する。

- [ ] **Step 5: 全削除の取り消しで章が戻るテストを書く**

`src/hooks/useBook.test.ts` の `exposes getStore and restores OCR results when undoing clear-all` の直後に追加:

```ts
  it('restores chapters when undoing clear-all', async () => {
    const view = await importPages([imageFile('a.png', [1, 2, 3, 255])])
    const [page] = view.result.current.pages
    const store = await view.result.current.getStore()
    const chapters = [{ id: 'c1', title: '第1章', pageId: page.id, level: 1 }]
    await store!.putChapters(chapters)
    await act(async () => {
      await view.result.current.clearAllPages()
    })
    expect(await store!.listChapters()).toEqual([])
    await act(async () => {
      await view.result.current.undoClearAll()
    })
    expect(await store!.listChapters()).toEqual(chapters)
  })
```

Run: `npx vitest run src/hooks/useBook.test.ts -t "restores chapters"`
Expected: FAIL(取り消し後の `listChapters()` が `[]` のまま)

- [ ] **Step 6: useBookに退避と復元を足す**

`src/hooks/useBook.ts`:

1. import に `Chapter` を追加: `import type { AdjustmentParams, BookMetadata, Chapter, PageEntry, RawImage } from '../types'`
2. `clearAllSnapshotRef` の型に `chapters: Chapter[]` を追加:

```ts
  const clearAllSnapshotRef = useRef<{
    pages: PageEntry[]
    blobs: [string, Blob][]
    ocr: OcrResult[]
    chapters: Chapter[]
  } | null>(null)
```

3. `clearAllPages` 内、`const snapshotOcr = await store.listOcr()` の直後に `const snapshotChapters = await store.listChapters()` を足し、退避を更新:

```ts
    clearAllSnapshotRef.current = {
      pages: snapshotPages,
      blobs: snapshotBlobs,
      ocr: snapshotOcr,
      chapters: snapshotChapters,
    }
```

4. `undoClearAll` の `restorePages` 呼び出しを更新:

```ts
    await store.restorePages(snapshot.pages, snapshot.blobs, snapshot.ocr, snapshot.chapters)
```

- [ ] **Step 7: 通過を確認する**

Run: `npx vitest run src/hooks && npm run typecheck`
Expected: PASS

- [ ] **Step 8: コミット**

```bash
git add src/hooks/useChapters.ts src/hooks/useChapters.test.ts src/hooks/useBook.ts src/hooks/useBook.test.ts
git commit -m "feat: 章立てのフックと全削除取り消し時の復元を追加する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: PDFのしおり(アウトライン)

**Files:**
- Modify: `src/lib/pdfExport.ts`
- Test: `src/lib/pdfExport.test.ts`

**Interfaces:**
- Consumes: `ExportChapter` (Task 1), `buildOutlineTree`, `OutlineNode` (Task 1)
- Produces: `buildPdf(pages: ExportPage[], metadata: BookMetadata, chapters: ExportChapter[] = []): Promise<Uint8Array>` — 章があれば `/Outlines` を持つ。`pageIndex` が範囲外の章は無視。章が0件(無視後も)ならアウトラインなし。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/pdfExport.test.ts` の import を差し替え・追加し、末尾に `describe` を追加:

```ts
import { PDFDocument, PDFDict, PDFHexString, PDFName, PDFRef } from 'pdf-lib'
```

```ts
interface OutlineItem {
  title: string
  pageIndex: number
  children: OutlineItem[]
}

// 生成したPDFを読み直し、/Outlines の木をたどって取り出す。
function readOutline(doc: PDFDocument): OutlineItem[] | null {
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  if (!root) return null
  const pageRefs = doc.getPages().map((p) => p.ref)
  const readSiblings = (first: PDFRef | undefined): OutlineItem[] => {
    const items: OutlineItem[] = []
    let ref: PDFRef | undefined = first
    while (ref) {
      const dict = doc.context.lookup(ref, PDFDict)
      const title = dict.lookup(PDFName.of('Title'), PDFHexString).decodeText()
      const dest = dict.lookup(PDFName.of('Dest'))
      // Dest は [pageRef, /Fit]
      const destPageRef = (dest as unknown as { array: unknown[] }).array[0] as PDFRef
      const firstChild = dict.get(PDFName.of('First')) as PDFRef | undefined
      items.push({
        title,
        pageIndex: pageRefs.findIndex((r) => r === destPageRef),
        children: readSiblings(firstChild),
      })
      ref = dict.get(PDFName.of('Next')) as PDFRef | undefined
    }
    return items
  }
  return readSiblings(root.get(PDFName.of('First')) as PDFRef | undefined)
}

describe('buildPdf outlines', () => {
  const jpeg = decodeBase64Jpeg()
  const pages = [0, 1, 2].map(() => ({ jpeg, width: 2, height: 1 }))
  const meta = { title: 't', author: 'a' }

  it('adds nested bookmarks pointing at the right pages', async () => {
    const bytes = await buildPdf(pages, meta, [
      { title: '第1章', pageIndex: 0, level: 1 },
      { title: '1.1 背景', pageIndex: 1, level: 2 },
      { title: '第2章', pageIndex: 2, level: 1 },
    ])
    const outline = readOutline(await PDFDocument.load(bytes))
    expect(outline).toEqual([
      { title: '第1章', pageIndex: 0, children: [{ title: '1.1 背景', pageIndex: 1, children: [] }] },
      { title: '第2章', pageIndex: 2, children: [] },
    ])
  })

  it('has no outlines without chapters or when every chapter is out of range', async () => {
    expect(readOutline(await PDFDocument.load(await buildPdf(pages, meta)))).toBeNull()
    const bytes = await buildPdf(pages, meta, [{ title: 'x', pageIndex: 9, level: 1 }])
    expect(readOutline(await PDFDocument.load(bytes))).toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/pdfExport.test.ts`
Expected: FAIL(1つ目のテストで `readOutline` が `null`)

- [ ] **Step 3: 実装する**

`src/lib/pdfExport.ts` を次のとおりに書き換える(既存部分は保ち、アウトラインを足す):

```ts
import { PDFDocument, PDFHexString, PDFName, type PDFContext, type PDFRef } from 'pdf-lib'
import type { BookMetadata, ExportChapter } from '../types'
import { buildOutlineTree, type OutlineNode } from './toc/chapters'

export interface ExportPage {
  jpeg: Uint8Array
  width: number
  height: number
}

// 兄弟の項目を書き込み、先頭・末尾の参照と、子孫を含めた項目数を返す。
// pdf-lib にはしおり用のAPIがないので、低レベルの辞書を組み立てる。
function writeOutlineItems(
  doc: PDFDocument,
  context: PDFContext,
  nodes: OutlineNode[],
  parentRef: PDFRef,
): { first: PDFRef; last: PDFRef; count: number } {
  const refs = nodes.map(() => context.nextRef())
  let count = 0
  nodes.forEach((node, i) => {
    const dict = context.obj({
      Title: PDFHexString.fromText(node.chapter.title),
      Parent: parentRef,
      Dest: [doc.getPage(node.chapter.pageIndex).ref, PDFName.of('Fit')],
    })
    if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1])
    if (i < nodes.length - 1) dict.set(PDFName.of('Next'), refs[i + 1])
    count += 1
    if (node.children.length > 0) {
      const children = writeOutlineItems(doc, context, node.children, refs[i])
      dict.set(PDFName.of('First'), children.first)
      dict.set(PDFName.of('Last'), children.last)
      dict.set(PDFName.of('Count'), context.obj(children.count))
      count += children.count
    }
    context.assign(refs[i], dict)
  })
  return { first: refs[0], last: refs[refs.length - 1], count }
}

function addOutlines(doc: PDFDocument, chapters: ExportChapter[]): void {
  const pageCount = doc.getPageCount()
  const valid = chapters.filter((c) => c.pageIndex >= 0 && c.pageIndex < pageCount)
  const roots = buildOutlineTree(valid)
  if (roots.length === 0) return
  const context = doc.context
  const rootRef = context.nextRef()
  const items = writeOutlineItems(doc, context, roots, rootRef)
  const rootDict = context.obj({
    Type: 'Outlines',
    First: items.first,
    Last: items.last,
    Count: items.count,
  })
  context.assign(rootRef, rootDict)
  doc.catalog.set(PDFName.of('Outlines'), rootRef)
}

export async function buildPdf(
  pages: ExportPage[],
  metadata: BookMetadata,
  chapters: ExportChapter[] = [],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  if (metadata.title) doc.setTitle(metadata.title)
  if (metadata.author) doc.setAuthor(metadata.author)

  for (const page of pages) {
    const image = await doc.embedJpg(page.jpeg)
    const pdfPage = doc.addPage([page.width, page.height])
    pdfPage.drawImage(image, { x: 0, y: 0, width: page.width, height: page.height })
  }

  if (pages.length > 0) {
    const firstPage = doc.getPage(0)
    const openAction = doc.context.obj([firstPage.ref, PDFName.of('FitH'), null])
    doc.catalog.set(PDFName.of('OpenAction'), openAction)
  }

  addOutlines(doc, chapters)

  return doc.save()
}
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/lib/pdfExport.test.ts && npm run typecheck`
Expected: PASS。`context.obj(...)` の型や `PDFRef` の `===` 比較で型エラーが出た場合は、テスト側の `readOutline` の型アサーションを調整する(実装のPDF構造は上のとおり)。`context.obj` が `Type: 'Outlines'` を `/Outlines` 名前オブジェクトにすることをテストで確認済みにする(`readOutline` が `Outlines` 辞書を `lookupMaybe(..., PDFDict)` で読めれば良い)。

- [ ] **Step 5: コミット**

```bash
git add src/lib/pdfExport.ts src/lib/pdfExport.test.ts
git commit -m "feat: PDFにしおり(アウトライン)を埋め込む

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: EPUBの目次(nav)

**Files:**
- Modify: `src/lib/epubExport.ts`
- Test: `src/lib/epubExport.test.ts`

**Interfaces:**
- Consumes: `ExportChapter`, `buildOutlineTree`, `OutlineNode`
- Produces: `buildEpub(pages: ExportPage[], metadata: BookMetadata, chapters: ExportChapter[] = []): Promise<Uint8Array>` — 有効な章があれば `nav.xhtml` の toc を入れ子の `<ol>` にする。章がなければ従来のnav(`Start` の1項目)。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/epubExport.test.ts` の既存テストの書き方(JSZipで `OEBPS/nav.xhtml` を読む。43行目付近)に合わせ、`describe` 内に追加する。既存のページ作成部分(jpegフィクスチャ)を流用し、3ページ分の `pages` を用意して:

```ts
  it('builds a nested toc in nav.xhtml from chapters', async () => {
    const jpeg = decodeBase64Jpeg()
    const pages = [0, 1, 2].map(() => ({ jpeg, width: 2, height: 1 }))
    const bytes = await buildEpub(pages, { title: 't', author: 'a' }, [
      { title: '第1章 <はじめに>', pageIndex: 0, level: 1 },
      { title: '1.1 背景', pageIndex: 1, level: 2 },
      { title: '第2章', pageIndex: 2, level: 1 },
      { title: '範囲外', pageIndex: 9, level: 1 },
    ])
    const zip = await JSZip.loadAsync(bytes)
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav).toContain('<a href="text/page-1.xhtml">第1章 &lt;はじめに&gt;</a>')
    expect(nav).toContain('<a href="text/page-2.xhtml">1.1 背景</a>')
    expect(nav).toContain('<a href="text/page-3.xhtml">第2章</a>')
    expect(nav).not.toContain('範囲外')
    expect(nav).not.toContain('>Start<')
    // 節は章の <li> の中の入れ子の <ol> に入る。
    expect(nav).toMatch(/第1章[\s\S]*<ol>[\s\S]*1\.1 背景[\s\S]*<\/ol>[\s\S]*第2章/)
  })

  it('keeps the plain nav when there are no chapters', async () => {
    const jpeg = decodeBase64Jpeg()
    const bytes = await buildEpub([{ jpeg, width: 2, height: 1 }], { title: 't', author: 'a' })
    const zip = await JSZip.loadAsync(bytes)
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav).toContain('>Start<')
  })
```

(`JSZip` / `decodeBase64Jpeg` / `buildEpub` は既存テストのimportにあるはず。なければ追加する。)

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/epubExport.test.ts`
Expected: FAIL(navに章が出ない)

- [ ] **Step 3: 実装する**

`src/lib/epubExport.ts`:

1. import を変更・追加:

```ts
import type { BookMetadata, ExportChapter } from '../types'
import { buildOutlineTree, type OutlineNode } from './toc/chapters'
```

2. `navXhtml()` を次に置き換える:

```ts
function navItems(nodes: OutlineNode[], indent: string): string {
  return nodes
    .map((node) => {
      const link = `<a href="text/page-${node.chapter.pageIndex + 1}.xhtml">${escapeXml(node.chapter.title)}</a>`
      if (node.children.length === 0) return `${indent}<li>${link}</li>`
      return `${indent}<li>${link}\n${indent}  <ol>\n${navItems(node.children, `${indent}    `)}\n${indent}  </ol>\n${indent}</li>`
    })
    .join('\n')
}

function navXhtml(chapters: ExportChapter[], pageCount: number): string {
  const valid = chapters.filter((c) => c.pageIndex >= 0 && c.pageIndex < pageCount)
  const items =
    valid.length > 0
      ? navItems(buildOutlineTree(valid), '      ')
      : '      <li><a href="text/page-1.xhtml">Start</a></li>'
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Navigation</title></head>
<body>
  <nav epub:type="toc">
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>
`
}
```

3. `buildEpub` のシグネチャを `buildEpub(pages: ExportPage[], metadata: BookMetadata, chapters: ExportChapter[] = [])` にし、`oebps.file('nav.xhtml', navXhtml())` を `oebps.file('nav.xhtml', navXhtml(chapters, pages.length))` に変える。

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/lib/epubExport.test.ts && npm run typecheck`
Expected: PASS(既存テストも通ること)

- [ ] **Step 5: コミット**

```bash
git add src/lib/epubExport.ts src/lib/epubExport.test.ts
git commit -m "feat: EPUBのnavに章立てを反映する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: 書き出しの配線(Worker・useBook・ExportPanel)

**Files:**
- Modify: `src/workers/exportCore.ts`
- Modify: `src/hooks/useBook.ts` (`exportBook`)
- Modify: `src/components/ExportPanel.tsx`
- Test: `src/workers/exportCore.test.ts`, `src/hooks/useBook.test.ts`, `src/components/ExportPanel.test.tsx`

**Interfaces:**
- Consumes: `buildPdf`/`buildEpub` の第3引数 (Task 6/7), `toExportChapters` (Task 1), `store.listChapters` (Task 4)
- Produces:
  - `ExportRequest.chapters?: ExportChapter[]`
  - `UseBookResult.exportBook(format, onProgress?, options?: { embedChapters?: boolean })` — `embedChapters === false` のときだけ章を渡さない(既定は埋め込む)
  - `ExportPanel` の props に `chapterCount?: number` と、`onExport(format, onProgress, options: { embedChapters: boolean })`

- [ ] **Step 1: exportCoreの失敗するテストを書く**

`src/workers/exportCore.test.ts` の既存テストのやり方(`runExport(request, encodeJpeg, decodeBlob)` にfakeを渡す)に合わせて、次を追加する。既存のfake/リクエスト組み立てを流用し、リクエストに `chapters` を足すだけにする:

```ts
  it('embeds chapters into the PDF outline', async () => {
    // 既存テストと同じ手順でrequest(2ページ)を作り、chapters を足して実行する。
    const request = { ...baseRequest('pdf', 2), chapters: [{ title: '第1章', pageIndex: 1, level: 1 }] }
    const bytes = await runExport(request, fakeEncode, fakeDecode)
    const doc = await PDFDocument.load(bytes)
    expect(doc.catalog.has(PDFName.of('Outlines'))).toBe(true)
  })
```

`baseRequest` / `fakeEncode` / `fakeDecode` は、既存テストに同等のヘルパーがあればその名前に合わせ、無ければ既存テストの中身を切り出して作る。`PDFDocument`, `PDFName` は `pdf-lib` からimportする。

Run: `npx vitest run src/workers/exportCore.test.ts`
Expected: FAIL(Outlinesが無い)

- [ ] **Step 2: exportCoreを実装する**

`src/workers/exportCore.ts`:

- import に `ExportChapter` を追加: `import type { AdjustmentParams, BookMetadata, ExportChapter, RawImage } from '../types'`
- `ExportRequest` に追加:

```ts
export interface ExportRequest {
  format: 'pdf' | 'epub'
  metadata: BookMetadata
  pages: ExportRequestPage[]
  // しおり・目次に埋め込む章。書き出し順のページindexで持つ。未指定・空なら従来どおり。
  chapters?: ExportChapter[]
}
```

- `buildPdf(exportPages, request.metadata)` / `buildEpub(exportPages, request.metadata)` の呼び出しに `request.chapters` を第3引数で渡す:

```ts
  return request.format === 'pdf'
    ? buildPdf(exportPages, request.metadata, request.chapters)
    : buildEpub(exportPages, request.metadata, request.chapters)
```

Run: `npx vitest run src/workers/exportCore.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 3: useBook.exportBookの失敗するテストを書く**

`src/hooks/useBook.test.ts` の `sends stored blobs, not decoded pixels, to the export worker` の直後に追加:

```ts
  it('passes chapters converted to page indexes to the export worker, unless embedding is off', async () => {
    const view = await importPages([
      imageFile('a.png', [1, 2, 3, 255]),
      imageFile('b.png', [4, 5, 6, 255]),
    ])
    const [, second] = view.result.current.pages
    const store = await view.result.current.getStore()
    await store!.putChapters([
      { id: 'c1', title: '第1章', pageId: second.id, level: 1 },
      { id: 'c2', title: '消えたページ', pageId: 'gone', level: 1 },
    ])
    vi.mocked(runExportInWorker).mockClear()
    await act(async () => {
      await view.result.current.exportBook('pdf')
    })
    expect(vi.mocked(runExportInWorker).mock.calls[0][0].chapters).toEqual([
      { title: '第1章', pageIndex: 1, level: 1 },
    ])
    vi.mocked(runExportInWorker).mockClear()
    await act(async () => {
      await view.result.current.exportBook('pdf', undefined, { embedChapters: false })
    })
    expect(vi.mocked(runExportInWorker).mock.calls[0][0].chapters).toEqual([])
  })
```

Run: `npx vitest run src/hooks/useBook.test.ts -t "passes chapters"`
Expected: FAIL(`chapters` が undefined)

- [ ] **Step 4: useBook.exportBookを実装する**

`src/hooks/useBook.ts`:

1. import: `import { toExportChapters } from '../lib/toc/chapters'`
2. `UseBookResult` の `exportBook` の型を更新:

```ts
  exportBook: (
    format: 'pdf' | 'epub',
    onProgress?: (done: number, total: number) => void,
    options?: { embedChapters?: boolean },
  ) => Promise<Blob>
```

3. `exportBook` の実装を更新(`async (format, onProgress)` → `async (format, onProgress, options)`、`runExportInWorker` の前で章を作る):

```ts
    async (
      format: 'pdf' | 'epub',
      onProgress?: (done: number, total: number) => void,
      options?: { embedChapters?: boolean },
    ) => {
      // (既存の本体はそのまま。exportPages を作り終えたあとに次を足す)
      const chapters =
        options?.embedChapters === false
          ? []
          : toExportChapters(
              await store.listChapters(),
              currentPages.map((p) => p.id),
            )
      return runExportInWorker({ format, metadata, pages: exportPages, chapters }, onProgress)
    },
```

(既存の `return runExportInWorker({ format, metadata, pages: exportPages }, onProgress)` を上の `return` に置き換える。)

Run: `npx vitest run src/hooks/useBook.test.ts && npm run typecheck`
Expected: PASS。既存テストが `runExportInWorker` の呼び出し引数を `toEqual` で厳密比較して失敗する場合は、`chapters: []` を期待値に加える。

- [ ] **Step 5: ExportPanelの失敗するテストを書く**

`src/components/ExportPanel.test.tsx` の既存の2つのアサーション(10行目・18行目)を、第3引数 `{ embedChapters: true }` を含む形に更新する:

```ts
    await waitFor(() =>
      expect(onExport).toHaveBeenCalledWith('pdf', expect.any(Function), { embedChapters: true }),
    )
```
(epubの方も同様に `'epub'`)。さらに追加:

```ts
  it('shows the embed checkbox only when there are chapters and passes its value', async () => {
    const onExport = vi.fn(async () => new Blob(['x']))
    const { rerender } = render(<ExportPanel onExport={onExport} chapterCount={0} />)
    expect(screen.queryByLabelText('しおり・目次を埋め込む')).not.toBeInTheDocument()

    rerender(<ExportPanel onExport={onExport} chapterCount={3} />)
    const checkbox = screen.getByLabelText('しおり・目次を埋め込む') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() =>
      expect(onExport).toHaveBeenCalledWith('pdf', expect.any(Function), { embedChapters: false }),
    )
  })
```
(`fireEvent` / `screen` / `vi` / `render` / `waitFor` は既存のimportに合わせて足す。)

Run: `npx vitest run src/components/ExportPanel.test.tsx`
Expected: FAIL

- [ ] **Step 6: ExportPanelを実装する**

`src/components/ExportPanel.tsx`:

1. props を更新:

```ts
interface ExportPanelProps {
  onExport: (
    format: Format,
    onProgress?: (done: number, total: number) => void,
    options?: { embedChapters: boolean },
  ) => Promise<Blob>
  title?: string
  // 章立てが1件以上あるときだけ「しおり・目次を埋め込む」を出す。
  chapterCount?: number
}
```

2. コンポーネント先頭で受け取り・状態を追加:

```ts
export function ExportPanel({ onExport, title, chapterCount = 0 }: ExportPanelProps) {
  const [embedChapters, setEmbedChapters] = useState(true)
```

3. `handleExport` の呼び出しを更新:

```ts
      const blob = await onExport(format, (done, total) => setProgress({ done, total }), {
        embedChapters,
      })
```

4. `export-panel__formats` の `</div>` の直後(`<button ...>書き出し</button>` の前)に追加:

```tsx
      {chapterCount > 0 && (
        <label>
          <input
            type="checkbox"
            checked={embedChapters}
            onChange={(event) => setEmbedChapters(event.target.checked)}
          />
          しおり・目次を埋め込む
        </label>
      )}
```

Run: `npx vitest run src/components/ExportPanel.test.tsx && npm run typecheck`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add src/workers/exportCore.ts src/workers/exportCore.test.ts src/hooks/useBook.ts src/hooks/useBook.test.ts src/components/ExportPanel.tsx src/components/ExportPanel.test.tsx
git commit -m "feat: 書き出しで章立てをしおり・目次として埋め込む

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: 章立てステップのUI

**Files:**
- Create: `src/components/ChaptersStep.tsx`
- Modify: `src/index.css` (末尾にクラスを追加)
- Test: `src/components/ChaptersStep.test.tsx`

**Interfaces:**
- Consumes: `detectTocPages`, `tocScanWindow` (Task 3), `parseToc`, `defaultBodyStartIndex` (Task 2), `sortChapters`, `newChapterId` (Task 1), `Chapter`, `PageEntry`, `OcrResult`
- Produces: `ChaptersStep` コンポーネント

```ts
export interface ChaptersStepProps {
  pages: PageEntry[]
  thumbnails: Record<string, string>
  ocrResults: Record<string, OcrResult>
  ocrRunning: boolean
  /** 検出範囲(先頭N枚)のうち未OCRのページにOCRをかける。 */
  onRunOcr: (pageIds: string[]) => void
  chapters: Chapter[]
  onChange: (chapters: Chapter[]) => void
}
```

挙動:
- 表示時(マウント時)に、目次ページ未選択なら自動検出して事前選択する。「目次ページを自動検出」ボタンでも再検出できる。検出できなければ「自動検出できませんでした。手動で選んでください」を出す。
- 検出範囲に未OCRのページがあれば「先頭N枚のうちM枚が未OCRです」と「先頭N枚をOCR」ボタンを出す(全ページOCRは強制しない)。
- 目次ページはページごとのチェックボックス(OCR未実施のページは選べない)。
- 「本文1ページ目 = 画像○枚目」の数値入力(1始まり)。目次ページの選択が変わったら既定値(`defaultBodyStartIndex + 1`)に更新する。ユーザーが手で変えた後は上書きしない。
- 「目次を解析」で候補を作り、開始ページ順に並べて `onChange` へ渡す(現在の章立てを置き換える。既存の章があるときはボタン名を「目次を解析して章立てを置き換える」にする)。0件なら「目次から章を読み取れませんでした」。
- 章の編集リスト: タイトル入力、開始ページ選択(`○枚目`)、階層(章/節)、削除、「章を追加」。開始ページを変えたら開始ページ順に並べ直す。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/ChaptersStep.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ChaptersStep, type ChaptersStepProps } from './ChaptersStep'
import type { OcrResult } from '../lib/ocr/types'
import type { Chapter, PageEntry } from '../types'

function page(id: string, order: number): PageEntry {
  return {
    id,
    order,
    blobId: `blob-${id}`,
    width: 10,
    height: 10,
    adjustment: { brightness: 0, contrast: 0 },
  }
}

function ocr(pageId: string, texts: string[]): OcrResult {
  return {
    pageId,
    modelVersion: 't',
    updatedAt: 1,
    lines: texts.map((text, i) => ({ id: `${pageId}-${i}`, x: 0, y: i, w: 1, h: 1, text, edited: false })),
  }
}

const tocTexts = [
  '目次',
  '第1章 はじめに ........ 1',
  '1.1 背景 ........ 2',
  '第2章 手法 ........ 5',
  '第3章 結果 ........ 9',
  '第4章 議論 ........ 12',
]

// 目次(p1) + 本文(p2..p10)。検出範囲は ceil(10*0.3)=3 枚。
const pages = Array.from({ length: 10 }, (_, i) => page(`p${i + 1}`, i))
const thumbnails = Object.fromEntries(pages.map((p) => [p.id, `blob:${p.id}`]))

function setup(overrides: Partial<ChaptersStepProps> = {}) {
  const props: ChaptersStepProps = {
    pages,
    thumbnails,
    ocrResults: { p1: ocr('p1', tocTexts), p2: ocr('p2', ['本文']), p3: ocr('p3', ['本文']) },
    ocrRunning: false,
    onRunOcr: vi.fn(),
    chapters: [],
    onChange: vi.fn(),
    ...overrides,
  }
  render(<ChaptersStep {...props} />)
  return props
}

describe('ChaptersStep', () => {
  it('auto-detects the toc page on open and parses it into chapters', () => {
    const props = setup()
    expect(screen.getByLabelText('1枚目を目次ページにする')).toBeChecked()
    // 本文1ページ目の既定値は目次の次の画像(2枚目)。
    expect(screen.getByLabelText('本文1ページ目は画像何枚目か')).toHaveValue(2)
    fireEvent.click(screen.getByText('目次を解析'))
    const chapters = vi.mocked(props.onChange).mock.calls[0][0]
    expect(chapters.map((c) => [c.title, c.pageId, c.level])).toEqual([
      ['第1章 はじめに', 'p2', 1],
      ['1.1 背景', 'p3', 2],
      ['第2章 手法', 'p6', 1],
      ['第3章 結果', 'p10', 1],
      ['第4章 議論', 'p10', 1],
    ])
  })

  it('says so when nothing can be detected', () => {
    setup({ ocrResults: { p1: ocr('p1', ['本文']), p2: ocr('p2', ['本文']), p3: ocr('p3', ['本文']) } })
    expect(screen.getByText('自動検出できませんでした。手動で選んでください')).toBeInTheDocument()
  })

  it('offers to OCR the unscanned pages in the scan window', () => {
    const props = setup({ ocrResults: { p1: ocr('p1', ['本文']) } })
    expect(screen.getByText('先頭3枚のうち2枚が未OCRです')).toBeInTheDocument()
    fireEvent.click(screen.getByText('先頭3枚をOCR'))
    expect(props.onRunOcr).toHaveBeenCalledWith(['p2', 'p3'])
  })

  it('does not let a page without OCR be chosen as a toc page', () => {
    setup({ ocrResults: { p1: ocr('p1', ['本文']) } })
    expect(screen.getByLabelText('5枚目を目次ページにする')).toBeDisabled()
  })

  it('reports when the toc has no readable entries', () => {
    setup({ ocrResults: { p1: ocr('p1', ['読めない']) } })
    fireEvent.click(screen.getByLabelText('1枚目を目次ページにする'))
    fireEvent.click(screen.getByText('目次を解析'))
    expect(screen.getByText('目次から章を読み取れませんでした')).toBeInTheDocument()
  })

  it('edits, adds and deletes chapters manually', () => {
    const chapters: Chapter[] = [
      { id: 'c1', title: '第1章', pageId: 'p2', level: 1 },
      { id: 'c2', title: '第2章', pageId: 'p5', level: 1 },
    ]
    const props = setup({ chapters })
    fireEvent.change(screen.getByLabelText('章1のタイトル'), { target: { value: '序章' } })
    expect(vi.mocked(props.onChange).mock.calls.at(-1)![0][0].title).toBe('序章')

    fireEvent.change(screen.getByLabelText('章1の階層'), { target: { value: '2' } })
    expect(vi.mocked(props.onChange).mock.calls.at(-1)![0][0].level).toBe(2)

    fireEvent.click(screen.getByLabelText('章2を削除'))
    expect(vi.mocked(props.onChange).mock.calls.at(-1)![0].map((c) => c.id)).toEqual(['c1'])

    fireEvent.click(screen.getByText('章を追加'))
    const added = vi.mocked(props.onChange).mock.calls.at(-1)![0]
    expect(added).toHaveLength(3)
    expect(added[2]).toMatchObject({ title: '', level: 1 })
  })

  it('re-sorts by start page when a chapter page is changed', () => {
    const chapters: Chapter[] = [
      { id: 'c1', title: 'A', pageId: 'p2', level: 1 },
      { id: 'c2', title: 'B', pageId: 'p5', level: 1 },
    ]
    const props = setup({ chapters })
    fireEvent.change(screen.getByLabelText('章1の開始ページ'), { target: { value: 'p8' } })
    expect(vi.mocked(props.onChange).mock.calls.at(-1)![0].map((c) => c.id)).toEqual(['c2', 'c1'])
  })

  it('labels the parse button as a replacement when chapters already exist', () => {
    setup({ chapters: [{ id: 'c1', title: 'A', pageId: 'p2', level: 1 }] })
    expect(screen.getByText('目次を解析して章立てを置き換える')).toBeInTheDocument()
  })
})
```

`within` を使わないなら import から外す。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/ChaptersStep.test.tsx`
Expected: FAIL(`./ChaptersStep` が存在しない)

- [ ] **Step 3: 実装する**

`src/components/ChaptersStep.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { OcrResult } from '../lib/ocr/types'
import { newChapterId, sortChapters } from '../lib/toc/chapters'
import { detectTocPages, tocScanWindow } from '../lib/toc/detectTocPages'
import { defaultBodyStartIndex, parseToc } from '../lib/toc/parseToc'
import type { Chapter, PageEntry } from '../types'

export interface ChaptersStepProps {
  pages: PageEntry[]
  thumbnails: Record<string, string>
  ocrResults: Record<string, OcrResult>
  ocrRunning: boolean
  /** 検出範囲(先頭N枚)のうち未OCRのページにOCRをかける。 */
  onRunOcr: (pageIds: string[]) => void
  chapters: Chapter[]
  onChange: (chapters: Chapter[]) => void
}

export function ChaptersStep({
  pages,
  thumbnails,
  ocrResults,
  ocrRunning,
  onRunOcr,
  chapters,
  onChange,
}: ChaptersStepProps) {
  const pageIds = useMemo(() => pages.map((p) => p.id), [pages])
  const [tocPageIds, setTocPageIds] = useState<string[]>([])
  const [bodyStart, setBodyStart] = useState(1) // 画像の何枚目が印刷ページ1か(1始まり)
  const [bodyStartEdited, setBodyStartEdited] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const windowSize = tocScanWindow(pages.length)
  const detection = useMemo(() => detectTocPages(pageIds, ocrResults), [pageIds, ocrResults])

  function runDetection() {
    if (detection.pageIds.length > 0) {
      setTocPageIds(detection.pageIds)
      setBodyStartEdited(false)
      setNotice(null)
    } else {
      setNotice('自動検出できませんでした。手動で選んでください')
    }
  }

  // 開いたとき、まだ目次ページが選ばれていなければ検出結果を事前選択する。
  useEffect(() => {
    if (tocPageIds.length === 0) runDetection()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時と、検出対象のOCR結果が届いた時だけ
  }, [detection])

  // 本文1ページ目の既定値は目次の次の画像。ユーザーが直したあとは動かさない。
  useEffect(() => {
    if (bodyStartEdited || tocPageIds.length === 0) return
    setBodyStart(defaultBodyStartIndex(pageIds, tocPageIds) + 1)
  }, [tocPageIds, pageIds, bodyStartEdited])

  function toggleToc(id: string, checked: boolean) {
    setTocPageIds((current) => (checked ? [...current, id] : current.filter((x) => x !== id)))
    setBodyStartEdited(false)
  }

  function handleParse() {
    const parsed = parseToc(tocPageIds, ocrResults, pageIds, bodyStart - 1)
    if (parsed.length === 0) {
      setNotice('目次から章を読み取れませんでした')
      return
    }
    setNotice(null)
    onChange(sortChapters(parsed, pageIds))
  }

  function updateChapter(id: string, patch: Partial<Chapter>, resort = false) {
    const next = chapters.map((c) => (c.id === id ? { ...c, ...patch } : c))
    onChange(resort ? sortChapters(next, pageIds) : next)
  }

  function addChapter() {
    const last = chapters[chapters.length - 1]
    const pageId = last?.pageId ?? pageIds[0]
    if (!pageId) return
    onChange([...chapters, { id: newChapterId(), title: '', pageId, level: 1 }])
  }

  const unscanned = detection.unscannedPageIds

  return (
    <div className="chapters-step">
      <div className="panel">
        <h2>目次ページ</h2>
        {unscanned.length > 0 && (
          <p>
            <span>{`先頭${windowSize}枚のうち${unscanned.length}枚が未OCRです`}</span>{' '}
            <button
              type="button"
              className="btn btn-ghost"
              disabled={ocrRunning}
              onClick={() => onRunOcr(unscanned)}
            >
              {`先頭${windowSize}枚をOCR`}
            </button>
          </p>
        )}
        <button type="button" className="btn btn-ghost" onClick={runDetection}>
          目次ページを自動検出
        </button>
        <div className="chapters-step__pages">
          {pages.map((p, i) => {
            const hasOcr = Boolean(ocrResults[p.id])
            return (
              <label key={p.id} className="chapters-step__page">
                {thumbnails[p.id] && <img src={thumbnails[p.id]} alt="" />}
                <input
                  type="checkbox"
                  aria-label={`${i + 1}枚目を目次ページにする`}
                  checked={tocPageIds.includes(p.id)}
                  disabled={!hasOcr}
                  onChange={(event) => toggleToc(p.id, event.target.checked)}
                />
                <span>{hasOcr ? `${i + 1}` : `${i + 1}(未OCR)`}</span>
              </label>
            )
          })}
        </div>
        <label>
          本文1ページ目 = 画像
          <input
            type="number"
            min={1}
            max={Math.max(pages.length, 1)}
            aria-label="本文1ページ目は画像何枚目か"
            value={bodyStart}
            onChange={(event) => {
              setBodyStart(Number(event.target.value) || 1)
              setBodyStartEdited(true)
            }}
          />
          枚目
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={tocPageIds.length === 0}
          onClick={handleParse}
        >
          {chapters.length > 0 ? '目次を解析して章立てを置き換える' : '目次を解析'}
        </button>
        {notice && <p role="status">{notice}</p>}
      </div>

      <div className="panel">
        <h2>章立て</h2>
        {chapters.length === 0 && <p>章立てはまだありません。目次を解析するか、手で追加してください。</p>}
        {chapters.map((chapter, i) => (
          <div key={chapter.id} className="chapters-step__row">
            {thumbnails[chapter.pageId] && <img src={thumbnails[chapter.pageId]} alt="" />}
            <input
              type="text"
              aria-label={`章${i + 1}のタイトル`}
              value={chapter.title}
              onChange={(event) => updateChapter(chapter.id, { title: event.target.value })}
            />
            <select
              aria-label={`章${i + 1}の開始ページ`}
              value={chapter.pageId}
              onChange={(event) => updateChapter(chapter.id, { pageId: event.target.value }, true)}
            >
              {pages.map((p, pageIndex) => (
                <option key={p.id} value={p.id}>
                  {`${pageIndex + 1}枚目`}
                </option>
              ))}
            </select>
            <select
              aria-label={`章${i + 1}の階層`}
              value={String(chapter.level >= 2 ? 2 : 1)}
              onChange={(event) => updateChapter(chapter.id, { level: Number(event.target.value) })}
            >
              <option value="1">章</option>
              <option value="2">節</option>
            </select>
            <button
              type="button"
              className="btn btn-ghost"
              aria-label={`章${i + 1}を削除`}
              onClick={() => onChange(chapters.filter((c) => c.id !== chapter.id))}
            >
              削除
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost" onClick={addChapter}>
          章を追加
        </button>
      </div>
    </div>
  )
}
```

`src/index.css` の末尾に追加:

```css
.chapters-step { display: flex; flex-direction: column; gap: 1rem; }
.chapters-step__pages { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.75rem 0; }
.chapters-step__page { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; font-size: 0.8rem; }
.chapters-step__page img { width: 48px; height: auto; }
.chapters-step__row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.chapters-step__row img { width: 32px; height: auto; }
.chapters-step__row input[type='text'] { flex: 1; min-width: 0; }
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/components/ChaptersStep.test.tsx && npm run typecheck && npm run lint`
Expected: PASS。テストの期待値と実装がずれた場合(特に自動検出のスコア境界・既定オフセット)は、まず `detectTocPages` / `defaultBodyStartIndex` の仕様どおりか確認してから直す。`react-hooks/exhaustive-deps` の disable コメントは Task 5 と同じ扱い。

- [ ] **Step 5: コミット**

```bash
git add src/components/ChaptersStep.tsx src/components/ChaptersStep.test.tsx src/index.css
git commit -m "feat: 章立てステップのUIを追加する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: App の5工程化と配線

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`, `e2e/full-flow.spec.ts`, `e2e/ocr-review.spec.ts`

**Interfaces:**
- Consumes: `useChapters` (Task 5), `ChaptersStep` (Task 9), `ExportPanel` の `chapterCount` (Task 8), `ocr.runAll(ids, { skipDone: true })` (既存)
- Produces: 工程 `STEPS = ['読み込み', '並べ替え・調整', 'OCR確認・修正', '章立て', '詳細＆書き出し']`

ナビゲーション:
- 工程1: 「OCRへ進む」(→2)、「OCRをスキップして書き出しへ」(→4。既存の挙動を保つ)、「戻る」
- 工程2: 主ボタン「章立てへ進む」(→3)、「章立てをスキップして書き出しへ」(→4)、「戻る」
- 工程3: 主ボタン「詳細情報へ進む」(→4)、「戻る」(→2)
- 工程4: 「章立てへ戻る」(→3)

- [ ] **Step 1: 既存のAppテストを新しい工程に合わせて更新する(先に失敗させる)**

`src/App.test.tsx`:

1. `shows the four steps of the flow` → `shows the five steps of the flow`。ラベル配列を `['読み込み', '並べ替え・調整', 'OCR確認・修正', '章立て', '詳細＆書き出し']` に。
2. `advances from the OCR確認・修正 step to 詳細＆書き出し` を次に置き換える:

```tsx
  it('advances from the OCR確認・修正 step to the 章立て step, then to 詳細＆書き出し', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('OCRへ進む'))
    fireEvent.click(screen.getByText('章立てへ進む'))
    expect(screen.getByText('章を追加')).toBeInTheDocument()
    fireEvent.click(screen.getByText('詳細情報へ進む'))
    expect(screen.getByText('書き出し')).toBeInTheDocument()
  })

  // 章立ても任意工程。OCR確認から直接書き出しへ進める。
  it('lets the user skip the 章立て step', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('OCRへ進む'))
    fireEvent.click(screen.getByText('章立てをスキップして書き出しへ'))
    expect(screen.getByText('書き出し')).toBeInTheDocument()
    expect(screen.queryByText('章を追加')).not.toBeInTheDocument()
  })
```

3. `returns from the 書き出し step to the OCR確認・修正 step` を `returns from the 書き出し step to the 章立て step` に改め、手順を `OCRへ進む` → `章立てへ進む` → `詳細情報へ進む` → `章立てへ戻る` とし、最後に `expect(screen.getByText('章を追加')).toBeInTheDocument()`。
4. `exposes an automation API ...` など `goToStep` の番号を使うテストがあれば、書き出しが工程4になることに合わせる(`grep -n "goToStep" src/App.test.tsx` で確認)。

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL(新しいボタンがない)

- [ ] **Step 2: Appを実装する**

`src/App.tsx`:

1. import を追加:

```ts
import { useChapters } from './hooks/useChapters'
import { ChaptersStep } from './components/ChaptersStep'
```

2. `STEPS` を更新:

```ts
const STEPS = ['読み込み', '並べ替え・調整', 'OCR確認・修正', '章立て', '詳細＆書き出し'] as const
```

3. `const ocr = useOcr(book.getStore, { pageIds })` の直後に追加:

```ts
  const chapters = useChapters(book.getStore, { pageIds })
```

4. `rail__nav` 内を次の構成にする(工程0は既存のまま。工程1の「OCRをスキップして書き出しへ」は `goTo(4)` に):

```tsx
            {step === 1 && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => goTo(2)}>
                  OCRへ進む
                </button>
                {/* OCRは任意工程。使わない人がここで詰まらないよう、書き出しへ直行できる。 */}
                <button type="button" className="btn btn-ghost" onClick={() => goTo(4)}>
                  OCRをスキップして書き出しへ
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => goTo(0)}>
                  戻る
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => goTo(3)}>
                  章立てへ進む
                </button>
                {/* 章立ても任意工程。既存の章立ては消さずに書き出しへ進む。 */}
                <button type="button" className="btn btn-ghost" onClick={() => goTo(4)}>
                  章立てをスキップして書き出しへ
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => goTo(1)}>
                  戻る
                </button>
              </>
            )}
            {step === 3 && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => goTo(4)}>
                  詳細情報へ進む
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => goTo(2)}>
                  戻る
                </button>
              </>
            )}
            {step === 4 && (
              <button type="button" className="btn btn-ghost" onClick={() => goTo(3)}>
                章立てへ戻る
              </button>
            )}
```

5. `step-content` 内: 既存の `{step === 3 && (...MetadataForm/ExportPanel...)}` を `step === 4` に変え、`ExportPanel` に `chapterCount` を渡し、その前に章立て工程を挿入:

```tsx
          {step === 3 && (
            <ChaptersStep
              pages={book.pages}
              thumbnails={book.thumbnails}
              ocrResults={ocr.results}
              ocrRunning={ocr.running}
              onRunOcr={(ids) => void ocr.runAll(ids, { skipDone: true })}
              chapters={chapters.chapters}
              onChange={(next) => void chapters.setChapters(next)}
            />
          )}

          {step === 4 && (
            <>
              <MetadataForm metadata={book.metadata} onChange={book.setMetadata} />
              <ExportPanel
                onExport={book.exportBook}
                title={book.metadata.title}
                chapterCount={chapters.chapters.length}
              />
            </>
          )}
```

(`useEffect` で工程1・2に入ったとき1ページ目を選ぶ処理は変更しない。章立て工程は選択中ページの画素を使わない。)

- [ ] **Step 3: 通過を確認する**

Run: `npx vitest run src/App.test.tsx && npm run typecheck`
Expected: PASS。`mockBook` は `UseBookResult` をそのまま満たす(Task 8 で `exportBook` の型は互換のまま)。型エラーが出たら `exportBook: vi.fn()` の型を確認する。

- [ ] **Step 4: e2eを新しい工程に合わせる**

`e2e/full-flow.spec.ts` の39-42行付近: `OCRへ進む` の後、`詳細情報へ進む` の前に `await page.getByText('章立てへ進む').click()` を足す。`OCRをスキップして書き出しへ`(69行付近)はそのまま動く。
`e2e/ocr-review.spec.ts` は OCR確認画面までしか進めないので変更不要(念のため `grep -n "詳細情報へ進む" e2e/*.ts` で他の箇所がないか確認)。

Run: `npx playwright test --list` (e2eの構文確認のみ。実行はブラウザ取得が必要なため CI 任せでよい)
Expected: エラーなくテスト一覧が出る

- [ ] **Step 5: コミット**

```bash
git add src/App.tsx src/App.test.tsx e2e/full-flow.spec.ts
git commit -m "feat: 工程に章立て(スキップ可)を追加する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: automationApi・llms.txt・ドキュメント・仕様の追従

**Files:**
- Modify: `src/lib/automationApi.ts`
- Modify: `src/App.tsx` (`installAutomationApi` の引数)
- Modify: `public/llms.txt`, `README.md`, `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-21-chapter-toc-design.md`
- Test: `src/lib/automationApi.test.ts`, `src/App.test.tsx`

**Interfaces:**
- Consumes: `Chapter`, `detectTocPages`, `parseToc`, `defaultBodyStartIndex`, `useChapters`
- Produces (`window.EbookMaker` に追加):
  - `getChapters: () => Chapter[]`
  - `setChapters: (chapters: Chapter[]) => Promise<void>`
  - `detectTocPages: () => { pageIds: string[]; unscannedPageIds: string[] }` — 現在のページ・OCR結果に対して検出
  - `parseToc: (tocPageIds: string[], bodyStartPageId?: string) => Chapter[]` — 章の候補を返す(保存はしない。保存は `setChapters`)。`bodyStartPageId` は「印刷ページ1ページ目」に当たるページ。省略時は目次ページの最後の次
  - `AutomationState` に `chapters: Chapter[]`
  - `goToStep` の説明を新しい工程番号(0〜4)に更新

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/automationApi.test.ts` の既存の作り方(`installAutomationApi({...})` に全メソッドを渡す)に合わせ、新メソッドが `describe()` に載ることを確認するテストを追加する:

```ts
  it('describes the chapter methods', () => {
    installAutomationApi(makeApi())
    const methods = window.EbookMaker!.describe().methods
    for (const name of ['getChapters', 'setChapters', 'detectTocPages', 'parseToc']) {
      expect(methods).toHaveProperty(name)
    }
  })
```

`makeApi()` は既存テストの「全メソッドのfakeを返すヘルパー」の名前に合わせる。無い場合は既存テストのインライン定義を関数に切り出し、`getChapters: () => []`, `setChapters: async () => {}`, `detectTocPages: () => ({ pageIds: [], unscannedPageIds: [] })`, `parseToc: () => []` を足す。

Run: `npx vitest run src/lib/automationApi.test.ts`
Expected: FAIL

- [ ] **Step 2: automationApi.ts を更新する**

1. import に `Chapter` を追加: `import type { AdjustmentParams, BookMetadata, Chapter, PageEntry } from '../types'`
2. `AutomationState` に `chapters: Chapter[]` を追加。
3. `AutomationApi` に追加:

```ts
  getChapters: () => Chapter[]
  setChapters: (chapters: Chapter[]) => Promise<void>
  detectTocPages: () => { pageIds: string[]; unscannedPageIds: string[] }
  parseToc: (tocPageIds: string[], bodyStartPageId?: string) => Chapter[]
```

4. `API_DESCRIPTION.methods` に追加、`goToStep` の説明を更新:

```ts
    goToStep: '(step: number) => void — 工程(0:読み込み, 1:並べ替え・調整, 2:OCR確認・修正, 3:章立て, 4:詳細＆書き出し)を切り替える。OCRと章立ては任意工程で、飛ばして4に進んでもよい。',
    getChapters: '() => Chapter[] — 章立て({ id, title, pageId, level })を返す。levelは1=章, 2=節。配列順が書籍順(同一ページ内の順序も表す)。',
    setChapters: '(chapters: Chapter[]) => Promise<void> — 章立てを丸ごと置き換えて保存する。空配列で章立てなし。書き出し時、章があればPDFのしおり・EPUBの目次に埋め込まれる。',
    detectTocPages: '() => { pageIds: string[]; unscannedPageIds: string[] } — OCR結果から目次ページを自動検出する(先頭の一部のページが対象)。unscannedPageIdsは検出範囲内でOCR未実施のページ。',
    parseToc: '(tocPageIds: string[], bodyStartPageId?: string) => Chapter[] — 指定した目次ページのOCR結果から章の候補を作って返す(保存しない)。bodyStartPageIdは印刷ページ1ページ目に当たるページ(省略時は目次の最後の次)。保存はsetChaptersで行う。',
```

`API_DESCRIPTION.methods` の型は `Record<Exclude<keyof AutomationApi, 'describe'>, string>` なので、追加した4メソッドの説明を必ず入れる(入れないと型エラー)。

- [ ] **Step 3: App.tsx の installAutomationApi を更新する**

`import` に `detectTocPages` と `parseToc`, `defaultBodyStartIndex` を追加:

```ts
import { detectTocPages } from './lib/toc/detectTocPages'
import { defaultBodyStartIndex, parseToc } from './lib/toc/parseToc'
```

`getState` の返り値に `chapters: chapters.chapters,` を追加。オブジェクトに次を追加(`goToStep` の近く):

```ts
      getChapters: () => chapters.chapters,
      setChapters: chapters.setChapters,
      detectTocPages: () => detectTocPages(pageIds, ocr.results),
      parseToc: (tocPageIds, bodyStartPageId) => {
        const bodyStart = bodyStartPageId
          ? Math.max(pageIds.indexOf(bodyStartPageId), 0)
          : defaultBodyStartIndex(pageIds, tocPageIds)
        return parseToc(tocPageIds, ocr.results, pageIds, bodyStart)
      },
```

`src/App.test.tsx` の `exposes an automation API` テストに、`window.EbookMaker?.getChapters()` が `[]` を返し、`getState().chapters` が `[]` であることのアサーションを1つ足す。

Run: `npx vitest run src/lib/automationApi.test.ts src/App.test.tsx && npm run typecheck`
Expected: PASS

- [ ] **Step 4: llms.txt・README・CLAUDE.md・specを更新する**

`public/llms.txt`: 末尾に節を追加(既存の書き方に合わせる):

```
## 章立て(しおり・目次)

OCR済みのページから目次を読み取り、章立てとして書き出しに埋め込める。
`window.EbookMaker` の次のメソッドを使う。

1. `runOcrAll()` などで目次ページをOCRしておく。
2. `detectTocPages()` で目次ページを自動検出する(先頭の一部のページが対象)。
3. `parseToc(tocPageIds, bodyStartPageId?)` で章の候補を得る。`bodyStartPageId` は
   印刷ページ1ページ目に当たるページ(省略時は目次の最後の次)。候補は保存されない。
4. 内容を確認・修正して `setChapters(chapters)` で保存する。
5. `exportBook('pdf' | 'epub')` で、章があればPDFのしおり・EPUBの目次に埋め込まれる。
   章を付けたくなければ `setChapters([])`。

章は `{ id, title, pageId, level }`。levelは1(章)か2(節)の2階層まで。
```

`README.md`: 13行付近の機能一覧に「章立て(任意の4番目の工程): 目次ページのOCRから章名と開始ページを読み取り、PDFのしおり・EPUBの目次に埋め込む」を追加し、17行の「操作は3工程(…)」の記述と52行の「工程は「取込 → 調整 → OCR(任意) → 書き出し」」を「取込 → 調整 → OCR(任意) → 章立て(任意) → 書き出し」に直す(現状の記述に合わせて文言を整える)。OCRの節の「OCRのテキストはまだPDF/EPUBには埋め込まれません(今後の課題)。」はそのまま残す(章立ては本文テキストの埋め込みではない)。

`CLAUDE.md` の Architecture 節に1項目追加:

```
- **章立て(目次)**: `lib/toc/` に純関数(`parseToc` 目次OCR行→章候補、`detectTocPages` 目次ページの自動検出、`chapters` ページ追従・書き出し用変換・アウトライン木)。章は `pageId` で持ち、IndexedDBの `chapters` ストア(単一レコード)に保存(`useChapters`)。書き出しでは `useBook.exportBook` が書き出し順のページindexへ変換して Worker へ渡し、`pdfExport.ts` がしおり、`epubExport.ts` がnavを作る。階層は2階層まで。
```

`docs/superpowers/specs/2026-09-21-chapter-toc-design.md` の抽出ロジック1行目 `全角数字・点線リーダー・ローマ数字に対応。` を `全角数字・点線リーダーに対応。ローマ数字は章番号の接頭辞としてのみ扱い、末尾がローマ数字の行はページ番号とみなさない(前付けのページ番号は本文の画像へ換算できないため)。` に直す。

- [ ] **Step 5: コミット**

```bash
git add src/lib/automationApi.ts src/lib/automationApi.test.ts src/App.tsx src/App.test.tsx public/llms.txt README.md CLAUDE.md docs/superpowers/specs/2026-09-21-chapter-toc-design.md
git commit -m "feat: 章立てをwindow.EbookMakerとドキュメントに反映する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: 全体検証

**Files:** なし(検証のみ。失敗があれば該当タスクのファイルを直す)

- [ ] **Step 1: 型・lint・単体テスト・ビルドを通す**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: すべて成功。失敗があれば、出力を読んで原因のタスクに戻って直す(テストの期待値を安易に緩めない)。

- [ ] **Step 2: ブラウザで通し確認する**

Run: `npm run dev` を起動し、`window.EbookMaker` を使って次を確認する(`run` スキルの手順に従う):
1. 数ページ(目次ページ＋本文ページ)を読み込み、OCR結果を `EbookMaker.setOcrLineText` 等ではなく IndexedDB へ直接書くか、実際にOCRを実行して目次ページのOCR結果を用意する(`e2e/ocr-review.spec.ts` の `seedOcr` の書き方が参考になる)。
2. 章立て工程で目次ページが事前選択され、「目次を解析」で章が並ぶ。開始ページを変えると並び直される。
3. 書き出し工程で「しおり・目次を埋め込む」が出る。PDFを書き出し、PDFビューアでしおりが表示されジャンプできる。EPUBを書き出し、`OEBPS/nav.xhtml` に入れ子の目次が入っている。
4. 章立てを空にして書き出すと、従来と同じ出力(しおりなし)になる。
5. ページを削除・結合しても章が消えず、次のページに寄る。「全削除→取り消し」で章が戻る。

- [ ] **Step 3: 結果を報告する**

確認できた項目と、確認できなかった項目(ブラウザで試せなかったなど)を、そのまま報告する。
