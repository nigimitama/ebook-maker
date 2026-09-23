import { test, expect } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
// window.EbookMaker の型(declare global)を取り込むための型だけのimport。
import type {} from '../src/lib/automationApi'
import type { OcrResult } from '../src/lib/ocr/types'
import { detectTocPages } from '../src/lib/toc/detectTocPages'
import { parseTocEntries } from '../src/lib/toc/parseToc'

// src/test/toc_images/ の目次ページ画像に実際のOCR(レイアウト検出+文字認識)をかけ、
// その結果に lib/toc の目次検出・解析を通す。lib/toc の単体テストは手で書き起こした
// 理想的なOCR行を使うので、実OCRの誤認識や行のまとまり方による取りこぼしはここで確認する。
const IMAGE_DIR = join(import.meta.dirname, '..', 'src', 'test', 'toc_images')
const MODEL_FILE = join(import.meta.dirname, '..', 'public', 'models', 'deim-s-1024x1024.onnx')

test.describe.configure({ mode: 'serial' })
test.skip(!existsSync(MODEL_FILE), 'OCRモデルがありません(npm run fetch-models で取得してください)')

const ocrByFile = new Map<string, OcrResult>()

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000)
  const page = await browser.newPage()
  await page.goto('/')
  await page.waitForFunction(() => window.EbookMaker !== undefined)
  const names = readdirSync(IMAGE_DIR).filter((name) => name.endsWith('.png')).sort()
  await page.setInputFiles('[data-testid="file-input"]', names.map((name) => join(IMAGE_DIR, name)))
  await page.waitForFunction((count) => window.EbookMaker!.getState().pages.length === count, names.length)
  await page.evaluate(() => window.EbookMaker!.runOcrAll())
  const results = await page.evaluate(() =>
    window.EbookMaker!.getState().pages.map((p) => ({ fileName: p.fileName, ocr: window.EbookMaker!.getOcr(p.id) })),
  )
  for (const { fileName, ocr } of results) if (fileName && ocr) ocrByFile.set(fileName, ocr)
  await page.close()
})

function ocrOf(fileName: string): OcrResult {
  const ocr = ocrByFile.get(fileName)
  if (!ocr) throw new Error(`${fileName} のOCR結果がありません`)
  return ocr
}

/** その画像1枚を書籍の先頭に置いたとして、目次ページと判定されるか。 */
function isDetected(ocr: OcrResult): boolean {
  const ids = [ocr.pageId, ...Array.from({ length: 9 }, (_, i) => `body-${i}`)]
  return detectTocPages(ids, { [ocr.pageId]: ocr }).pageIds.includes(ocr.pageId)
}

function printedPages(ocr: OcrResult): number[] {
  return parseTocEntries(ocr.lines.map((line) => line.text)).map((entry) => entry.printedPage)
}

interface Case {
  file: string
  /** 目次に載っているページ番号(画像から目視)。 */
  pages: number[]
  /** 実OCRでページ番号を最低これだけ読めること(誤認識で一部欠けるのは許容する)。 */
  minEntries: number
  /** ページ番号の読み取りの既知の失敗。直ったら test.fail が失敗に転じて知らせる。 */
  readFailure?: string
  /** 目次ページとしての検出の既知の失敗。 */
  detectFailure?: string
}

const CASES: Case[] = [
  { file: '01_simple_dots.png', pages: [1, 9, 23, 47, 61, 88, 95, 101], minEntries: 5 },
  { file: '02_nested_sections.png', pages: [1, 2, 5, 7, 9, 10, 15, 20, 23, 24, 29, 34, 40], minEntries: 10 },
  { file: '03_two_column.png', pages: [3, 6, 11, 18, 25, 33, 41, 50, 58, 66, 74, 83], minEntries: 10 },
  { file: '04_scan_degraded.png', pages: [1, 7, 19, 38, 55], minEntries: 5 },
  {
    file: '05_mixed_numerals.png',
    pages: [1, 12, 29, 44, 60],
    minEntries: 5,
    readFailure: '右寄せのページ番号の列が縦長の1行として検出され、数字の並びとして誤認識される',
    detectFailure: 'ページ番号が読めないため',
  },
  {
    file: '06_vertical_writing.png',
    pages: [1, 21, 47, 89],
    minEntries: 4,
    readFailure: '第一章のページ番号「一」がレイアウト検出で拾われない',
    detectFailure: '章が4件しかなく、目次とみなす最低件数(5件)に届かない',
  },
  { file: '07_vertical_chapter_opening.png', pages: [4, 6, 9, 23, 26, 28, 30, 31, 35], minEntries: 8 },
  { file: '08_vertical_multi_chapter_toc.png', pages: [15, 19, 24, 29, 41, 45, 52, 58, 63, 77, 80, 88, 95], minEntries: 12 },
  { file: '09_fontsize_contrast_chapter_preview.png', pages: [62, 84], minEntries: 2 },
]

for (const c of CASES) {
  test(`${c.file}: 実OCRの結果からページ番号を読み取る`, async () => {
    test.fail(c.readFailure !== undefined, c.readFailure)
    const ocr = ocrOf(c.file)
    await test.info().attach('ocr-lines.json', {
      body: JSON.stringify(ocr.lines.map(({ text, x, y, w, h }) => ({ text, x, y, w, h })), null, 1),
      contentType: 'application/json',
    })
    const pages = printedPages(ocr)
    expect(pages.length).toBeGreaterThanOrEqual(c.minEntries)
    expect(pages.filter((p) => !c.pages.includes(p))).toEqual([])
  })

  test(`${c.file}: 実OCRの結果から目次ページとして検出する`, async () => {
    test.fail(c.detectFailure !== undefined, c.detectFailure)
    expect(isDetected(ocrOf(c.file))).toBe(true)
  })
}
