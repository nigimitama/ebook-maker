# OCR並列実行(同時処理数の設定) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全ページOCRを複数のOCR Workerでページ単位に並列実行し、同時処理数をユーザーが選べるようにする。

**Architecture:** `OcrRunner`(Worker 1つ)は変えず、`useOcr` がレーンごとにRunnerを持つ(レーン方式)。同時処理数は純関数モジュール `ocrSettings.ts` で丸め・保存し、`useOcr` が状態として公開する。UIは `OcrSettings` コンポーネントを `OcrReview` 上部に置き、`window.EbookMaker` にも同期する。

**Tech Stack:** React 19 / TypeScript / Vitest + Testing Library / fake-indexeddb

**Spec:** `docs/superpowers/specs/2026-09-23-ocr-concurrency-design.md`

## Global Constraints

- 既定値 `min(2, 上限)`、上限 `max(1, 論理コア数 − 1)`、コア数が取れなければコア数2とみなす。
- 保存キー `ebook-maker:ocr-concurrency`(`localStorage`、読み書きは try/catch)。
- onnxruntime の `numThreads = 1` は変えない。
- UI文言・コメントは日本語。
- 各タスク後に `npm test` 該当ファイル、最後に `npm run typecheck` / `npm test` / `npm run lint`。

---

### Task 1: `ocrSettings.ts`(上限・丸め・保存)

**Files:**
- Create: `src/lib/ocr/ocrSettings.ts`
- Test: `src/lib/ocr/ocrSettings.test.ts`

**Interfaces:**
- Produces:
  - `OCR_CONCURRENCY_STORAGE_KEY = 'ebook-maker:ocr-concurrency'`
  - `type OcrSettingsStorage = Pick<Storage, 'getItem' | 'setItem'>`
  - `maxOcrConcurrency(cores: number | undefined): number`
  - `defaultOcrConcurrency(max: number): number`
  - `clampOcrConcurrency(n: number, max: number): number`
  - `loadOcrConcurrency(max: number, storage: OcrSettingsStorage | undefined): number`
  - `saveOcrConcurrency(n: number, storage: OcrSettingsStorage | undefined): void`
  - `browserStorage(): OcrSettingsStorage | undefined`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest'
import {
  OCR_CONCURRENCY_STORAGE_KEY,
  clampOcrConcurrency,
  defaultOcrConcurrency,
  loadOcrConcurrency,
  maxOcrConcurrency,
  saveOcrConcurrency,
} from './ocrSettings'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  }
}
const throwing = {
  getItem: () => { throw new Error('denied') },
  setItem: () => { throw new Error('denied') },
}

describe('maxOcrConcurrency', () => {
  it('論理コア数−1、最低1', () => {
    expect(maxOcrConcurrency(16)).toBe(15)
    expect(maxOcrConcurrency(2)).toBe(1)
    expect(maxOcrConcurrency(1)).toBe(1)
  })
  it('取れないときはコア数2とみなす', () => {
    expect(maxOcrConcurrency(undefined)).toBe(1)
    expect(maxOcrConcurrency(Number.NaN)).toBe(1)
    expect(maxOcrConcurrency(0)).toBe(1)
  })
})

describe('defaultOcrConcurrency / clampOcrConcurrency', () => {
  it('既定値は2、上限で頭打ち', () => {
    expect(defaultOcrConcurrency(15)).toBe(2)
    expect(defaultOcrConcurrency(1)).toBe(1)
  })
  it('1〜上限の整数に丸める', () => {
    expect(clampOcrConcurrency(0, 7)).toBe(1)
    expect(clampOcrConcurrency(-3, 7)).toBe(1)
    expect(clampOcrConcurrency(3.9, 7)).toBe(3)
    expect(clampOcrConcurrency(99, 7)).toBe(7)
    expect(clampOcrConcurrency(Number.NaN, 7)).toBe(2)
  })
})

