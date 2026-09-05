# ebook-maker フェーズ1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully client-side web app that lets a user import scanned document images, auto/manually adjust brightness & contrast, optionally merge page pairs into spreads, reorder/delete pages, enter title/author metadata, and export the result as a single PDF or EPUB — with zero image data ever leaving the browser.

**Architecture:** React + TypeScript SPA (Vite). Page images and adjustment parameters live in IndexedDB (non-destructive: original blob kept, only params are edited). Preview rendering happens on the main thread via Canvas 2D. The final export (PDF via `pdf-lib`, EPUB via hand-built `JSZip` package) runs inside a Web Worker so large batches don't block the UI. Deployed as a static site to GitHub Pages.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + @testing-library/react + jsdom, `fake-indexeddb` (tests only), `pdf-lib`, `jszip`, Playwright (E2E).

## Global Constraints

- No network calls that transmit user image data — all processing client-side (spec: 概要).
- Target scale: up to ~200 pages per book (spec: 要件サマリ).
- Spread merge, reorder, delete, and title/author metadata entry are all required features (spec: 要件サマリ).
- Output formats: PDF and EPUB (fixed-layout, images embedded), user-selectable (spec: 要件サマリ).
- Adjustment model is non-destructive: original image blob is never overwritten, only adjustment parameters are stored (spec: データフロー §4).
- Only the export/build step runs off the main thread (Web Worker); preview/adjustment stays on the main thread using Canvas 2D (spec: 検討した処理方式 A案).

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/vite-env.d.ts`
- Create: `.gitignore`

**Interfaces:**
- Produces: a running Vite dev server (`npm run dev`), a `src/App.tsx` root component later tasks will extend, and `npm test` wired to Vitest.

- [ ] **Step 1: Scaffold with Vite's React-TS template**

Run:
```bash
npm create vite@latest . -- --template react-ts
```
Expected: files created (`package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts`, `.gitignore`, `src/App.css`, `src/index.css`, `public/`). Answer "yes" if prompted about a non-empty directory.

- [ ] **Step 2: Install base dependencies**

Run:
```bash
npm install
```
Expected: `node_modules/` created, `package-lock.json` written, exit code 0.

- [ ] **Step 3: Install test tooling**

Run:
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom fake-indexeddb
```
Expected: exit code 0, packages added to `devDependencies`.

- [ ] **Step 4: Add Vitest config and test script**

Edit `vite.config.ts` to:
```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
```

Create `src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

// jsdom does not implement URL.createObjectURL/revokeObjectURL — stub them
// so components that create download links (ExportPanel, Task 13) can be
// unit tested without a real Blob URL.
if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = () => 'blob:mock-url'
}
if (!window.URL.revokeObjectURL) {
  window.URL.revokeObjectURL = () => {}
}
```

Edit `package.json` `"scripts"` to add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Verify the app builds and the empty test runner works**

Run:
```bash
npm run build && npm test
```
Expected: build succeeds (`dist/` created); `npm test` reports "No test files found" (no tests exist yet — this is expected, not a failure) with exit code 0 or the "no tests" notice, not a config error.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite React-TS app with Vitest"
```

---

### Task 2: Shared types + ImageStore (IndexedDB wrapper)

**Files:**
- Create: `src/types.ts`
- Create: `src/lib/imageStore.ts`
- Test: `src/lib/imageStore.test.ts`

**Interfaces:**
- Produces:
  - `interface AdjustmentParams { brightness: number; contrast: number }`
  - `const DEFAULT_ADJUSTMENT: AdjustmentParams`
  - `interface PageEntry { id: string; order: number; blobId: string; width: number; height: number; adjustment: AdjustmentParams }`
  - `interface BookMetadata { title: string; author: string }`
  - `class ImageStore` with:
    - `static async open(dbName?: string): Promise<ImageStore>`
    - `async addPage(blob: Blob, width: number, height: number): Promise<PageEntry>`
    - `async listPages(): Promise<PageEntry[]>` (sorted ascending by `order`)
    - `async getBlob(blobId: string): Promise<Blob | undefined>`
    - `async updateAdjustment(id: string, adjustment: AdjustmentParams): Promise<void>`
    - `async reorderPages(orderedIds: string[]): Promise<void>`
    - `async deletePage(id: string): Promise<void>`
    - `async replacePagesWithMerged(removeIds: [string, string], blob: Blob, width: number, height: number): Promise<PageEntry>`
    - `close(): void`

- [ ] **Step 1: Write `src/types.ts`**

```ts
export interface AdjustmentParams {
  brightness: number // -100..100, 0 = no change
  contrast: number // -100..100, 0 = no change
}

export const DEFAULT_ADJUSTMENT: AdjustmentParams = { brightness: 0, contrast: 0 }

export interface PageEntry {
  id: string
  order: number
  blobId: string
  width: number
  height: number
  adjustment: AdjustmentParams
}

export interface BookMetadata {
  title: string
  author: string
}

// Structurally compatible with DOM ImageData ({data, width, height}), but
// defined locally so pure image-processing functions can be unit tested
// without a browser/canvas — jsdom does not implement ImageData (verified
// against jsdom 30: `new window.ImageData(...)` throws "not a constructor").
// A real `CanvasRenderingContext2D.getImageData()` result satisfies this
// interface as-is; no conversion needed at runtime.
export interface RawImage {
  data: Uint8ClampedArray
  width: number
  height: number
}
```

- [ ] **Step 2: Write the failing test for ImageStore**

```ts
// src/lib/imageStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { ImageStore } from './imageStore'

function blob(byte: number): Blob {
  return new Blob([new Uint8Array([byte])], { type: 'image/png' })
}

