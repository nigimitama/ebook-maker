import { defineConfig } from '@playwright/test'

// 実OCRモデルを使う重いテスト(e2e-ocr/)専用の設定。モデル(約150MB)が必要なので
// CIでは動かさず、`npm run fetch-models` 済みのローカルで `npm run test:ocr` として実行する。
const port = Number(process.env.E2E_PORT ?? 5173)

export default defineConfig({
  testDir: './e2e-ocr',
  // 全画像のOCRをまとめて1回かけるため、1テストあたりの上限を長めにとる。
  timeout: 600_000,
  workers: 1,
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: `http://localhost:${port}`,
  },
})
