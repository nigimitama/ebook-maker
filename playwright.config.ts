import { defineConfig } from '@playwright/test'

// 既定は5173。別のチェックアウトの開発サーバーが5173を使っている場合に
// E2E_PORT で逃がせるようにしておく(そのまま流すと他方のアプリを検証してしまう)。
const port = Number(process.env.E2E_PORT ?? 5173)

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: `http://localhost:${port}`,
  },
})
