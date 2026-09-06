import { test, expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTinyPng } from './makeTinyPng'

function writeFixture(name: string, pixel: [number, number, number, number]): string {
  const dir = mkdtempSync(join(tmpdir(), 'ebook-maker-e2e-'))
  const path = join(dir, name)
  writeFileSync(path, makeTinyPng(4, 4, pixel))
  return path
}

test('import, adjust, merge, add metadata, and export a PDF', async ({ page }) => {
  const page1 = writeFixture('page1.png', [200, 0, 0, 255])
  const page2 = writeFixture('page2.png', [0, 200, 0, 255])

  await page.goto('/')
  await page.setInputFiles('[data-testid="file-input"]', [page1, page2])

  // 取り込み → 並べ替え: 見開き結合はこの工程が担当する。
  await page.getByText('次へ', { exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(2)

  const items = page.getByRole('listitem')
  await items.nth(0).getByText('見開き結合', { exact: false }).click()
  await items.nth(1).getByText('見開き結合', { exact: false }).click()
  await expect(page.getByTestId('merge-preview')).toBeVisible()
  await page.getByText('結合を確定').click()
  await expect(page.getByRole('listitem')).toHaveCount(1)

  // 並べ替え → 調整: 最初に取り込んだページが自動で選択され、
  // スライダー操作で明るさ/コントラストを調整できる。
  await page.getByText('調整へ進む').click()
  await expect(page.getByTestId('brightness-slider')).toBeVisible()
  await page.getByTestId('brightness-slider').fill('20')

  // 調整 → 詳細&書き出し
  await page.getByText('詳細情報へ進む').click()
  await page.getByTestId('title-input').fill('E2E Test Book')
  await page.getByTestId('author-input').fill('E2E Author')

  await page.getByRole('button', { name: '書き出し' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-link').click(),
  ])
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()

  const doc = await PDFDocument.load(await import('node:fs').then((fs) => fs.promises.readFile(downloadPath!)))
  expect(doc.getPageCount()).toBe(1)
  expect(doc.getTitle()).toBe('E2E Test Book')
  expect(doc.getAuthor()).toBe('E2E Author')
})

test('exports an EPUB with one xhtml/image pair per page', async ({ page }) => {
  const page1 = writeFixture('epub-page1.png', [10, 10, 200, 255])

  await page.goto('/')
  await page.setInputFiles('[data-testid="file-input"]', [page1])

  await page.getByText('次へ', { exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(1)

  await page.getByText('調整へ進む').click()
  await page.getByText('詳細情報へ進む').click()
  await page.getByLabel('EPUB').click()
  await page.getByRole('button', { name: '書き出し' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-link').click(),
  ])
  const downloadPath = await download.path()
  const fs = await import('node:fs')
  const bytes = await fs.promises.readFile(downloadPath!)
  const zip = await JSZip.loadAsync(bytes)
  expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip')
  expect(zip.file('OEBPS/text/page-1.xhtml')).not.toBeNull()
  expect(zip.file('OEBPS/text/page-2.xhtml')).toBeNull()
})
