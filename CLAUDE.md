# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

ebook-maker is a fully client-side web app (React + TypeScript + Vite) that turns scanned page images into a single PDF or EPUB, with brightness/contrast adjustment, spread merging, and reordering. Nothing is uploaded to a server; page images and adjustment params persist in IndexedDB. UI text and code comments are in Japanese.

## Commands

```sh
npm run dev        # dev server
npm test           # Vitest (single run); `npx vitest run src/lib/foo.test.ts` for one file, `-t "name"` for one test
npm run typecheck  # tsc -b
npm run build      # tsc -b && vite build
npm run lint       # oxlint
npm run test:e2e   # Playwright (e2e/)
npm run test:ocr   # 実OCRモデルを使う重いテスト(e2e-ocr/)。要 npm run fetch-models、CIでは動かさない
```

`npm test` does not type-check (esbuild), so always run `npm run typecheck` / `npm run build` after changes. CI (PRs) runs `typecheck` and `test`.

## Architecture

- `src/hooks/useBook.ts` is the central state/logic hook: import, page selection, adjustments, reorder/delete, merge, undo-clear, metadata, export. `App.tsx` wires it to the step-based UI in `src/components/`.
- **Memory management is a core concern.** Decoded RGBA is huge (~15MB per A4 scan), so `useBook` keeps only a small LRU of raw images (`RAW_IMAGE_CACHE_LIMIT`) and downscaled previews/thumbnails (`previewSizes.ts`), re-decoding from the stored Blob on demand. Slider changes are debounced before being written to IndexedDB.
- `src/lib/imageStore.ts` wraps IndexedDB (original Blobs + page entries/adjustments); tests use `fake-indexeddb`.
- Image pipeline in `src/lib/`: `decodeImage` → `autoAdjust` (computes params) → `applyAdjustment` → `encodeImage`; `mergeSpread` and `resizeImage` are also here. Thumbnails/preview must use the same adjustment formula as export.
- **Export runs in a Web Worker** (`workers/exportWorker.ts`, launched via `lib/exportRunner.ts`). The core logic is in `workers/exportCore.ts` (`runExport`, dependency-injected encoder/decoder for testability). Pages are passed to the worker as original `Blob` + adjustment params (not decoded pixels) and decoded one at a time in the worker to bound memory. `pdfExport.ts` (pdf-lib) and `epubExport.ts` (JSZip, fixed-layout image EPUB) build the outputs.
- `src/lib/automationApi.ts` exposes `window.EbookMaker` (`describe()`, `getState()`, `importFiles`, `exportBook`, …) so browser-driving agents can operate the app without DOM interaction; `public/llms.txt` documents it. Keep it in sync when adding `useBook` operations.
- `src/lib/titleGuess.ts`: 推定文字サイズでOCR行を並べ替え、タイトル初期候補を推測する純関数。表紙のタイトル設定ステップ(`TitleStep`)から使う。
- **目次の作成**: `lib/toc/` に純関数(`parseToc` 目次OCR行→章候補、`detectTocPages` 目次ページの自動検出、`chapters` ページ追従・書き出し用変換・アウトライン木)。章は `pageId` で持ち、IndexedDBの `chapters` ストア(単一レコード)に保存(`useChapters`)。書き出しでは `useBook.exportBook` が書き出し順のページindexへ変換して Worker へ渡し、`pdfExport.ts` がしおり、`epubExport.ts` がnavを作る。階層は2階層まで。
- tsconfig is split: `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.worker.json`.