describe('ImageStore', () => {
  let store: ImageStore

  beforeEach(async () => {
    store = await ImageStore.open(`test-db-${Math.random()}`)
  })

  it('adds pages with increasing order and lists them sorted', async () => {
    const p1 = await store.addPage(blob(1), 10, 20)
    const p2 = await store.addPage(blob(2), 10, 20)
    expect(p2.order).toBeGreaterThan(p1.order)
    const pages = await store.listPages()
    expect(pages.map((p) => p.id)).toEqual([p1.id, p2.id])
  })

  it('stores and retrieves the original blob unchanged', async () => {
    const page = await store.addPage(blob(42), 5, 5)
    const stored = await store.getBlob(page.blobId)
    const bytes = new Uint8Array(await stored!.arrayBuffer())
    expect(Array.from(bytes)).toEqual([42])
  })

  it('updates adjustment params without touching the blob', async () => {
    const page = await store.addPage(blob(1), 5, 5)
    await store.updateAdjustment(page.id, { brightness: 10, contrast: -5 })
    const [updated] = await store.listPages()
    expect(updated.adjustment).toEqual({ brightness: 10, contrast: -5 })
    const stored = await store.getBlob(page.blobId)
    expect(stored).toBeDefined()
  })

  it('reorders pages', async () => {
    const p1 = await store.addPage(blob(1), 5, 5)
    const p2 = await store.addPage(blob(2), 5, 5)
    await store.reorderPages([p2.id, p1.id])
    const pages = await store.listPages()
    expect(pages.map((p) => p.id)).toEqual([p2.id, p1.id])
  })

  it('deletes a page and its blob', async () => {
    const page = await store.addPage(blob(1), 5, 5)
    await store.deletePage(page.id)
    expect(await store.listPages()).toEqual([])
    expect(await store.getBlob(page.blobId)).toBeUndefined()
  })

  it('replaces two pages with one merged page at the first page position', async () => {
    const p1 = await store.addPage(blob(1), 5, 5)
    const p2 = await store.addPage(blob(2), 5, 5)
    const p3 = await store.addPage(blob(3), 5, 5)
    const merged = await store.replacePagesWithMerged([p1.id, p2.id], blob(99), 10, 5)
    const pages = await store.listPages()
    expect(pages.map((p) => p.id)).toEqual([merged.id, p3.id])
    expect(pages[0].width).toBe(10)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- imageStore`
Expected: FAIL — `Cannot find module './imageStore'` (module does not exist yet).

- [ ] **Step 4: Implement `src/lib/imageStore.ts`**

```ts
import type { AdjustmentParams, PageEntry } from '../types'
import { DEFAULT_ADJUSTMENT } from '../types'

const BLOB_STORE = 'blobs'
const PAGE_STORE = 'pages'

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE)
      }
      if (!db.objectStoreNames.contains(PAGE_STORE)) {
        db.createObjectStore(PAGE_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`
}

export class ImageStore {
  private constructor(private db: IDBDatabase) {}

  static async open(dbName = 'ebook-maker'): Promise<ImageStore> {
    const db = await openDb(dbName)
    return new ImageStore(db)
  }

  close(): void {
    this.db.close()
  }

  async addPage(blob: Blob, width: number, height: number): Promise<PageEntry> {
    const pages = await this.listPages()
    const maxOrder = pages.reduce((max, p) => Math.max(max, p.order), -1)
    const page: PageEntry = {
      id: nextId(),
      order: maxOrder + 1,
      blobId: nextId(),
      width,
      height,
      adjustment: { ...DEFAULT_ADJUSTMENT },
    }
    const tx = this.db.transaction([BLOB_STORE, PAGE_STORE], 'readwrite')
    tx.objectStore(BLOB_STORE).put(blob, page.blobId)
    tx.objectStore(PAGE_STORE).put(page)
    await txDone(tx)
    return page
  }

  async listPages(): Promise<PageEntry[]> {
    const tx = this.db.transaction(PAGE_STORE, 'readonly')
    const all = await reqToPromise(tx.objectStore(PAGE_STORE).getAll())
    return (all as PageEntry[]).slice().sort((a, b) => a.order - b.order)
  }

  async getBlob(blobId: string): Promise<Blob | undefined> {
    const tx = this.db.transaction(BLOB_STORE, 'readonly')
    return reqToPromise(tx.objectStore(BLOB_STORE).get(blobId)) as Promise<Blob | undefined>
  }

  async updateAdjustment(id: string, adjustment: AdjustmentParams): Promise<void> {
    const tx = this.db.transaction(PAGE_STORE, 'readwrite')
    const store = tx.objectStore(PAGE_STORE)
    const page = (await reqToPromise(store.get(id))) as PageEntry | undefined
    if (!page) throw new Error(`page not found: ${id}`)
    store.put({ ...page, adjustment })
    await txDone(tx)
  }

  async reorderPages(orderedIds: string[]): Promise<void> {
    const tx = this.db.transaction(PAGE_STORE, 'readwrite')
    const store = tx.objectStore(PAGE_STORE)
    for (let i = 0; i < orderedIds.length; i += 1) {
      const page = (await reqToPromise(store.get(orderedIds[i]))) as PageEntry | undefined
      if (!page) throw new Error(`page not found: ${orderedIds[i]}`)
      store.put({ ...page, order: i })
    }
    await txDone(tx)
  }

  async deletePage(id: string): Promise<void> {
    const tx = this.db.transaction([BLOB_STORE, PAGE_STORE], 'readwrite')
    const pageStore = tx.objectStore(PAGE_STORE)
    const page = (await reqToPromise(pageStore.get(id))) as PageEntry | undefined
    if (!page) throw new Error(`page not found: ${id}`)
    pageStore.delete(id)
    tx.objectStore(BLOB_STORE).delete(page.blobId)
    await txDone(tx)
  }

  async replacePagesWithMerged(
    removeIds: [string, string],
    blob: Blob,
    width: number,
    height: number,
  ): Promise<PageEntry> {
    const pages = await this.listPages()
    const [firstId, secondId] = removeIds
    const firstIndex = pages.findIndex((p) => p.id === firstId)
    if (firstIndex === -1) throw new Error(`page not found: ${firstId}`)
    const removed = new Set(removeIds)
    const merged: PageEntry = {
      id: nextId(),
      order: pages[firstIndex].order,
      blobId: nextId(),
      width,
      height,
      adjustment: { ...DEFAULT_ADJUSTMENT },
    }
    const remaining = pages.filter((p) => !removed.has(p.id))
    const insertAt = remaining.filter((p) => p.order < pages[firstIndex].order).length
    remaining.splice(insertAt, 0, merged)
    const tx = this.db.transaction([BLOB_STORE, PAGE_STORE], 'readwrite')
    const blobStore = tx.objectStore(BLOB_STORE)
    const pageStore = tx.objectStore(PAGE_STORE)
    for (const id of removeIds) {
      const p = pages.find((page) => page.id === id)!
      pageStore.delete(id)
      blobStore.delete(p.blobId)
    }
    blobStore.put(blob, merged.blobId)
    remaining.forEach((p, i) => pageStore.put({ ...p, order: i }))
    await txDone(tx)
    return merged
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- imageStore`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/lib/imageStore.ts src/lib/imageStore.test.ts
git commit -m "feat: add PageEntry/AdjustmentParams types and IndexedDB-backed ImageStore"
```

---

### Task 3: `applyAdjustment` — brightness/contrast pixel transform

**Files:**
- Create: `src/lib/applyAdjustment.ts`
- Test: `src/lib/applyAdjustment.test.ts`

**Interfaces:**
- Consumes: `AdjustmentParams`, `RawImage` from `../types` (Task 2).
- Produces: `function applyAdjustment(image: RawImage, params: AdjustmentParams): RawImage` — used by `AdjustmentEditor` preview (Task 11) and `ExportWorker` (Task 8).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/applyAdjustment.test.ts
import { describe, it, expect } from 'vitest'
import { applyAdjustment } from './applyAdjustment'
import type { RawImage } from '../types'

function gray(value: number, w = 1, h = 1): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = value
    data[i * 4 + 1] = value
    data[i * 4 + 2] = value
    data[i * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}

describe('applyAdjustment', () => {
  it('leaves the image unchanged when brightness=0, contrast=0', () => {
    const out = applyAdjustment(gray(100), { brightness: 0, contrast: 0 })
    expect(Array.from(out.data)).toEqual([100, 100, 100, 255])
  })

  it('adds brightness as a flat offset', () => {
    const out = applyAdjustment(gray(100), { brightness: 20, contrast: 0 })
    expect(out.data[0]).toBe(120)
  })

  it('applies contrast around the midpoint (128)', () => {
    // contrast=100 => factor 2: (200-128)*2+128 = 272 -> clamped to 255
    const out = applyAdjustment(gray(200), { brightness: 0, contrast: 100 })
    expect(out.data[0]).toBe(255)
    // contrast=-100 => factor 0: any value collapses to 128
    const out2 = applyAdjustment(gray(200), { brightness: 0, contrast: -100 })
    expect(out2.data[0]).toBe(128)
  })

  it('clamps output to the 0..255 range', () => {
    const out = applyAdjustment(gray(10), { brightness: -50, contrast: 0 })
    expect(out.data[0]).toBe(0)
  })

  it('preserves alpha and does not mutate the input', () => {
    const input = gray(50)
    const inputCopy = new Uint8ClampedArray(input.data)
    const out = applyAdjustment(input, { brightness: 10, contrast: 10 })
    expect(out.data[3]).toBe(255)
    expect(Array.from(input.data)).toEqual(Array.from(inputCopy))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- applyAdjustment`
Expected: FAIL — `Cannot find module './applyAdjustment'`.

- [ ] **Step 3: Implement `src/lib/applyAdjustment.ts`**

```ts
import type { AdjustmentParams, RawImage } from '../types'

export function applyAdjustment(image: RawImage, params: AdjustmentParams): RawImage {
  const factor = (100 + params.contrast) / 100
  const src = image.data
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < src.length; i += 4) {
    out[i] = (src[i] - 128) * factor + 128 + params.brightness
    out[i + 1] = (src[i + 1] - 128) * factor + 128 + params.brightness
    out[i + 2] = (src[i + 2] - 128) * factor + 128 + params.brightness
    out[i + 3] = src[i + 3]
  }
  return { data: out, width: image.width, height: image.height }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- applyAdjustment`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/applyAdjustment.ts src/lib/applyAdjustment.test.ts
git commit -m "feat: add applyAdjustment brightness/contrast transform"
```

---

### Task 4: `computeAutoAdjustment` — histogram-based auto correction

**Files:**
- Create: `src/lib/autoAdjust.ts`
- Test: `src/lib/autoAdjust.test.ts`

**Interfaces:**
- Consumes: `RawImage`, `AdjustmentParams` from `../types` (Task 2).
- Produces: `function computeAutoAdjustment(image: RawImage): AdjustmentParams` — called by `AdjustmentEditor` (Task 11) to pre-fill slider values on page load.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/autoAdjust.test.ts
import { describe, it, expect } from 'vitest'
import { computeAutoAdjustment } from './autoAdjust'
import type { RawImage } from '../types'

function image(values: number[]): RawImage {
  const data = new Uint8ClampedArray(values.length * 4)
  values.forEach((v, i) => {
    data[i * 4] = v
    data[i * 4 + 1] = v
    data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  })
  return { data, width: values.length, height: 1 }
}

describe('computeAutoAdjustment', () => {
  it('returns near-zero adjustment for an already-flat 0..255 image', () => {
    const values = Array.from({ length: 101 }, (_, i) => Math.round((i / 100) * 255))
    const result = computeAutoAdjustment(image(values))
    expect(Math.abs(result.brightness)).toBeLessThan(5)
    expect(Math.abs(result.contrast)).toBeLessThan(5)
  })

  it('boosts contrast for a low-contrast (narrow range) scan', () => {
    // all values packed into 100..150 — a washed-out scan
    const values = Array.from({ length: 51 }, (_, i) => 100 + i)
    const result = computeAutoAdjustment(image(values))
    expect(result.contrast).toBeGreaterThan(0)
  })

  it('shifts brightness for a dark image toward mid-gray', () => {
    const values = Array.from({ length: 51 }, () => 40)
    const result = computeAutoAdjustment(image(values))
    expect(result.brightness).toBeGreaterThan(0)
  })

  it('clamps returned params to -100..100', () => {
    const values = Array.from({ length: 10 }, () => 0)
    const result = computeAutoAdjustment(image(values))
    expect(result.brightness).toBeLessThanOrEqual(100)
    expect(result.brightness).toBeGreaterThanOrEqual(-100)
    expect(result.contrast).toBeLessThanOrEqual(100)
    expect(result.contrast).toBeGreaterThanOrEqual(-100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- autoAdjust`
Expected: FAIL — `Cannot find module './autoAdjust'`.

- [ ] **Step 3: Implement `src/lib/autoAdjust.ts`**

```ts
import type { AdjustmentParams, RawImage } from '../types'

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

export function computeAutoAdjustment(image: RawImage): AdjustmentParams {
  const src = image.data
  const pixelCount = src.length / 4
  const values = new Uint8ClampedArray(pixelCount)
  for (let i = 0; i < pixelCount; i += 1) {
    values[i] = luminance(src[i * 4], src[i * 4 + 1], src[i * 4 + 2])
  }
  const sorted = Array.from(values).sort((a, b) => a - b)
  const lo = sorted[Math.floor(sorted.length * 0.01)]
  const hi = sorted[Math.ceil(sorted.length * 0.99) - 1]
  const range = Math.max(hi - lo, 1)
  const factor = clamp(255 / range, 0.1, 4)
  const mid = (lo + hi) / 2
  const contrast = clamp(factor * 100 - 100, -100, 100)
  const brightness = clamp(-(mid - 128) * factor, -100, 100)
  return { brightness: Math.round(brightness), contrast: Math.round(contrast) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- autoAdjust`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/autoAdjust.ts src/lib/autoAdjust.test.ts
git commit -m "feat: add histogram-based computeAutoAdjustment"
```

---

### Task 5: `mergeSpread` — combine two page images side by side

**Files:**
- Create: `src/lib/mergeSpread.ts`
- Test: `src/lib/mergeSpread.test.ts`

**Interfaces:**
- Consumes: `RawImage` from `../types` (Task 2).
- Produces: `function mergeSpread(left: RawImage, right: RawImage): RawImage` — called by `PageList`'s spread-merge action (Task 10) and, at export time, by `ExportWorker` (Task 8) if a merge wasn't already materialized into `ImageStore`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/mergeSpread.test.ts
import { describe, it, expect } from 'vitest'
import { mergeSpread } from './mergeSpread'
import type { RawImage } from '../types'

function solid(w: number, h: number, r: number, g: number, b: number): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}

function pixelAt(img: RawImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}

describe('mergeSpread', () => {
  it('places left image at the left half and right image at the right half', () => {
    const left = solid(2, 2, 255, 0, 0)
    const right = solid(2, 2, 0, 255, 0)
    const merged = mergeSpread(left, right)
    expect(merged.width).toBe(4)
    expect(merged.height).toBe(2)
    expect(pixelAt(merged, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixelAt(merged, 3, 0)).toEqual([0, 255, 0, 255])
  })

  it('uses the taller image height and pads the shorter one with white', () => {
    const left = solid(2, 4, 10, 10, 10)
    const right = solid(2, 2, 20, 20, 20)
    const merged = mergeSpread(left, right)
    expect(merged.height).toBe(4)
    expect(pixelAt(merged, 3, 3)).toEqual([255, 255, 255, 255])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- mergeSpread`
Expected: FAIL — `Cannot find module './mergeSpread'`.

- [ ] **Step 3: Implement `src/lib/mergeSpread.ts`**

```ts
import type { RawImage } from '../types'

export function mergeSpread(left: RawImage, right: RawImage): RawImage {
  const width = left.width + right.width
  const height = Math.max(left.height, right.height)
  const data = new Uint8ClampedArray(width * height * 4).fill(255)

  const blit = (src: RawImage, xOffset: number) => {
    for (let y = 0; y < src.height; y += 1) {
      for (let x = 0; x < src.width; x += 1) {
        const srcI = (y * src.width + x) * 4
        const dstI = (y * width + (x + xOffset)) * 4
        data[dstI] = src.data[srcI]
        data[dstI + 1] = src.data[srcI + 1]
        data[dstI + 2] = src.data[srcI + 2]
        data[dstI + 3] = src.data[srcI + 3]
      }
    }
  }

  blit(left, 0)
  blit(right, left.width)

  return { data, width, height }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- mergeSpread`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mergeSpread.ts src/lib/mergeSpread.test.ts
git commit -m "feat: add mergeSpread side-by-side image combiner"
```

---

### Task 6: `buildPdf` — PDF assembly with `pdf-lib`

**Files:**
- Create: `src/lib/pdfExport.ts`
- Test: `src/lib/pdfExport.test.ts`

**Interfaces:**
- Consumes: `BookMetadata` from `../types` (Task 2).
- Produces:
  - `interface ExportPage { png: Uint8Array; width: number; height: number }`
  - `async function buildPdf(pages: ExportPage[], metadata: BookMetadata): Promise<Uint8Array>`
  - Both are consumed by `ExportWorker` (Task 8), which supplies already-PNG-encoded pages (encoding happens in the worker via `OffscreenCanvas.convertToBlob`, not here — keeping this function canvas-free and unit-testable in Node/jsdom).

- [ ] **Step 1: Install `pdf-lib`**

Run: `npm install pdf-lib`
Expected: exit code 0, added to `dependencies`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/pdfExport.test.ts
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildPdf } from './pdfExport'

// A hand-built valid 2x1 PNG (red pixel, green pixel), generated and
// verified against pdf-lib's embedPng at plan-authoring time.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII='

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

describe('buildPdf', () => {
  it('builds a PDF with one page per input image and embeds metadata', async () => {
    const png = decodeBase64(TINY_PNG_BASE64)
    const pages = [
      { png, width: 2, height: 1 },
      { png, width: 2, height: 1 },
    ]
    const bytes = await buildPdf(pages, { title: 'My Book', author: 'Someone' })
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')

    const loaded = await PDFDocument.load(bytes)
    expect(loaded.getPageCount()).toBe(2)
    expect(loaded.getTitle()).toBe('My Book')
    expect(loaded.getAuthor()).toBe('Someone')
    const [page1] = loaded.getPages()
    expect(page1.getWidth()).toBe(2)
    expect(page1.getHeight()).toBe(1)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- pdfExport`
Expected: FAIL — `Cannot find module './pdfExport'`.

- [ ] **Step 4: Implement `src/lib/pdfExport.ts`**

```ts
import { PDFDocument } from 'pdf-lib'
import type { BookMetadata } from '../types'

export interface ExportPage {
  png: Uint8Array
  width: number
  height: number
}

export async function buildPdf(pages: ExportPage[], metadata: BookMetadata): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  if (metadata.title) doc.setTitle(metadata.title)
  if (metadata.author) doc.setAuthor(metadata.author)

  for (const page of pages) {
    const image = await doc.embedPng(page.png)
    const pdfPage = doc.addPage([page.width, page.height])
    pdfPage.drawImage(image, { x: 0, y: 0, width: page.width, height: page.height })
  }

  return doc.save()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- pdfExport`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/pdfExport.ts src/lib/pdfExport.test.ts
git commit -m "feat: add buildPdf PDF assembly via pdf-lib"
```

---

### Task 7: `buildEpub` — fixed-layout EPUB3 assembly with `jszip`

**Files:**
- Create: `src/lib/epubExport.ts`
- Test: `src/lib/epubExport.test.ts`

**Interfaces:**
- Consumes: `ExportPage` from `./pdfExport` (Task 6), `BookMetadata` from `../types` (Task 2).
- Produces: `async function buildEpub(pages: ExportPage[], metadata: BookMetadata): Promise<Uint8Array>` — consumed by `ExportWorker` (Task 8).

- [ ] **Step 1: Install `jszip`**

Run: `npm install jszip`
Expected: exit code 0, added to `dependencies`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/epubExport.test.ts
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildEpub } from './epubExport'

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII='

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

describe('buildEpub', () => {
  it('produces a valid EPUB3 package with one xhtml+image pair per page', async () => {
    const png = decodeBase64(TINY_PNG_BASE64)
    const pages = [
      { png, width: 2, height: 1 },
      { png, width: 2, height: 1 },
    ]
    const bytes = await buildEpub(pages, { title: 'My Book', author: 'Someone' })
    const zip = await JSZip.loadAsync(bytes)

    const mimetype = await zip.file('mimetype')!.async('string')
    expect(mimetype).toBe('application/epub+zip')

    expect(await zip.file('META-INF/container.xml')!.async('string')).toContain(
      'OEBPS/content.opf',
    )

    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<dc:title>My Book</dc:title>')
    expect(opf).toContain('<dc:creator>Someone</dc:creator>')
    expect(opf).toContain('rendition:layout')
    expect(opf).toContain('pre-paginated')

    expect(zip.file('OEBPS/images/page-1.png')).not.toBeNull()
    expect(zip.file('OEBPS/images/page-2.png')).not.toBeNull()
    expect(zip.file('OEBPS/text/page-1.xhtml')).not.toBeNull()
    expect(zip.file('OEBPS/text/page-2.xhtml')).not.toBeNull()

    const page1Xhtml = await zip.file('OEBPS/text/page-1.xhtml')!.async('string')
    expect(page1Xhtml).toContain('width="2"')
    expect(page1Xhtml).toContain('height="1"')

    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav).toContain('epub:type="toc"')
  })

  it('escapes XML-unsafe characters in metadata', async () => {
    const png = decodeBase64(TINY_PNG_BASE64)
    const bytes = await buildEpub([{ png, width: 2, height: 1 }], {
      title: 'A & B <Title>',
      author: 'X',
    })
    const zip = await JSZip.loadAsync(bytes)
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('A &amp; B &lt;Title&gt;')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- epubExport`
Expected: FAIL — `Cannot find module './epubExport'`.

- [ ] **Step 4: Implement `src/lib/epubExport.ts`**

```ts
import JSZip from 'jszip'
import type { BookMetadata } from '../types'
import type { ExportPage } from './pdfExport'

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function pseudoUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function pageXhtml(n: number, width: number, height: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Page ${n}</title>
  <meta name="viewport" content="width=${width}, height=${height}"/>
</head>
<body style="margin:0;padding:0">
  <img src="../images/page-${n}.png" width="${width}" height="${height}" alt="page ${n}"/>
</body>
</html>
`
}

function navXhtml(pageCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Navigation</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="text/page-1.xhtml">Start</a></li>
    </ol>
  </nav>
</body>
</html>
`
}

export async function buildEpub(pages: ExportPage[], metadata: BookMetadata): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.folder('META-INF')!.file('container.xml', CONTAINER_XML)

  const oebps = zip.folder('OEBPS')!
  const images = oebps.folder('images')!
  const text = oebps.folder('text')!

  const manifestItems: string[] = []
  const spineItems: string[] = []

  pages.forEach((page, index) => {
    const n = index + 1
    images.file(`page-${n}.png`, page.png)
    text.file(`page-${n}.xhtml`, pageXhtml(n, page.width, page.height))
    manifestItems.push(
      `<item id="img${n}" href="images/page-${n}.png" media-type="image/png"/>`,
    )
    manifestItems.push(
      `<item id="page${n}" href="text/page-${n}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    spineItems.push(`<itemref idref="page${n}"/>`)
  })

  oebps.file('nav.xhtml', navXhtml(pages.length))

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${pseudoUuid()}</dc:identifier>
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    <dc:creator>${escapeXml(metadata.author)}</dc:creator>
    <dc:language>ja</dc:language>
    <meta property="rendition:layout">pre-paginated</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>
`
  oebps.file('content.opf', opf)

  return zip.generateAsync({ type: 'uint8array' })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- epubExport`
Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/epubExport.ts src/lib/epubExport.test.ts
git commit -m "feat: add buildEpub fixed-layout EPUB3 assembly via jszip"
```

---

### Task 8: Export worker — `exportCore` (testable handler logic) + `exportWorker` (thin real entry)

**Design note:** `OffscreenCanvas` is not available in Node/jsdom, so the message-handling logic is split from PNG encoding. `runExport` (in `exportCore.ts`) takes the PNG encoder as an injected dependency and is fully unit-testable with a fixture encoder. `exportWorker.ts` is a thin `self.onmessage` wrapper that supplies the real `OffscreenCanvas`-based encoder — it has no branching logic of its own, so it is not separately unit tested (per spec §テスト方針: "ExportWorkerのメッセージハンドラを直接呼び出し" — `runExport` *is* that handler).

**Files:**
- Create: `src/workers/exportCore.ts`
- Create: `src/workers/exportWorker.ts`
- Test: `src/workers/exportCore.test.ts`

**Interfaces:**
- Consumes: `applyAdjustment` (Task 3), `buildPdf`/`ExportPage` (Task 6), `buildEpub` (Task 7), `RawImage`/`AdjustmentParams`/`BookMetadata` (Task 2).
- Produces:
  - `interface ExportRequestPage { image: RawImage; adjustment: AdjustmentParams }`
  - `interface ExportRequest { format: 'pdf' | 'epub'; metadata: BookMetadata; pages: ExportRequestPage[] }`
  - `type PngEncoder = (image: RawImage) => Promise<Uint8Array>`
  - `async function runExport(request: ExportRequest, encodePng: PngEncoder): Promise<Uint8Array>`
  - The worker posts `{ ok: true, bytes: Uint8Array }` or `{ ok: false, error: string }` — consumed by `ExportPanel` (Task 13).

- [ ] **Step 1: Write the failing test**

```ts
// src/workers/exportCore.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runExport } from './exportCore'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import type { RawImage } from '../types'

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII='

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function rawImage(w: number, h: number): RawImage {
  return { data: new Uint8ClampedArray(w * h * 4).fill(128), width: w, height: h }
}

describe('runExport', () => {
  const fixturePng = decodeBase64(TINY_PNG_BASE64)
  const fakeEncode = vi.fn(async (_image: RawImage) => fixturePng)

  it('applies adjustment to every page, encodes it, then builds a PDF', async () => {
    const bytes = await runExport(
      {
        format: 'pdf',
        metadata: { title: 'T', author: 'A' },
        pages: [
          { image: rawImage(2, 1), adjustment: { brightness: 0, contrast: 0 } },
          { image: rawImage(2, 1), adjustment: { brightness: 10, contrast: 10 } },
        ],
      },
      fakeEncode,
    )
    expect(fakeEncode).toHaveBeenCalledTimes(2)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getTitle()).toBe('T')
  })

  it('builds an EPUB when format is epub', async () => {
    const bytes = await runExport(
      {
        format: 'epub',
        metadata: { title: 'T2', author: 'A2' },
        pages: [{ image: rawImage(2, 1), adjustment: { brightness: 0, contrast: 0 } }],
      },
      fakeEncode,
    )
    const zip = await JSZip.loadAsync(bytes)
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- exportCore`
Expected: FAIL — `Cannot find module './exportCore'`.

- [ ] **Step 3: Implement `src/workers/exportCore.ts`**

```ts
import { applyAdjustment } from '../lib/applyAdjustment'
import { buildPdf, type ExportPage } from '../lib/pdfExport'
import { buildEpub } from '../lib/epubExport'
import type { AdjustmentParams, BookMetadata, RawImage } from '../types'

export interface ExportRequestPage {
  image: RawImage
  adjustment: AdjustmentParams
}

export interface ExportRequest {
  format: 'pdf' | 'epub'
  metadata: BookMetadata
  pages: ExportRequestPage[]
}

export type PngEncoder = (image: RawImage) => Promise<Uint8Array>

export async function runExport(
  request: ExportRequest,
  encodePng: PngEncoder,
): Promise<Uint8Array> {
  const exportPages: ExportPage[] = []
  for (const page of request.pages) {
    const adjusted = applyAdjustment(page.image, page.adjustment)
    const png = await encodePng(adjusted)
    exportPages.push({ png, width: adjusted.width, height: adjusted.height })
  }
  return request.format === 'pdf'
    ? buildPdf(exportPages, request.metadata)
    : buildEpub(exportPages, request.metadata)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- exportCore`
Expected: PASS — both tests green.

- [ ] **Step 5: Write the thin real worker entry `src/workers/exportWorker.ts`**

```ts
/// <reference lib="webworker" />
import { runExport } from './exportCore'
import type { ExportRequest } from './exportCore'
import type { RawImage } from '../types'

function encodePngViaCanvas(image: RawImage): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('OffscreenCanvas 2D context unavailable'))
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0)
  return canvas.convertToBlob({ type: 'image/png' }).then(async (blob) => {
    return new Uint8Array(await blob.arrayBuffer())
  })
}

self.onmessage = async (event: MessageEvent<ExportRequest>) => {
  try {
    const bytes = await runExport(event.data, encodePngViaCanvas)
    ;(self as unknown as Worker).postMessage({ ok: true, bytes }, [bytes.buffer])
  } catch (error) {
    ;(self as unknown as Worker).postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
```

This file has no test (see design note above — it is a direct, untestable-without-a-browser wrapper around the already-tested `runExport`).

- [ ] **Step 6: Exclude the worker entry file from `tsc` type-checking**

`exportWorker.ts`'s `/// <reference lib="webworker" />` declares a `self` global that conflicts with the `dom` lib's `self` (used by every other file, e.g. `document` in `decodeImage.ts`) when both are type-checked in the same `tsc` project — `npm run build` (which runs `tsc -b`) would fail with a duplicate-global-declaration error. Vite's dev server and production bundling (esbuild) don't type-check, so excluding this one file from `tsc` only turns off IDE/build type-checking for it; it still runs correctly.

Edit `tsconfig.app.json`, adding an `"exclude"` array alongside its existing `"include"`:
```json
{
  "include": ["src"],
  "exclude": ["src/workers/exportWorker.ts"]
}
```
(Merge this into whatever `tsconfig.app.json` already has — do not remove its existing `compilerOptions`.)

- [ ] **Step 7: Run the full test suite and the build to confirm nothing broke**

Run: `npm test && npm run build`
Expected: all suites PASS; build succeeds (the `tsc -b` step no longer tries to check `exportWorker.ts`).

- [ ] **Step 8: Commit**

```bash
git add src/workers/exportCore.ts src/workers/exportCore.test.ts src/workers/exportWorker.ts tsconfig.app.json
git commit -m "feat: add export worker (runExport core + OffscreenCanvas entry point)"
```

---

### Task 9: `decodeBlobToRawImage` helper + `ImportPanel` component

**Design note:** `decodeBlobToRawImage` needs `createImageBitmap` and a real `<canvas>` 2D context, neither available in jsdom. Like `exportWorker.ts` (Task 8), it is a thin browser-only IO wrapper with no branching logic, so it is exercised by the E2E test (Task 15) rather than a unit test. `ImportPanel` itself contains the testable logic (filtering non-image files) and is unit tested with React Testing Library.

**Files:**
- Create: `src/lib/decodeImage.ts`
- Create: `src/components/ImportPanel.tsx`
- Test: `src/components/ImportPanel.test.tsx`

**Interfaces:**
- Consumes: `RawImage` from `../types` (Task 2).
- Produces:
  - `async function decodeBlobToRawImage(blob: Blob): Promise<RawImage>` — used by `App` (Task 14) right after `ImageStore.addPage` to get `width`/`height`, and by `AdjustmentEditor` (Task 11) to get pixels for preview.
  - `function ImportPanel(props: { onImport: (files: File[]) => void }): JSX.Element` — used by `App` (Task 14).

- [ ] **Step 1: Write `src/lib/decodeImage.ts` (no unit test — see design note)**

```ts
import type { RawImage } from '../types'

export async function decodeBlobToRawImage(blob: Blob): Promise<RawImage> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  return { data: imageData.data, width: imageData.width, height: imageData.height }
}
```

- [ ] **Step 2: Write the failing test for `ImportPanel`**

```tsx
// src/components/ImportPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImportPanel } from './ImportPanel'

function makeImageFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

describe('ImportPanel', () => {
  it('calls onImport with dropped image files, ignoring non-image files', () => {
    const onImport = vi.fn()
    render(<ImportPanel onImport={onImport} />)
    const dropzone = screen.getByTestId('import-dropzone')
    const imageFile = makeImageFile('a.png')
    const textFile = new File(['x'], 'a.txt', { type: 'text/plain' })
    fireEvent.drop(dropzone, { dataTransfer: { files: [imageFile, textFile] } })
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onImport).toHaveBeenCalledWith([imageFile])
  })

  it('calls onImport with files chosen via the file picker input', () => {
    const onImport = vi.fn()
    render(<ImportPanel onImport={onImport} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    const imageFile = makeImageFile('b.png')
    fireEvent.change(input, { target: { files: [imageFile] } })
    expect(onImport).toHaveBeenCalledWith([imageFile])
  })

  it('calls onImport with files chosen via the folder picker input', () => {
    const onImport = vi.fn()
    render(<ImportPanel onImport={onImport} />)
    const input = screen.getByTestId('folder-input') as HTMLInputElement
    const imageFile = makeImageFile('c.png')
    fireEvent.change(input, { target: { files: [imageFile] } })
    expect(onImport).toHaveBeenCalledWith([imageFile])
  })

  it('does not call onImport when no image files are present', () => {
    const onImport = vi.fn()
    render(<ImportPanel onImport={onImport} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } })
    expect(onImport).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- ImportPanel`
Expected: FAIL — `Cannot find module './ImportPanel'`.

- [ ] **Step 4: Implement `src/components/ImportPanel.tsx`**

```tsx
import { useRef } from 'react'

interface ImportPanelProps {
  onImport: (files: File[]) => void
}

function filterImageFiles(fileList: FileList | null): File[] {
  if (!fileList) return []
  return Array.from(fileList).filter((file) => file.type.startsWith('image/'))
}

export function ImportPanel({ onImport }: ImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  function handleFileList(fileList: FileList | null) {
    const files = filterImageFiles(fileList)
    if (files.length > 0) onImport(files)
  }

  return (
    <div
      data-testid="import-dropzone"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        handleFileList(event.dataTransfer.files)
      }}
    >
      <p>画像をドラッグ&ドロップ、またはファイル/フォルダを選択</p>
      <button type="button" onClick={() => fileInputRef.current?.click()}>
        ファイルを選択
      </button>
      <button type="button" onClick={() => folderInputRef.current?.click()}>
        フォルダを選択
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="file-input"
        onChange={(event) => handleFileList(event.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        data-testid="folder-input"
        {...({ webkitdirectory: '' } as Record<string, string>)}
        onChange={(event) => handleFileList(event.target.files)}
      />
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- ImportPanel`
Expected: PASS — all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/decodeImage.ts src/components/ImportPanel.tsx src/components/ImportPanel.test.tsx
git commit -m "feat: add ImportPanel (file/folder/drag-drop) and decodeBlobToRawImage"
```

---

### Task 10: `PageList` component (reorder, delete, spread-merge selection with preview)

**Design note:** The merge preview shown here is a side-by-side layout of the two pages' existing thumbnails (data the component already has) rather than a fresh `mergeSpread` pixel render — this keeps `PageList` free of `RawImage`/canvas decoding concerns, which stay in `App` (Task 14). The actual pixel merge (`mergeSpread`, Task 5) runs in `App` only after the user confirms.

**Files:**
- Create: `src/components/PageList.tsx`
- Test: `src/components/PageList.test.tsx`

**Interfaces:**
- Consumes: `PageEntry` from `../types` (Task 2).
- Produces:
```ts
interface PageListProps {
  pages: PageEntry[]
  thumbnails: Record<string, string> // pageId -> object URL
  selectedPageId: string | null
  onSelect: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  onDelete: (id: string) => void
  onConfirmMerge: (firstId: string, secondId: string) => void
}
function PageList(props: PageListProps): JSX.Element
```
  Used by `App` (Task 14).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/PageList.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PageList } from './PageList'
import type { PageEntry } from '../types'

function page(id: string, order: number): PageEntry {
  return { id, order, blobId: `blob-${id}`, width: 10, height: 10, adjustment: { brightness: 0, contrast: 0 } }
}

const pages = [page('a', 0), page('b', 1), page('c', 2)]
const thumbnails = { a: 'blob:a', b: 'blob:b', c: 'blob:c' }

function baseProps() {
  return {
    pages,
    thumbnails,
    selectedPageId: null as string | null,
    onSelect: vi.fn(),
    onReorder: vi.fn(),
    onDelete: vi.fn(),
    onConfirmMerge: vi.fn(),
  }
}

describe('PageList', () => {
  it('renders one item per page in order', () => {
    render(<PageList {...baseProps()} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
  })

  it('calls onSelect with the page id when a thumbnail is clicked', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    fireEvent.click(screen.getByAltText('page 2'))
    expect(props.onSelect).toHaveBeenCalledWith('b')
  })

  it('calls onDelete with the page id when its delete button is clicked', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    fireEvent.click(screen.getByTestId('delete-a'))
    expect(props.onDelete).toHaveBeenCalledWith('a')
  })

  it('reorders via drag and drop and calls onReorder with the new id order', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    const dragged = screen.getByTestId('page-item-a')
    const target = screen.getByTestId('page-item-c')
    fireEvent.dragStart(dragged)
    fireEvent.dragOver(target)
    fireEvent.drop(target)
    expect(props.onReorder).toHaveBeenCalledWith(['b', 'c', 'a'])
  })

  it('enters merge mode, previews the two selected pages, and confirms the merge', () => {
    const props = baseProps()
    render(<PageList {...props} />)
    fireEvent.click(screen.getByText('見開き結合'))
    fireEvent.click(screen.getByTestId('merge-checkbox-a'))
    fireEvent.click(screen.getByTestId('merge-checkbox-b'))
    expect(screen.getByTestId('merge-preview')).toBeInTheDocument()
    fireEvent.click(screen.getByText('結合を確定'))
    expect(props.onConfirmMerge).toHaveBeenCalledWith('a', 'b')
  })

  it('does not allow selecting a third page for merge', () => {
    render(<PageList {...baseProps()} />)
    fireEvent.click(screen.getByText('見開き結合'))
    fireEvent.click(screen.getByTestId('merge-checkbox-a'))
    fireEvent.click(screen.getByTestId('merge-checkbox-b'))
    expect(screen.getByTestId('merge-checkbox-c')).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- PageList`
Expected: FAIL — `Cannot find module './PageList'`.

- [ ] **Step 3: Implement `src/components/PageList.tsx`**

```tsx
import { useRef, useState } from 'react'
import type { PageEntry } from '../types'

interface PageListProps {
  pages: PageEntry[]
  thumbnails: Record<string, string>
  selectedPageId: string | null
  onSelect: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  onDelete: (id: string) => void
  onConfirmMerge: (firstId: string, secondId: string) => void
}

export function PageList({
  pages,
  thumbnails,
  selectedPageId,
  onSelect,
  onReorder,
  onDelete,
  onConfirmMerge,
}: PageListProps) {
  const draggedId = useRef<string | null>(null)
  const [mergeMode, setMergeMode] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  function handleDrop(targetId: string) {
    const sourceId = draggedId.current
    draggedId.current = null
    if (!sourceId || sourceId === targetId) return
    const ids = pages.map((p) => p.id)
    const withoutSource = ids.filter((id) => id !== sourceId)
    const targetIndex = withoutSource.indexOf(targetId)
    withoutSource.splice(targetIndex + 1, 0, sourceId)
    onReorder(withoutSource)
  }

  function toggleMergeSelection(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      if (current.length >= 2) return current
      return [...current, id]
    })
  }

  function cancelMerge() {
    setMergeMode(false)
    setSelected([])
  }

  return (
    <div>
      <button type="button" onClick={() => (mergeMode ? cancelMerge() : setMergeMode(true))}>
        見開き結合
      </button>

      {mergeMode && selected.length === 2 && (
        <div data-testid="merge-preview" style={{ display: 'flex' }}>
          <img src={thumbnails[selected[0]]} alt="left page" />
          <img src={thumbnails[selected[1]]} alt="right page" />
          <button
            type="button"
            onClick={() => {
              const [first, second] = selected
              onConfirmMerge(first, second)
              cancelMerge()
            }}
          >
            結合を確定
          </button>
          <button type="button" onClick={cancelMerge}>
            キャンセル
          </button>
        </div>
      )}

      <ul>
        {pages.map((page) => (
          <li
            key={page.id}
            data-testid={`page-item-${page.id}`}
            draggable={!mergeMode}
            style={page.id === selectedPageId ? { outline: '2px solid blue' } : undefined}
            onDragStart={() => {
              draggedId.current = page.id
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => handleDrop(page.id)}
          >
            {mergeMode && (
              <input
                type="checkbox"
                data-testid={`merge-checkbox-${page.id}`}
                checked={selected.includes(page.id)}
                disabled={!selected.includes(page.id) && selected.length >= 2}
                onChange={() => toggleMergeSelection(page.id)}
              />
            )}
            <img
              src={thumbnails[page.id]}
              alt={`page ${page.order + 1}`}
              onClick={() => onSelect(page.id)}
            />
            <button type="button" data-testid={`delete-${page.id}`} onClick={() => onDelete(page.id)}>
              削除
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- PageList`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/PageList.tsx src/components/PageList.test.tsx
git commit -m "feat: add PageList with drag reorder, delete, and spread-merge preview"
```

---

### Task 11: `AdjustmentEditor` component

**Design note:** jsdom's `canvas.getContext('2d')` returns `null` (no native canvas rendering without the optional `canvas` npm package), so the draw-to-`<canvas>` effect is a no-op under test and is not itself assertable — it is verified visually in Task 15 (E2E) and manual QA. The slider state management and the `applyAdjustment` call (Task 3, already unit tested) are what this task's tests cover.

**Files:**
- Create: `src/components/AdjustmentEditor.tsx`
- Test: `src/components/AdjustmentEditor.test.tsx`

**Interfaces:**
- Consumes: `applyAdjustment` (Task 3), `AdjustmentParams`/`RawImage` (Task 2).
- Produces:
```ts
interface AdjustmentEditorProps {
  image: RawImage
  adjustment: AdjustmentParams
  onAdjustmentChange: (params: AdjustmentParams) => void
  onApplyToAllPages: () => void
}
function AdjustmentEditor(props: AdjustmentEditorProps): JSX.Element
```
  Used by `App` (Task 14), which supplies the initial `adjustment` value (computed via `computeAutoAdjustment`, Task 4, when a page is first imported) and persists changes via `ImageStore.updateAdjustment` (Task 2).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/AdjustmentEditor.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AdjustmentEditor } from './AdjustmentEditor'
import type { RawImage } from '../types'

function image(): RawImage {
  return { data: new Uint8ClampedArray(16).fill(100), width: 2, height: 2 }
}

describe('AdjustmentEditor', () => {
  it('renders sliders reflecting the current adjustment values', () => {
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 15, contrast: -20 }}
        onAdjustmentChange={vi.fn()}
        onApplyToAllPages={vi.fn()}
      />,
    )
    expect(screen.getByTestId('brightness-slider')).toHaveValue('15')
    expect(screen.getByTestId('contrast-slider')).toHaveValue('-20')
  })

  it('calls onAdjustmentChange with an updated brightness, keeping contrast unchanged', () => {
    const onAdjustmentChange = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 5 }}
        onAdjustmentChange={onAdjustmentChange}
        onApplyToAllPages={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByTestId('brightness-slider'), { target: { value: '30' } })
    expect(onAdjustmentChange).toHaveBeenCalledWith({ brightness: 30, contrast: 5 })
  })

  it('calls onAdjustmentChange with an updated contrast, keeping brightness unchanged', () => {
    const onAdjustmentChange = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 10, contrast: 0 }}
        onAdjustmentChange={onAdjustmentChange}
        onApplyToAllPages={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByTestId('contrast-slider'), { target: { value: '-40' } })
    expect(onAdjustmentChange).toHaveBeenCalledWith({ brightness: 10, contrast: -40 })
  })

  it('calls onApplyToAllPages when the apply-to-all button is clicked', () => {
    const onApplyToAllPages = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 0 }}
        onAdjustmentChange={vi.fn()}
        onApplyToAllPages={onApplyToAllPages}
      />,
    )
    fireEvent.click(screen.getByText('他のページにも適用'))
    expect(onApplyToAllPages).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AdjustmentEditor`
Expected: FAIL — `Cannot find module './AdjustmentEditor'`.

- [ ] **Step 3: Implement `src/components/AdjustmentEditor.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { applyAdjustment } from '../lib/applyAdjustment'
import type { AdjustmentParams, RawImage } from '../types'

interface AdjustmentEditorProps {
  image: RawImage
  adjustment: AdjustmentParams
  onAdjustmentChange: (params: AdjustmentParams) => void
  onApplyToAllPages: () => void
}

export function AdjustmentEditor({
  image,
  adjustment,
  onAdjustmentChange,
  onApplyToAllPages,
}: AdjustmentEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    canvas.width = image.width
    canvas.height = image.height
    const preview = applyAdjustment(image, adjustment)
    ctx.putImageData(new ImageData(preview.data, preview.width, preview.height), 0, 0)
  }, [image, adjustment])

  return (
    <div>
      <canvas ref={canvasRef} data-testid="adjustment-canvas" />
      <label>
        明るさ
        <input
          type="range"
          min={-100}
          max={100}
          value={adjustment.brightness}
          data-testid="brightness-slider"
          onChange={(event) =>
            onAdjustmentChange({ ...adjustment, brightness: Number(event.target.value) })
          }
        />
      </label>
      <label>
        コントラスト
        <input
          type="range"
          min={-100}
          max={100}
          value={adjustment.contrast}
          data-testid="contrast-slider"
          onChange={(event) =>
            onAdjustmentChange({ ...adjustment, contrast: Number(event.target.value) })
          }
        />
      </label>
      <button type="button" onClick={onApplyToAllPages}>
        他のページにも適用
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- AdjustmentEditor`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/AdjustmentEditor.tsx src/components/AdjustmentEditor.test.tsx
git commit -m "feat: add AdjustmentEditor with brightness/contrast sliders and preview canvas"
```

---

### Task 12: `MetadataForm` component

**Files:**
- Create: `src/components/MetadataForm.tsx`
- Test: `src/components/MetadataForm.test.tsx`

**Interfaces:**
- Consumes: `BookMetadata` from `../types` (Task 2).
- Produces:
```ts
interface MetadataFormProps {
  metadata: BookMetadata
  onChange: (metadata: BookMetadata) => void
}
function MetadataForm(props: MetadataFormProps): JSX.Element
```
  Used by `App` (Task 14).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/MetadataForm.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MetadataForm } from './MetadataForm'

describe('MetadataForm', () => {
  it('renders the current title and author', () => {
    render(<MetadataForm metadata={{ title: 'T', author: 'A' }} onChange={vi.fn()} />)
    expect(screen.getByTestId('title-input')).toHaveValue('T')
    expect(screen.getByTestId('author-input')).toHaveValue('A')
  })

  it('calls onChange with an updated title, keeping author unchanged', () => {
    const onChange = vi.fn()
    render(<MetadataForm metadata={{ title: 'T', author: 'A' }} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('title-input'), { target: { value: 'New Title' } })
    expect(onChange).toHaveBeenCalledWith({ title: 'New Title', author: 'A' })
  })

  it('calls onChange with an updated author, keeping title unchanged', () => {
    const onChange = vi.fn()
    render(<MetadataForm metadata={{ title: 'T', author: 'A' }} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('author-input'), { target: { value: 'New Author' } })
    expect(onChange).toHaveBeenCalledWith({ title: 'T', author: 'New Author' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- MetadataForm`
Expected: FAIL — `Cannot find module './MetadataForm'`.

- [ ] **Step 3: Implement `src/components/MetadataForm.tsx`**

```tsx
import type { BookMetadata } from '../types'

interface MetadataFormProps {
  metadata: BookMetadata
  onChange: (metadata: BookMetadata) => void
}

export function MetadataForm({ metadata, onChange }: MetadataFormProps) {
  return (
    <div>
      <label>
        タイトル
        <input
          type="text"
          data-testid="title-input"
          value={metadata.title}
          onChange={(event) => onChange({ ...metadata, title: event.target.value })}
        />
      </label>
      <label>
        著者
        <input
          type="text"
          data-testid="author-input"
          value={metadata.author}
          onChange={(event) => onChange({ ...metadata, author: event.target.value })}
        />
      </label>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- MetadataForm`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/MetadataForm.tsx src/components/MetadataForm.test.tsx
git commit -m "feat: add MetadataForm for title/author input"
```

---

### Task 13: `ExportPanel` component

**Design note:** `ExportPanel` is presentational only — format selection, progress/error status, and the download link. It receives an `onExport` callback and has no knowledge of the Worker; Worker orchestration (gathering pages from `ImageStore`, posting to `exportWorker.ts`, awaiting the reply) is `App`'s responsibility (Task 14), since `App` is what holds the full page list.

**Files:**
- Create: `src/components/ExportPanel.tsx`
- Test: `src/components/ExportPanel.test.tsx`

**Interfaces:**
- Produces:
```ts
interface ExportPanelProps {
  onExport: (format: 'pdf' | 'epub') => Promise<Blob>
}
function ExportPanel(props: ExportPanelProps): JSX.Element
```
  Used by `App` (Task 14), which passes an `onExport` implementation that drives the Worker.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ExportPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExportPanel } from './ExportPanel'

describe('ExportPanel', () => {
  it('defaults to PDF and calls onExport with the selected format', async () => {
    const onExport = vi.fn().mockResolvedValue(new Blob(['x']))
    render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() => expect(onExport).toHaveBeenCalledWith('pdf'))
  })

  it('calls onExport with epub when the EPUB option is selected', async () => {
    const onExport = vi.fn().mockResolvedValue(new Blob(['x']))
    render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByLabelText('EPUB'))
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() => expect(onExport).toHaveBeenCalledWith('epub'))
  })

  it('shows a progress message while exporting, then a download link', async () => {
    let resolveExport: (blob: Blob) => void
    const onExport = vi.fn(
      () => new Promise<Blob>((resolve) => { resolveExport = resolve }),
    )
    render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByText('書き出し'))
    expect(screen.getByTestId('export-progress')).toBeInTheDocument()
    resolveExport!(new Blob(['x']))
    await waitFor(() => expect(screen.getByTestId('download-link')).toBeInTheDocument())
    expect(screen.queryByTestId('export-progress')).not.toBeInTheDocument()
  })

  it('shows an error message when onExport rejects', async () => {
    const onExport = vi.fn().mockRejectedValue(new Error('boom'))
    render(<ExportPanel onExport={onExport} />)
    fireEvent.click(screen.getByText('書き出し'))
    await waitFor(() => expect(screen.getByTestId('export-error')).toHaveTextContent('boom'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ExportPanel`
Expected: FAIL — `Cannot find module './ExportPanel'`.

- [ ] **Step 3: Implement `src/components/ExportPanel.tsx`**

```tsx
import { useState } from 'react'

type Format = 'pdf' | 'epub'
type Status = 'idle' | 'running' | 'done' | 'error'

interface ExportPanelProps {
  onExport: (format: Format) => Promise<Blob>
}

export function ExportPanel({ onExport }: ExportPanelProps) {
  const [format, setFormat] = useState<Format>('pdf')
  const [status, setStatus] = useState<Status>('idle')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleExport() {
    setStatus('running')
    setErrorMessage(null)
    try {
      const blob = await onExport(format)
      setDownloadUrl(URL.createObjectURL(blob))
      setStatus('done')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatus('error')
    }
  }

  return (
    <div>
      <label>
        <input
          type="radio"
          name="format"
          value="pdf"
          checked={format === 'pdf'}
          onChange={() => setFormat('pdf')}
        />
        PDF
      </label>
      <label>
        <input
          type="radio"
          name="format"
          value="epub"
          checked={format === 'epub'}
          onChange={() => setFormat('epub')}
        />
        EPUB
      </label>
      <button type="button" onClick={handleExport} disabled={status === 'running'}>
        書き出し
      </button>
      {status === 'running' && <p data-testid="export-progress">生成中...</p>}
      {status === 'error' && <p data-testid="export-error">{errorMessage}</p>}
      {status === 'done' && downloadUrl && (
        <a
          href={downloadUrl}
          download={format === 'pdf' ? 'book.pdf' : 'book.epub'}
          data-testid="download-link"
        >
          ダウンロード
        </a>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ExportPanel`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ExportPanel.tsx src/components/ExportPanel.test.tsx
git commit -m "feat: add ExportPanel with format selection, progress, and download link"
```

---

### Task 14: `useBook` hook, `encodeRawImageToPng`, `exportRunner`, and `App` wiring

**Design note:** `encodeRawImageToPng` (canvas-based) and `runExportInWorker` (real `Worker` instantiation) are browser-only glue, following the same no-unit-test pattern as `decodeImage.ts` (Task 9) and `exportWorker.ts` (Task 8) — they are exercised by the E2E test (Task 15). `useBook` orchestrates them together with the already-tested `ImageStore`, `computeAutoAdjustment`, and `mergeSpread`; because most of its methods bottom out in those same browser APIs, it is not unit tested in isolation either. What *is* unit tested here is `App`'s conditional rendering, by mocking the `useBook` hook so the test never touches IndexedDB, canvas, or Worker.

**Files:**
- Create: `src/lib/encodeImage.ts`
- Create: `src/lib/exportRunner.ts`
- Create: `src/hooks/useBook.ts`
- Modify: `src/App.tsx` (replace Vite template placeholder content)
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `ImageStore` (Task 2), `decodeBlobToRawImage` (Task 9), `computeAutoAdjustment` (Task 4), `mergeSpread` (Task 5), `runExport`/`ExportRequest` (Task 8), `PageList` (Task 10), `AdjustmentEditor` (Task 11), `MetadataForm` (Task 12), `ExportPanel` (Task 13).
- Produces: `App` — the composed root component rendered by `main.tsx` (Task 1).

- [ ] **Step 1: Write `src/lib/encodeImage.ts` (no unit test — see design note)**

```ts
import type { RawImage } from '../types'

export async function encodeRawImageToPng(image: RawImage): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('canvas.toBlob failed'))
    }, 'image/png')
  })
}
```

- [ ] **Step 2: Write `src/lib/exportRunner.ts` (no unit test — see design note)**

```ts
import type { ExportRequest } from '../workers/exportCore'

