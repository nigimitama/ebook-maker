import { test, expect } from '@playwright/test'
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

// 書き出しボタンは設定(形式・しおり埋め込み)の下にまとめて置く。
// チェックボックスの横に並ぶと、設定の一部のように見えて押し間違えやすい。
test('places the export button below the embed-chapters checkbox', async ({ page }) => {
  await page.goto('/')
  await page.setInputFiles('[data-testid="file-input"]', [writeFixture('page1.png', [10, 10, 200, 255])])
  await page.getByText('次へ', { exact: true }).click()
  await expect(page.getByRole('listitem')).toHaveCount(1)

  // 章が1件以上あるときだけ「しおり・目次を埋め込む」が出る。
  await page.evaluate(async () => {
    const api = window.EbookMaker!
    const [first] = api.getState().pages
    await api.setChapters([{ id: 'c1', title: '第1章', pageId: first.id, level: 1 }])
  })
  await page.getByText('OCRをスキップして書き出しへ').click()

  const checkbox = await page.getByText('しおり・目次を埋め込む').boundingBox()
  const button = await page.getByRole('button', { name: '書き出し', exact: true }).boundingBox()
  expect(checkbox).not.toBeNull()
  expect(button).not.toBeNull()
  expect(button!.y).toBeGreaterThanOrEqual(checkbox!.y + checkbox!.height)
})