describe('loadOcrConcurrency / saveOcrConcurrency', () => {
  it('未保存なら既定値', () => {
    expect(loadOcrConcurrency(7, memoryStorage())).toBe(2)
    expect(loadOcrConcurrency(7, undefined)).toBe(2)
  })
  it('保存値を上限で丸めて読む', () => {
    expect(loadOcrConcurrency(7, memoryStorage({ [OCR_CONCURRENCY_STORAGE_KEY]: '5' }))).toBe(5)
    expect(loadOcrConcurrency(3, memoryStorage({ [OCR_CONCURRENCY_STORAGE_KEY]: '12' }))).toBe(3)
  })
  it('不正値や例外なら既定値', () => {
    expect(loadOcrConcurrency(7, memoryStorage({ [OCR_CONCURRENCY_STORAGE_KEY]: 'abc' }))).toBe(2)
    expect(loadOcrConcurrency(7, memoryStorage({ [OCR_CONCURRENCY_STORAGE_KEY]: '' }))).toBe(2)
    expect(loadOcrConcurrency(7, throwing)).toBe(2)
  })
  it('保存する(例外は握りつぶす)', () => {
    const s = memoryStorage()
    saveOcrConcurrency(4, s)
    expect(s.data.get(OCR_CONCURRENCY_STORAGE_KEY)).toBe('4')
    expect(() => saveOcrConcurrency(4, throwing)).not.toThrow()
  })
})
```

- [ ] **Step 2:** `npx vitest run src/lib/ocr/ocrSettings.test.ts` → モジュールが無くてFAIL
- [ ] **Step 3: 実装**

```ts
// OCRの同時処理数(=同時に動かすOCR Workerの数)の設定。
export const OCR_CONCURRENCY_STORAGE_KEY = 'ebook-maker:ocr-concurrency'

export type OcrSettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

const FALLBACK_CORES = 2
const PREFERRED_DEFAULT = 2

// UI操作用にメインスレッドへ1コア残す。
export function maxOcrConcurrency(cores: number | undefined): number {
  const n = typeof cores === 'number' && Number.isFinite(cores) && cores >= 1 ? Math.floor(cores) : FALLBACK_CORES
  return Math.max(1, n - 1)
}

export function defaultOcrConcurrency(max: number): number {
  return Math.min(PREFERRED_DEFAULT, max)
}

export function clampOcrConcurrency(n: number, max: number): number {
  if (!Number.isFinite(n)) return defaultOcrConcurrency(max)
  return Math.min(max, Math.max(1, Math.floor(n)))
}

export function loadOcrConcurrency(max: number, storage: OcrSettingsStorage | undefined): number {
  try {
    const raw = storage?.getItem(OCR_CONCURRENCY_STORAGE_KEY)
    if (raw == null || raw.trim() === '') return defaultOcrConcurrency(max)
    return clampOcrConcurrency(Number(raw), max)
  } catch {
    return defaultOcrConcurrency(max)
  }
}

export function saveOcrConcurrency(n: number, storage: OcrSettingsStorage | undefined): void {
  try {
    storage?.setItem(OCR_CONCURRENCY_STORAGE_KEY, String(n))
  } catch {
    /* 保存できなくても今回の実行には影響しない */
  }
}