export function runExportInWorker(request: ExportRequest): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/exportWorker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (
      event: MessageEvent<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }>,
    ) => {
      worker.terminate()
      if (event.data.ok) {
        const mimeType = request.format === 'pdf' ? 'application/pdf' : 'application/epub+zip'
        resolve(new Blob([event.data.bytes], { type: mimeType }))
      } else {
        reject(new Error(event.data.error))
      }
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    worker.postMessage(request)
  })
}
```

- [ ] **Step 3: Write `src/hooks/useBook.ts` (no unit test — see design note)**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageStore } from '../lib/imageStore'
import { decodeBlobToRawImage } from '../lib/decodeImage'
import { encodeRawImageToPng } from '../lib/encodeImage'
import { computeAutoAdjustment } from '../lib/autoAdjust'
import { mergeSpread } from '../lib/mergeSpread'
import { runExportInWorker } from '../lib/exportRunner'
import type { AdjustmentParams, BookMetadata, PageEntry, RawImage } from '../types'

export interface UseBookResult {
  pages: PageEntry[]
  thumbnails: Record<string, string>
  metadata: BookMetadata
  selectedPageId: string | null
  selectedImage: RawImage | null
  importFiles: (files: File[]) => Promise<void>
  selectPage: (id: string) => Promise<void>
  updateAdjustment: (id: string, adjustment: AdjustmentParams) => Promise<void>
  applyAdjustmentToAllPages: (sourceId: string) => Promise<void>
  reorderPages: (orderedIds: string[]) => Promise<void>
  deletePage: (id: string) => Promise<void>
  confirmMerge: (firstId: string, secondId: string) => Promise<void>
  setMetadata: (metadata: BookMetadata) => void
  exportBook: (format: 'pdf' | 'epub') => Promise<Blob>
}

export function useBook(): UseBookResult {
  const storeRef = useRef<ImageStore | null>(null)
  const rawImagesRef = useRef<Map<string, RawImage>>(new Map())
  const [pages, setPages] = useState<PageEntry[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [metadata, setMetadata] = useState<BookMetadata>({ title: '', author: '' })
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<RawImage | null>(null)

  useEffect(() => {
    let cancelled = false
    ImageStore.open().then((store) => {
      if (cancelled) {
        store.close()
        return
      }
      storeRef.current = store
      store.listPages().then(setPages)
    })
    return () => {
      cancelled = true
      storeRef.current?.close()
    }
  }, [])

  const refreshPages = useCallback(async () => {
    const store = storeRef.current
    if (!store) return
    setPages(await store.listPages())
  }, [])

  const ensureRawImage = useCallback(async (page: PageEntry): Promise<RawImage> => {
    const cached = rawImagesRef.current.get(page.id)
    if (cached) return cached
    const store = storeRef.current!
    const blob = await store.getBlob(page.blobId)
    const raw = await decodeBlobToRawImage(blob!)
    rawImagesRef.current.set(page.id, raw)
    return raw
  }, [])

  const importFiles = useCallback(
    async (files: File[]) => {
      const store = storeRef.current
      if (!store) return
      let firstNewId: string | null = null
      for (const file of files) {
        const raw = await decodeBlobToRawImage(file)
        const page = await store.addPage(file, raw.width, raw.height)
        rawImagesRef.current.set(page.id, raw)
        const auto = computeAutoAdjustment(raw)
        await store.updateAdjustment(page.id, auto)
        setThumbnails((current) => ({ ...current, [page.id]: URL.createObjectURL(file) }))
        if (!firstNewId) firstNewId = page.id
      }
      await refreshPages()
      if (firstNewId && !selectedPageId) {
        setSelectedPageId(firstNewId)
        setSelectedImage(rawImagesRef.current.get(firstNewId) ?? null)
      }
    },
    [refreshPages, selectedPageId],
  )

  const selectPage = useCallback(
    async (id: string) => {
      const page = pages.find((p) => p.id === id)
      if (!page) return
      setSelectedPageId(id)
      setSelectedImage(await ensureRawImage(page))
    },
    [pages, ensureRawImage],
  )

  const updateAdjustment = useCallback(
    async (id: string, adjustment: AdjustmentParams) => {
      const store = storeRef.current
      if (!store) return
      await store.updateAdjustment(id, adjustment)
      await refreshPages()
    },
    [refreshPages],
  )

  const applyAdjustmentToAllPages = useCallback(
    async (sourceId: string) => {
      const store = storeRef.current
      if (!store) return
      const source = pages.find((p) => p.id === sourceId)
      if (!source) return
      for (const page of pages) {
        if (page.id === sourceId) continue
        await store.updateAdjustment(page.id, source.adjustment)
      }
      await refreshPages()
    },
    [pages, refreshPages],
  )

  const reorderPages = useCallback(
    async (orderedIds: string[]) => {
      const store = storeRef.current
      if (!store) return
      await store.reorderPages(orderedIds)
      await refreshPages()
    },
    [refreshPages],
  )

  const deletePage = useCallback(
    async (id: string) => {
      const store = storeRef.current
      if (!store) return
      await store.deletePage(id)
      rawImagesRef.current.delete(id)
      setThumbnails((current) => {
        const next = { ...current }
        if (next[id]) URL.revokeObjectURL(next[id])
        delete next[id]
        return next
      })
      if (selectedPageId === id) {
        setSelectedPageId(null)
        setSelectedImage(null)
      }
      await refreshPages()
    },
    [refreshPages, selectedPageId],
  )

  const confirmMerge = useCallback(
    async (firstId: string, secondId: string) => {
      const store = storeRef.current
      if (!store) return
      const first = pages.find((p) => p.id === firstId)
      const second = pages.find((p) => p.id === secondId)
      if (!first || !second) return
      const rawFirst = await ensureRawImage(first)
      const rawSecond = await ensureRawImage(second)
      const merged = mergeSpread(rawFirst, rawSecond)
      const blob = await encodeRawImageToPng(merged)
      const mergedEntry = await store.replacePagesWithMerged(
        [firstId, secondId],
        blob,
        merged.width,
        merged.height,
      )
      rawImagesRef.current.delete(firstId)
      rawImagesRef.current.delete(secondId)
      rawImagesRef.current.set(mergedEntry.id, merged)
      setThumbnails((current) => {
        const next = { ...current }
        if (next[firstId]) URL.revokeObjectURL(next[firstId])
        if (next[secondId]) URL.revokeObjectURL(next[secondId])
        delete next[firstId]
        delete next[secondId]
        next[mergedEntry.id] = URL.createObjectURL(blob)
        return next
      })
      if (selectedPageId === firstId || selectedPageId === secondId) {
        setSelectedPageId(mergedEntry.id)
        setSelectedImage(merged)
      }
      await refreshPages()
    },
    [pages, refreshPages, selectedPageId, ensureRawImage],
  )

  const exportBook = useCallback(
    async (format: 'pdf' | 'epub') => {
      const store = storeRef.current
      if (!store) throw new Error('store not ready')
      const currentPages = await store.listPages()
      const exportPages = []
      for (const page of currentPages) {
        const raw = await ensureRawImage(page)
        exportPages.push({ image: raw, adjustment: page.adjustment })
      }
      return runExportInWorker({ format, metadata, pages: exportPages })
    },
    [metadata, ensureRawImage],
  )

  return {
    pages,
    thumbnails,
    metadata,
    selectedPageId,
    selectedImage,
    importFiles,
    selectPage,
    updateAdjustment,
    applyAdjustmentToAllPages,
    reorderPages,
    deletePage,
    confirmMerge,
    setMetadata,
    exportBook,
  }
}
```

