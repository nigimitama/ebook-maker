import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTinyPng } from './makeTinyPng'
import { OCR_MODEL_VERSION } from '../src/lib/ocr/ocrConfig'
// window.EbookMaker の型(declare global)を取り込むための型だけのimport。
import type {} from '../src/lib/automationApi'
import type { OcrLine } from '../src/lib/ocr/types'

// 実モデル(約150MB)はCIで取得しない。OCR結果をIndexedDBへ直接書いた状態から
// 確認・修正画面の表示・編集・永続化だけを検証する(モデル込みの通しは手動スモーク)。
const PAGE_WIDTH = 240
const PAGE_HEIGHT = 320

function writeFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ebook-maker-ocr-'))
  const path = join(dir, name)
  writeFileSync(path, makeTinyPng(PAGE_WIDTH, PAGE_HEIGHT, [220, 220, 220, 255]))
  return path
}

const LINES: OcrLine[] = [
  { id: 'l1', x: 160, y: 20, w: 40, h: 240, text: '一行目のテキスト', edited: false },
  { id: 'l2', x: 100, y: 20, w: 40, h: 200, text: '二行目のテキスト', edited: false },
  { id: 'l3', x: 40, y: 20, w: 40, h: 160, text: '三行目のテキスト', edited: false },
]

async function seedOcr(page: Page, pageId: string, lines: OcrLine[]): Promise<void> {
  await page.evaluate(
    async ({ pageId, lines, modelVersion }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('ebook-maker', 2)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('ocr', 'readwrite')
        tx.objectStore('ocr').put({ pageId, lines, modelVersion, updatedAt: Date.now() })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    { pageId, lines, modelVersion: OCR_MODEL_VERSION },
  )
}

/** 読み込み工程からOCR確認・修正工程まで進む。 */
async function goToOcrStep(page: Page): Promise<void> {
  await page.getByText('次へ', { exact: true }).click()
  await page.getByText('OCRへ進む').click()
  await expect(page.getByText('このページをOCR')).toBeVisible()
}

async function lineTexts(page: Page): Promise<string[]> {
  return page
    .locator('.ocr-lines .ocr-line__text')
    .evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value))
}

async function importOnePage(page: Page): Promise<string> {
  await page.goto('/')
  await page.setInputFiles('[data-testid="file-input"]', [writeFixture('ocr-page.png')])
  await page.getByText('次へ', { exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(1)
  const pageId = await page.evaluate(() => window.EbookMaker!.getState().pages[0].id)
  expect(pageId).toBeTruthy()
  return pageId
}

test('reviews, edits and persists OCR results seeded in IndexedDB', async ({ page }) => {
  const pageId = await importOnePage(page)
  await seedOcr(page, pageId, LINES)

  // 保存済みの結果は、リロード後もそのまま読み順で並ぶ。
  await page.reload()
  await goToOcrStep(page)
  await expect(page.locator('.ocr-lines .ocr-line')).toHaveCount(3)
  expect(await lineTexts(page)).toEqual([
    '一行目のテキスト',
    '二行目のテキスト',
    '三行目のテキスト',
  ])
  // 枠も行の数だけ画像に重なっている。
  await expect(page.locator('[data-testid="ocr-draw-area"] .ocr-box')).toHaveCount(3)
  await expect(page.getByTestId(`ocr-status-${pageId}`)).toHaveText('済')

  // 修正した文字はIndexedDBに保存され、リロードしても残る。
  const second = page.getByLabel('行2の文字')
  await second.fill('修正した二行目')
  await second.blur()
  await expect(page.locator('.ocr-lines .ocr-line__edited')).toHaveCount(1)

  await page.reload()
  await goToOcrStep(page)
  expect(await lineTexts(page)).toEqual(['一行目のテキスト', '修正した二行目', '三行目のテキスト'])
  await expect(page.getByTestId(`ocr-status-${pageId}`)).toHaveText('修正あり')
})

test('moves and deletes OCR lines, keeping the change after a reload', async ({ page }) => {
  const pageId = await importOnePage(page)
  await seedOcr(page, pageId, LINES)

  await page.reload()
  await goToOcrStep(page)
  await expect(page.locator('.ocr-lines .ocr-line')).toHaveCount(3)

  // 1行目を下へ移動すると読み順が入れ替わる。
  await page.locator('.ocr-lines .ocr-line').first().getByLabel('下へ移動').click()
  await expect
    .poll(() => lineTexts(page))
    .toEqual(['二行目のテキスト', '一行目のテキスト', '三行目のテキスト'])

  // 誤検出の行は削除できる。
  await page.locator('.ocr-lines .ocr-line').last().getByLabel('行を削除').click()
  await expect(page.locator('.ocr-lines .ocr-line')).toHaveCount(2)

  await page.reload()
  await goToOcrStep(page)
  expect(await lineTexts(page)).toEqual(['二行目のテキスト', '一行目のテキスト'])
  await expect(page.locator('[data-testid="ocr-draw-area"] .ocr-box')).toHaveCount(2)
})