// プライベートモード等では localStorage へのアクセス自体が例外になりうる。
export function browserStorage(): OcrSettingsStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}
```

- [ ] **Step 4:** 同コマンドでPASS
- [ ] **Step 5:** commit `feat: OCRの同時処理数の上限・丸め・保存を追加する`

### Task 2: `useOcr` のレーン並列実行と設定状態

**Files:**
- Modify: `src/hooks/useOcr.ts`
- Test: `src/hooks/useOcr.test.ts`

**Interfaces:**
- Consumes: Task 1 の関数
- Produces:
  - `UseOcrOptions` に `cores?: number`(既定 `navigator.hardwareConcurrency`)、`storage?: OcrSettingsStorage`(既定 `browserStorage()`)
  - `export interface OcrProgress { done: number; total: number; stage?: string; concurrency?: number }`
  - `UseOcrResult` に `progress: OcrProgress | null`、`concurrency: number`、`maxConcurrency: number`、`setConcurrency: (n: number) => number`

- [ ] **Step 1:** 既存テストの `setup` と `'reports stage in progress'` の `useOcr` 呼び出しに `cores: 2`(上限1=従来の直列)を足す。
- [ ] **Step 2: 並列用の失敗するテストを追加**(別の `describe('useOcr concurrency')`、Runnerは呼ばれるたびに新しい偽物を作る)

```ts
describe('useOcr concurrency', () => {
  let store: ImageStore
  let pages: PageEntry[]
  let log: string[]
  let active: number
  let maxActive: number
  let failOn: Set<number>
  let onDone: ((byte: number) => void) | undefined
  let runners: OcrRunner[]
  let storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }
  const getStore = async () => store

  function makeRunner(index: number): OcrRunner {
    return {
      recognizePage: vi.fn(async (b: Blob, onStage?: (s: OcrStage) => void) => {
        const byte = new Uint8Array(await b.arrayBuffer())[0]
        log.push(`start:${index}:${byte}`)
        active += 1
        maxActive = Math.max(maxActive, active)
        onStage?.('loading-models')
        await new Promise((r) => setTimeout(r, 20))
        log.push(`detecting:${index}`)
        onStage?.('detecting')
        await new Promise((r) => setTimeout(r, 30))
        active -= 1
        onDone?.(byte)
        if (failOn.has(byte)) throw new Error('boom')
        return [line(`l${byte}`, `t${byte}`)]
      }),
      dispose: vi.fn(),
    }
  }

  function setup(concurrency: number) {
    storage.setItem('ebook-maker:ocr-concurrency', String(concurrency))
    const createRunner = vi.fn(() => {
      const r = makeRunner(runners.length)
      runners.push(r)
      return r
    })
    return renderHook(() => useOcr(getStore, { createRunner, cores: 8, storage }))
  }

  beforeEach(async () => {
    store = await ImageStore.open(`ocr-conc-${Math.random()}`)
    pages = []
    for (let i = 1; i <= 4; i += 1) pages.push(await store.addPage(blob(i), 5, 5, undefined, `p${i}.png`))
    log = []
    active = 0
    maxActive = 0
    failOn = new Set()
    onDone = undefined
    runners = []
    const data = new Map<string, string>()
    storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
  })

  it('同時処理数ぶん並列に処理し、終了後はレーン0以外のRunnerを破棄する', async () => {
    const { result } = setup(3)
    await act(async () => {
      await result.current.runAll(pages.map((p) => p.id))
    })
    expect(maxActive).toBe(3)
    expect(runners).toHaveLength(3)
    expect(Object.keys(result.current.results)).toHaveLength(4)
    expect(runners[0].dispose).not.toHaveBeenCalled()
    expect(runners[1].dispose).toHaveBeenCalled()
    expect(runners[2].dispose).toHaveBeenCalled()
  })

  it('レーン0がモデルを読み終えるまで他レーンは始めない', async () => {
    const { result } = setup(3)
    await act(async () => {
      await result.current.runAll(pages.map((p) => p.id))
    })
    const firstOther = log.findIndex((e) => e.startsWith('start:') && !e.startsWith('start:0:'))
    expect(firstOther).toBeGreaterThan(log.indexOf('detecting:0'))
  })

  it('1ページの失敗は他レーンを止めず、そのレーンのRunnerだけ捨てる', async () => {
    failOn.add(2)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = setup(3)
    await act(async () => {
      await result.current.runAll(pages.slice(0, 3).map((p) => p.id))
    })
    consoleError.mockRestore()
    expect(Object.keys(result.current.results).sort()).toEqual([pages[0].id, pages[2].id].sort())
    expect(result.current.error).toContain('p2.png')
    expect(runners[0].dispose).not.toHaveBeenCalled()
  })

  it('中止すると処理中のページだけ保存し、残りは処理しない', async () => {
    const { result } = setup(2)
    onDone = () => result.current.cancel()
    await act(async () => {
      await result.current.runAll(pages.map((p) => p.id))
    })
    expect(log.filter((e) => e.startsWith('start:'))).toHaveLength(2)
    expect(await store.listOcr()).toHaveLength(2)
  })

  it('setConcurrency は丸めて保存し、上限と既定値を公開する', () => {
    const { result } = renderHook(() => useOcr(getStore, { cores: 4, storage }))
    expect(result.current.maxConcurrency).toBe(3)
    expect(result.current.concurrency).toBe(2)
    let applied = 0
    act(() => {
      applied = result.current.setConcurrency(10)
    })
    expect(applied).toBe(3)
    expect(result.current.concurrency).toBe(3)
    expect(storage.getItem('ebook-maker:ocr-concurrency')).toBe('3')
  })
})
```

- [ ] **Step 3:** `npx vitest run src/hooks/useOcr.test.ts` → 新規テストがFAIL
- [ ] **Step 4: 実装**(要点)
  - `concurrency` を `useState(() => loadOcrConcurrency(maxConcurrency, storage))` と `concurrencyRef` で持つ。`setConcurrency` は clamp → 保存 → state/ref更新 → 値を返す。
  - `runnerRef` を `runnersRef: (OcrRunner | null)[]` に置き換え、`discardRunner(lane)` / `disposeRunners(fromLane)` にする。アンマウント時は全破棄。
  - `runAll` の対象選定は現状のまま。ループ本体を `processPage(lane, index, page)` に切り出し(戻り値 `'unmounted' | 'done'`)、`lanes = min(concurrencyRef.current, targets.length)` 本の `runLane(lane)` を `Promise.all` で走らせる。レーンは共有の `next` からページを取る。
  - ゲート:`firstLoaded` Promise。レーン0の `onStage` で `'loading-models'` 以外が来たとき、レーン0の1ページ目が終わったとき、レーン0が抜けるときに解決。レーン1以降は解決を待ってから開始。
  - 進捗:`stages[lane]` を記録し、`loading-models` を含めばそれ、レーン数1ならそのレーンの段階、それ以外は `undefined`。`progress = { done, total, stage, concurrency: lanes }`。
  - 失敗は `{ index, name }` で集めて index 順に並べてメッセージにする(並列だと完了順が不定なため)。
  - `finally` で `disposeRunners(1)`。
- [ ] **Step 5:** `npx vitest run src/hooks/useOcr.test.ts` → PASS(既存テストも)
- [ ] **Step 6:** commit `feat: OCRを同時処理数ぶんのWorkerでページ並列に実行する`

### Task 3: 設定UI(`OcrSettings`)と進捗ラベル

**Files:**
- Create: `src/components/OcrSettings.tsx`
- Modify: `src/components/OcrReview.tsx`(上部に配置、進捗ラベル)、`src/index.css`
- Test: `src/components/OcrReview.test.tsx`

**Interfaces:**
- Consumes: `UseOcrResult.concurrency / maxConcurrency / setConcurrency / progress.concurrency`
- Produces: `OcrSettings({ value, max, disabled, onChange: (n: number) => number })`

- [ ] **Step 1: 失敗するテスト**(`makeOcr` に `concurrency: 2, maxConcurrency: 7, setConcurrency: vi.fn((n: number) => Math.min(7, Math.max(1, Math.floor(n))))` を足す)

```ts
it('OCRの設定で同時処理数を入力でき、確定時に丸めた値を表示する', () => {
  const ocr = makeOcr()
  setup(ocr)
  const input = screen.getByLabelText('同時に処理するページ数') as HTMLInputElement
  expect(input.value).toBe('2')
  expect(screen.getByText(/この端末の上限: 7/)).toBeInTheDocument()
  fireEvent.change(input, { target: { value: '20' } })
  fireEvent.blur(input)
  expect(ocr.setConcurrency).toHaveBeenCalledWith(20)
  expect(input.value).toBe('7')
  fireEvent.change(input, { target: { value: '3' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(ocr.setConcurrency).toHaveBeenLastCalledWith(3)
})

it('実行中は同時処理数を変更できない', () => {
  setup(makeOcr({ running: true, progress: { done: 0, total: 3 } }))
  expect(screen.getByLabelText('同時に処理するページ数')).toBeDisabled()
})

it('並列実行中は並列数を進捗に出す', () => {
  setup(makeOcr({ running: true, progress: { done: 1, total: 4, concurrency: 3 } }))
  expect(screen.getByText(/文字認識中\(3並列\)/)).toBeInTheDocument()
})
```

- [ ] **Step 2:** `npx vitest run src/components/OcrReview.test.tsx` → FAIL
- [ ] **Step 3: 実装**

```tsx
import { useEffect, useId, useState } from 'react'

export interface OcrSettingsProps {
  value: number
  max: number
  disabled: boolean
  /** 丸めて保存し、実際に採用した値を返す。 */
  onChange: (n: number) => number
}

// 同時に動かすOCR Workerの数。変更は次の実行から反映される。
export function OcrSettings({ value, max, disabled, onChange }: OcrSettingsProps) {
  const inputId = useId()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  function commit() {
    setDraft(String(onChange(Number(draft))))
  }

  return (
    <section className="ocr-settings panel" aria-label="OCRの設定">
      <h3 className="ocr-settings__title">OCRの設定</h3>
      <div className="ocr-settings__row">
        <label htmlFor={inputId}>同時に処理するページ数</label>
        <input
          id={inputId}
          type="number"
          min={1}
          max={max}
          step={1}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
      </div>
      <p className="ocr-review__hint">
        この端末の上限: {max}(論理コア数−1)。増やすと速くなりますが、1つ増やすごとにメモリを多く使い、PCが重くなることがあります。
      </p>
    </section>
  )
}
```

`OcrReview`: エラーバナーの直後・ツールバーの前に `<OcrSettings value={ocr.concurrency} max={ocr.maxConcurrency} disabled={ocr.running} onChange={ocr.setConcurrency} />`。進捗ラベルは

```ts
const parallel = ocr.progress?.concurrency ?? 1
const progressLabel =
  stage && STAGE_LABEL[stage] ? STAGE_LABEL[stage] : parallel > 1 ? `文字認識中(${parallel}並列)` : '文字認識中'
```

`index.css` に `.ocr-settings` / `.ocr-settings__title` / `.ocr-settings__row` を既存の `.ocr-review__toolbar` 付近の書式に合わせて追加。

- [ ] **Step 4:** PASS 確認
- [ ] **Step 5:** commit `feat: OCRの設定セクションで同時処理数を選べるようにする`

### Task 4: 自動操作APIと llms.txt

**Files:**
- Modify: `src/lib/automationApi.ts`、`src/App.tsx`、`public/llms.txt`
- Test: `src/lib/automationApi.test.ts`

**Interfaces:**
- Consumes: `UseOcrResult.concurrency / maxConcurrency / setConcurrency`, `OcrProgress`
- Produces: `AutomationApi.getOcrConcurrency(): { value: number; max: number }`、`AutomationApi.setOcrConcurrency(n: number): number`、`AutomationState.ocr.concurrency / maxConcurrency`

- [ ] **Step 1: 失敗するテスト**(`fakeApi` に2メソッドと state の2項目を足し、追加テスト)

```ts
it('exposes OCR concurrency getters/setters and documents them', () => {
  const api = fakeApi({ setOcrConcurrency: vi.fn(() => 3) })
  installAutomationApi(api)
  expect(window.EbookMaker?.setOcrConcurrency(9)).toBe(3)
  expect(api.setOcrConcurrency).toHaveBeenCalledWith(9)
  const methods = window.EbookMaker?.describe().methods
  expect(methods?.getOcrConcurrency).toMatch(/同時処理数/)
  expect(methods?.setOcrConcurrency).toMatch(/同時処理数/)
})
```

- [ ] **Step 2:** FAIL 確認
- [ ] **Step 3: 実装**
  - `AutomationState.ocr` を `{ running; progress: OcrProgress | null; concurrency: number; maxConcurrency: number }` に。
  - `AutomationApi` に2メソッド、`API_DESCRIPTION` に説明:
    - `getOcrConcurrency: '() => { value: number; max: number } — OCRの同時処理数(同時に動かすWorker数)と、この端末での上限(論理コア数−1)を返す。'`
    - `setOcrConcurrency: '(n: number) => number — OCRの同時処理数を設定する(1〜上限に丸めて保存し、採用した値を返す)。次の実行から反映される。増やすほど速いがメモリを多く使う。'`
  - `App.tsx`: state に `concurrency: ocr.concurrency, maxConcurrency: ocr.maxConcurrency`、メソッド `getOcrConcurrency: () => ({ value: ocr.concurrency, max: ocr.maxConcurrency })`, `setOcrConcurrency: ocr.setConcurrency`。
  - `public/llms.txt` に「## OCRの同時処理数」節を追加。
- [ ] **Step 4:** PASS、`npm run typecheck`
- [ ] **Step 5:** commit `feat: 自動操作APIでOCRの同時処理数を読み書きできるようにする`

### Task 5: 全体検証

- [ ] `npm run typecheck` / `npm test` / `npm run lint` がすべて通る
- [ ] devサーバーで同時処理数1と2で全ページOCRを走らせ、所要時間を比べる(モデルが無ければ手動確認として残す)