- [ ] **Step 4: Write the failing test for `App`**

```tsx
// src/App.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App'
import * as useBookModule from './hooks/useBook'
import type { UseBookResult } from './hooks/useBook'

function mockBook(overrides: Partial<UseBookResult> = {}): UseBookResult {
  return {
    pages: [],
    thumbnails: {},
    metadata: { title: '', author: '' },
    selectedPageId: null,
    selectedImage: null,
    importFiles: vi.fn(),
    selectPage: vi.fn(),
    updateAdjustment: vi.fn(),
    applyAdjustmentToAllPages: vi.fn(),
    reorderPages: vi.fn(),
    deletePage: vi.fn(),
    confirmMerge: vi.fn(),
    setMetadata: vi.fn(),
    exportBook: vi.fn(),
    ...overrides,
  }
}

describe('App', () => {
  it('shows only the import panel when there are no pages yet', () => {
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(mockBook())
    render(<App />)
    expect(screen.getByText('ファイルを選択')).toBeInTheDocument()
    expect(screen.queryByText('書き出し')).not.toBeInTheDocument()
  })

  it('shows the page list, metadata form, and export panel once pages exist', () => {
    const page = {
      id: 'a',
      order: 0,
      blobId: 'blob-a',
      width: 10,
      height: 10,
      adjustment: { brightness: 0, contrast: 0 },
    }
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({ pages: [page], thumbnails: { a: 'blob:a' } }),
    )
    render(<App />)
    expect(screen.getByText('書き出し')).toBeInTheDocument()
    expect(screen.getByText('見開き結合')).toBeInTheDocument()
  })

  it('shows the AdjustmentEditor once a page is selected and its image is loaded', () => {
    const page = {
      id: 'a',
      order: 0,
      blobId: 'blob-a',
      width: 2,
      height: 2,
      adjustment: { brightness: 5, contrast: 0 },
    }
    vi.spyOn(useBookModule, 'useBook').mockReturnValue(
      mockBook({
        pages: [page],
        thumbnails: { a: 'blob:a' },
        selectedPageId: 'a',
        selectedImage: { data: new Uint8ClampedArray(16), width: 2, height: 2 },
      }),
    )
    render(<App />)
    expect(screen.getByTestId('brightness-slider')).toHaveValue('5')
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test -- App.test`
Expected: FAIL — `Cannot find module './hooks/useBook'` (or `App` not yet updated to use it).

