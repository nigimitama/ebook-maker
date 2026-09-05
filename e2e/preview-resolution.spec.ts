import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTinyPng } from './makeTinyPng'
import { PREVIEW_MAX_EDGE, THUMBNAIL_MAX_EDGE } from '../src/lib/previewSizes'

// A4を300dpiで取り込んだ寸法。実際のスキャンページはこの大きさになる。
const SCAN_WIDTH = 2480
const SCAN_HEIGHT = 3508

function writeScan(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ebook-maker-preview-'))
  const path = join(dir, name)
  writeFileSync(path, makeTinyPng(SCAN_WIDTH, SCAN_HEIGHT, [180, 180, 180, 255]))
  return path
}

// プレビューはスキャンの実サイズより大幅に小さく表示される(サムネイルは
// 高さ約140px、調整キャンバスは幅数百px)。そのために原本をフル解像度で
// デコードすると実際に描画する画素の約500倍を処理することになり、実物の
// スキャンではページ一覧が這うように遅くなっていた。このテストは縮小処理を
// 固定する: 実際のデコード解像度/バッキングサイズを読むので、
// どちらかのプレビューが原本を使う実装に戻れば失敗する。
test('previews are downscaled, not full-resolution originals', async ({ page }) => {
  await page.goto('/')
  await page.setInputFiles('[data-testid="file-input"]', [writeScan('scan.png')])
  await expect(page.getByRole('listitem')).toHaveCount(1)

  await page.waitForFunction(() => {
    const img = document.querySelector('.page-list__thumb') as HTMLImageElement | null
    return !!img && img.complete && img.naturalWidth > 0
  })
  const thumb = await page.evaluate(() => {
    const img = document.querySelector('.page-list__thumb') as HTMLImageElement
    return { width: img.naturalWidth, height: img.naturalHeight }
  })
  expect(thumb.width).toBeLessThanOrEqual(THUMBNAIL_MAX_EDGE)
  expect(thumb.height).toBeLessThanOrEqual(THUMBNAIL_MAX_EDGE)
  // アスペクト比が保たれている(縦長は縦長のまま)。
  expect(thumb.height).toBeGreaterThan(thumb.width)

  await page.locator('.page-list__thumb').first().click()
  await expect(page.getByTestId('adjustment-canvas')).toBeVisible()
  await page.waitForFunction(() => {
    const canvas = document.querySelector(
      '[data-testid="adjustment-canvas"]',
    ) as HTMLCanvasElement | null
    return !!canvas && canvas.width > 1
  })
  const canvas = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="adjustment-canvas"]') as HTMLCanvasElement
    return { width: el.width, height: el.height }
  })
  expect(canvas.width).toBeLessThanOrEqual(PREVIEW_MAX_EDGE)
  expect(canvas.height).toBeLessThanOrEqual(PREVIEW_MAX_EDGE)
  expect(canvas.height).toBeGreaterThan(canvas.width)
})

// 書き出しは原本のフル解像度を使い続けなければならない。縮小はあくまで
// 表示上の都合であり、縮小プレビューからPDFを作ると気づかないうちに
// ぼやけた本が出来上がる。
test('export keeps the original resolution despite downscaled previews', async ({ page }) => {
  await page.goto('/')
  await page.setInputFiles('[data-testid="file-input"]', [writeScan('scan.png')])
  await expect(page.getByRole('listitem')).toHaveCount(1)

  await page.getByText('書き出し').click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-link').click(),
  ])
  const downloadPath = await download.path()
  const { PDFDocument } = await import('pdf-lib')
  const fs = await import('node:fs')
  const doc = await PDFDocument.load(await fs.promises.readFile(downloadPath!))
  const [first] = doc.getPages()
  expect(Math.round(first.getWidth())).toBe(SCAN_WIDTH)
  expect(Math.round(first.getHeight())).toBe(SCAN_HEIGHT)
})
