import { test, expect } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTinyPng } from './makeTinyPng'
import { PREVIEW_MAX_EDGE, THUMBNAIL_MAX_EDGE } from '../src/lib/previewSizes'

// A4 at 300dpi — what a real scanned page actually looks like.
const SCAN_WIDTH = 2480
const SCAN_HEIGHT = 3508

function writeScan(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ebook-maker-preview-'))
  const path = join(dir, name)
  writeFileSync(path, makeTinyPng(SCAN_WIDTH, SCAN_HEIGHT, [180, 180, 180, 255]))
  return path
}

// Previews are shown at a fraction of a scan's real size (thumbnails around
// 140px tall, the adjustment canvas a few hundred px wide). Decoding the
// full-resolution original for them costs ~500x more pixels than get painted,
// which made the page list crawl on real scans. These assertions pin the
// downscaling in place: they read the actual decoded/backing resolution, so
// they fail if a preview ever goes back to using the original.
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
  // Aspect ratio preserved (portrait stays portrait).
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

// The export must still use the full-resolution original — downscaling is a
// display concern only. A PDF built from the downscaled preview would silently
// ship a blurry book.
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
