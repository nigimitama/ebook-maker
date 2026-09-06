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

  await expect(page.getByRole('listitem')).toHaveCount(2)

  await page.locator('[data-testid^="page-item-"]').first().locator('img').click()
  await expect(page.getByTestId('brightness-slider')).toBeVisible()
  await page.getByTestId('brightness-slider').fill('20')

  await page.getByText('見開き結合').click()
  const checkboxes = page.locator('[data-testid^="merge-checkbox-"]')
  await checkboxes.nth(0).check()
  await checkboxes.nth(1).check()
  await expect(page.getByTestId('merge-preview')).toBeVisible()
  await page.getByText('結合を確定').click()
  await expect(page.getByRole('listitem')).toHaveCount(1)

  await page.getByTestId('title-input').fill('E2E Test Book')
  await page.getByTestId('author-input').fill('E2E Author')

  await page.getByText('書き出し').click()
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
  await expect(page.getByRole('listitem')).toHaveCount(1)

  await page.getByLabel('EPUB').click()
  await page.getByText('書き出し').click()
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