- [ ] **Step 6: Replace `src/App.tsx`**

```tsx
import { useBook } from './hooks/useBook'
import { ImportPanel } from './components/ImportPanel'
import { PageList } from './components/PageList'
import { AdjustmentEditor } from './components/AdjustmentEditor'
import { MetadataForm } from './components/MetadataForm'
import { ExportPanel } from './components/ExportPanel'
import { DEFAULT_ADJUSTMENT } from './types'

export function App() {
  const book = useBook()
  const selectedPage = book.pages.find((p) => p.id === book.selectedPageId)

  return (
    <div>
      <h1>ebook-maker</h1>
      <ImportPanel onImport={book.importFiles} />
      {book.pages.length > 0 && (
        <>
          <PageList
            pages={book.pages}
            thumbnails={book.thumbnails}
            selectedPageId={book.selectedPageId}
            onSelect={book.selectPage}
            onReorder={book.reorderPages}
            onDelete={book.deletePage}
            onConfirmMerge={book.confirmMerge}
          />
          {book.selectedImage && selectedPage && (
            <AdjustmentEditor
              image={book.selectedImage}
              adjustment={selectedPage.adjustment ?? DEFAULT_ADJUSTMENT}
              onAdjustmentChange={(params) => book.updateAdjustment(selectedPage.id, params)}
              onApplyToAllPages={() => book.applyAdjustmentToAllPages(selectedPage.id)}
            />
          )}
          <MetadataForm metadata={book.metadata} onChange={book.setMetadata} />
          <ExportPanel onExport={book.exportBook} />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Update `src/main.tsx` to use the named `App` export**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 8: Delete the now-unused Vite template styling that assumes the old `App` default export**

Run: `rm -f src/App.css`

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- App.test`
Expected: PASS — all 3 tests green.

