import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/ebook-maker/',
  plugins: [react()],
  // onnxruntime-web を事前バンドルすると同梱wasmの解決が壊れるため除外する。
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  // ocrWorker は import 文と `?url` を使うので、Worker も ESM で出す。
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    exclude: [...configDefaults.exclude, 'e2e/**', 'e2e-ocr/**'],
  },
})