- [ ] **Step 10: Run the full test suite and the build**

Run: `npm test && npm run build`
Expected: all suites PASS; build succeeds with no TypeScript errors.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: wire ImageStore/adjustment/merge/export into useBook hook and App"
```

---

### Task 15: End-to-end flow test with Playwright

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/makeTinyPng.ts`
- Create: `e2e/full-flow.spec.ts`
- Modify: `package.json` (add `test:e2e` script)

**Interfaces:**
- Consumes: the running app (`App`, Task 14) via a real browser, driven through the same `data-testid`s used by the component unit tests (`file-input`, `page-item-<id>`, `merge-checkbox-<id>`, `brightness-slider`, `title-input`, `author-input`, `download-link`).
- Produces: a downloaded `.pdf`/`.epub` file, verified with `pdf-lib` / `jszip` (already unit-test dependencies) for page count and metadata — per spec §テスト方針, pixel-level content is not asserted here (that's the manual-QA step).

- [ ] **Step 1: Install Playwright**

Run: `npm install -D @playwright/test && npx playwright install chromium`
Expected: exit code 0.

- [ ] **Step 2: Add the `test:e2e` script**

Edit `package.json` `"scripts"` to add:
```json
"test:e2e": "playwright test"
```

- [ ] **Step 3: Write `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:5173',
  },
})
```

- [ ] **Step 4: Write `e2e/makeTinyPng.ts`**

A small, dependency-free PNG encoder for generating fixture files — the same construction (and CRC-32 implementation) verified against `pdf-lib.embedPng` while authoring this plan (Task 6).

```ts
import zlib from 'node:zlib'

function crc32(buf: Buffer): number {
  const table: number[] = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

export function makeTinyPng(
  width: number,
  height: number,
  pixel: [number, number, number, number],
): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA

  const raw = Buffer.alloc(height * (1 + width * 4))
  let o = 0
  for (let y = 0; y < height; y += 1) {
    raw[o] = 0 // filter type: none
    o += 1
    for (let x = 0; x < width; x += 1) {
      raw[o] = pixel[0]
      raw[o + 1] = pixel[1]
      raw[o + 2] = pixel[2]
      raw[o + 3] = pixel[3]
      o += 4
    }
  }
  const idatData = zlib.deflateSync(raw)

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))])
}
```

- [ ] **Step 5: Write `e2e/full-flow.spec.ts`**

```ts
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
```

- [ ] **Step 6: Run the E2E suite**

Run: `npm run test:e2e`
Expected: PASS — both tests green. (If the dev server needs a longer boot, rerun once — the `webServer` block starts it automatically.)

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e/ package.json package-lock.json
git commit -m "test: add Playwright end-to-end flow covering import/adjust/merge/export"
```

---

---

### Task 16: GitHub Pages deployment

**Files:**
- Modify: `vite.config.ts` (add `base` path)
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: the `dist/` output of `npm run build` (all prior tasks).
- Produces: a GitHub Actions workflow that builds and publishes `dist/` to GitHub Pages on every push to `main`.

- [ ] **Step 1: Set the Vite `base` path to the repository name**

Edit `vite.config.ts`, adding `base` to the `defineConfig` call (GitHub Pages serves a project site at `https://<user>.github.io/<repo>/`, so asset URLs must be prefixed with the repo name — adjust the string below if this repository is ever renamed):

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/ebook-maker/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
```

- [ ] **Step 2: Verify the build emits assets under the `/ebook-maker/` prefix**

Run:
```bash
npm run build && grep -o 'src="/ebook-maker/assets/[^"]*"' dist/index.html
```
Expected: at least one match printed (confirms `base` was applied).

- [ ] **Step 3: Write `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts .github/workflows/deploy.yml
git commit -m "ci: deploy to GitHub Pages on push to main"
```

Actual deployment success (the `deploy` job going green, the site loading at `https://<user>.github.io/ebook-maker/`) can only be confirmed after this commit is pushed and GitHub Pages is enabled for the repository (Settings → Pages → Source: GitHub Actions) — both are outside what this plan can verify locally.

---

## Final Verification

- [ ] **Run everything once, end to end**

Run:
```bash
npm run build && npm test && npm run test:e2e
```
Expected: build succeeds, all Vitest suites pass, both Playwright tests pass.
