# タイトルの設定ステップ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ウィザードに新しい4番目のステップ「タイトルの設定」を追加し、1ページ目(表紙と仮定)のOCR結果から文字サイズが最大の行をタイトルの初期候補として自動推論しつつ、タイトル・著者をユーザーが確定できるようにする。

**Architecture:** OCR行のbbox(`w`/`h`)から文字サイズ(短辺)を求める純関数を`src/lib/titleGuess.ts`に追加する。新しい`TitleStep`コンポーネントが、表紙ページの拡大表示・OCR結果を文字サイズ降順に並べた候補リスト・タイトル/著者の入力(既存`MetadataForm`を再利用)を表示する。`App.tsx`のステップ配列とナビゲーションのステップ番号をひとつずつ繰り下げ、新ステップを「OCR確認・修正」と「目次の作成」の間(index 3)に挿入する。既存の`MetadataForm`は最終ステップから新ステップへ移す(重複入力をなくすため)。

**Tech Stack:** React + TypeScript (Vite)、Vitest + @testing-library/react、既存の`OcrResult`/`Chapter`型と`useOcr`/`useBook`フック、`ZoomModal`/`AdjustedPreview`共通コンポーネント。

**Spec:** ユーザー指示(このプラン冒頭のARGUMENTS): 「OCR結果を使ってタイトルの初期値を自動推論する機能をつけたい。4番目のステップとして、目次の作成の前にタイトルの設定のセクションを入れて。ここでタイトルと著者をOCRの補助を使いつつ設定できるようにしたい。1ページ目の画像を表紙と仮定し、文字サイズ（bboxの高さあるいは幅の短い辺）が最も大きいテキストをタイトルの第1候補として。」

## Global Constraints

- UIの文言・コードコメントは日本語(既存コードベースの慣習に合わせる)。
- `npm test`は型チェックをしないため、実装後に必ず`npm run typecheck`を実行する(CIも同様)。
- 既存の`OcrLine`/`OcrResult`/`Chapter`/`BookMetadata`型は変更しない(bboxは`{x, y, w, h}`のpx単位、既存フィールドそのまま使う)。
- 新規の純関数は`src/lib/`直下に置き、Reactに依存しないユニットテストを書く(既存の`toc/parseToc.ts`等の慣習に合わせる)。
- ステップ番号は0始まり。既存の`STEPS`配列とナビゲーションの`goTo(n)`呼び出しは、新ステップ挿入に伴い全て+1にずれる箇所を漏れなく直す。
- `window.EbookMaker`(automationApi)の`goToStep`説明文はステップ番号の変更に追従させる(CLAUDE.mdの「automationApiを追加時は同期させる」指示に基づく)。

---

### Task 1: タイトル候補を文字サイズ順に並べる純関数

**Files:**
- Create: `src/lib/titleGuess.ts`
- Test: `src/lib/titleGuess.test.ts`

**Interfaces:**
- Consumes: `OcrLine`/`OcrResult`型(`src/lib/ocr/types.ts`、既存。`OcrLine`は`{ id, x, y, w, h, text, edited }`)。
- Produces:
  - `lineFontSize(line: OcrLine): number` — bboxの短辺(`Math.min(line.w, line.h)`)。他タスクはこれをpx単位の文字サイズ表示に使う。
  - `sortByFontSizeDesc(result: OcrResult | undefined): OcrLine[]` — テキストが空でない行を文字サイズ降順に並べた配列(同点は元の配列順=読み順を保つ安定ソート)。`result`が`undefined`または行が0件なら`[]`。Task 2で候補リストの描画に使う。
  - `guessTitle(result: OcrResult | undefined): string` — `sortByFontSizeDesc(result)[0]?.text ?? ''`。Task 2でタイトル初期値の自動推論に使う。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/lib/titleGuess.test.ts
import { describe, expect, it } from 'vitest'
import { guessTitle, lineFontSize, sortByFontSizeDesc } from './titleGuess'
import type { OcrLine, OcrResult } from './ocr/types'

function line(id: string, overrides: Partial<OcrLine> = {}): OcrLine {
  return { id, x: 0, y: 0, w: 10, h: 10, text: `text-${id}`, edited: false, ...overrides }
}

function result(lines: OcrLine[]): OcrResult {
  return { pageId: 'p1', modelVersion: 't', updatedAt: 1, lines }
}

describe('lineFontSize', () => {
  it('returns the shorter side of the bbox regardless of orientation', () => {
    // 横書き想定: 幅が広く高さが文字サイズに近い
    expect(lineFontSize(line('a', { w: 200, h: 24 }))).toBe(24)
    // 縦書き想定: 高さが長く幅が文字サイズに近い
    expect(lineFontSize(line('b', { w: 30, h: 300 }))).toBe(30)
    // 正方形
    expect(lineFontSize(line('c', { w: 40, h: 40 }))).toBe(40)
  })
})

describe('sortByFontSizeDesc', () => {
  it('sorts non-empty lines by font size, largest first', () => {
    const lines = [
      line('small', { w: 100, h: 12, text: '小' }),
      line('large', { w: 100, h: 48, text: '大' }),
      line('mid', { w: 100, h: 24, text: '中' }),
    ]
    const sorted = sortByFontSizeDesc(result(lines))
    expect(sorted.map((l) => l.text)).toEqual(['大', '中', '小'])
  })

  it('drops lines with empty or whitespace-only text', () => {
    const lines = [
      line('empty', { w: 100, h: 999, text: '' }),
      line('blank', { w: 100, h: 999, text: '   ' }),
      line('kept', { w: 100, h: 10, text: '本文' }),
    ]
    expect(sortByFontSizeDesc(result(lines)).map((l) => l.text)).toEqual(['本文'])
  })

  it('is stable (keeps reading order) for equal font sizes', () => {
    const lines = [
      line('first', { w: 100, h: 20, text: '先' }),
      line('second', { w: 20, h: 100, text: '後' }),
    ]
    expect(sortByFontSizeDesc(result(lines)).map((l) => l.text)).toEqual(['先', '後'])
  })

  it('returns an empty array when there is no OCR result', () => {
    expect(sortByFontSizeDesc(undefined)).toEqual([])
  })
})

describe('guessTitle', () => {
  it('picks the text of the largest line', () => {
    const lines = [
      line('sub', { w: 100, h: 14, text: 'サブタイトル' }),
      line('main', { w: 100, h: 60, text: 'メインタイトル' }),
    ]
    expect(guessTitle(result(lines))).toBe('メインタイトル')
  })

  it('returns an empty string when there is nothing to guess from', () => {
    expect(guessTitle(undefined)).toBe('')
    expect(guessTitle(result([]))).toBe('')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/lib/titleGuess.test.ts`
Expected: FAIL — `Cannot find module './titleGuess'` (ファイル未作成)。

- [ ] **Step 3: 最小実装を書く**

```typescript
// src/lib/titleGuess.ts
import type { OcrLine, OcrResult } from './ocr/types'

/**
 * 行の推定文字サイズ。bboxの短い辺を使うことで、横書き(高さ≒文字サイズ)・
 * 縦書き(幅≒文字サイズ)のどちらでも概ね対応できる。
 */
export function lineFontSize(line: OcrLine): number {
  return Math.min(line.w, line.h)
}

/** OCR結果のうちテキストがある行を、推定文字サイズが大きい順に並べる(同点は読み順)。 */
export function sortByFontSizeDesc(result: OcrResult | undefined): OcrLine[] {
  if (!result) return []
  return result.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.text.trim() !== '')
    .sort((a, b) => lineFontSize(b.line) - lineFontSize(a.line) || a.index - b.index)
    .map(({ line }) => line)
}

/** 表紙のOCR結果から、タイトルの初期候補(文字サイズが最大の行のテキスト)を推測する。 */
export function guessTitle(result: OcrResult | undefined): string {
  return sortByFontSizeDesc(result)[0]?.text ?? ''
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx vitest run src/lib/titleGuess.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: コミット**

```bash
git add src/lib/titleGuess.ts src/lib/titleGuess.test.ts
git commit -m "feat: 表紙OCR結果から文字サイズ順にタイトル候補を並べる純関数を追加"
```

---

### Task 2: `TitleStep` コンポーネント

**Files:**
- Create: `src/components/TitleStep.tsx`
- Test: `src/components/TitleStep.test.tsx`
- Modify: `src/index.css` (末尾に `.title-step` 系のスタイルを追加)

**Interfaces:**
- Consumes:
  - Task 1の `sortByFontSizeDesc`, `lineFontSize`(`../lib/titleGuess`)。
  - 既存 `OcrResult`(`../lib/ocr/types`)、`PageEntry`/`BookMetadata`/`RawImage`(`../types`)。
  - 既存 `MetadataForm`(`./MetadataForm`、props: `{ metadata: BookMetadata; onChange: (metadata: BookMetadata) => void }`)をそのまま埋め込む。
  - 既存 `ZoomModal`/`AdjustedPreview`(`./ZoomModal`)。`ZoomModal`のprops: `{ label: string; onClose: () => void; children: ReactNode; sidePanel?: ReactNode }`。`AdjustedPreview`のprops: `{ image: RawImage; adjustment: AdjustmentParams }`。
  - 既存CSSクラス `.chapters-step__thumb-btn`(`src/index.css`)をサムネイルボタンにそのまま流用する(新規クラスを増やさない)。
- Produces: `TitleStep` コンポーネントと `TitleStepProps` 型(Task 3で`App.tsx`から使う)。

```typescript
export interface TitleStepProps {
  /** 表紙とみなす1ページ目。ページが1枚もなければ undefined。 */
  coverPage: PageEntry | undefined
  /** 表紙のサムネイル(なければ img は出さない)。 */
  thumbnail?: string
  /** 表紙のOCR結果(未実施なら undefined)。 */
  ocrResult: OcrResult | undefined
  ocrRunning: boolean
  /** 表紙ページ1枚にOCRをかける。 */
  onRunOcr: () => void
  metadata: BookMetadata
  onChange: (metadata: BookMetadata) => void
  /** 拡大表示用に、指定ページの原本から生成したプレビュー画素を取得する。 */
  getPagePreview: (pageId: string) => Promise<RawImage>
}
```

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/components/TitleStep.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TitleStep, type TitleStepProps } from './TitleStep'
import type { OcrResult } from '../lib/ocr/types'
import type { BookMetadata, PageEntry, RawImage } from '../types'

function coverPage(): PageEntry {
  return {
    id: 'p1',
    order: 0,
    blobId: 'blob-p1',
    fileName: 'cover.jpg',
    width: 100,
    height: 140,
    adjustment: { brightness: 0, contrast: 0 },
  }
}

function ocrOf(texts: { text: string; w: number; h: number }[]): OcrResult {
  return {
    pageId: 'p1',
    modelVersion: 't',
    updatedAt: 1,
    lines: texts.map((t, i) => ({ id: `l${i}`, x: 0, y: i * 10, w: t.w, h: t.h, text: t.text, edited: false })),
  }
}

function setup(overrides: Partial<TitleStepProps> = {}) {
  const props: TitleStepProps = {
    coverPage: coverPage(),
    thumbnail: 'blob:thumb',
    ocrResult: undefined,
    ocrRunning: false,
    onRunOcr: vi.fn(),
    metadata: { title: '', author: '' },
    onChange: vi.fn(),
    getPagePreview: vi.fn(async () => ({ data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1 }) as RawImage),
    ...overrides,
  }
  const view = render(<TitleStep {...props} />)
  return { props, ...view }
}

describe('TitleStep', () => {
  it('shows a message and no crash when there is no cover page', () => {
    setup({ coverPage: undefined })
    expect(screen.getByText(/ページがありません/)).toBeInTheDocument()
  })

  it('auto-fills the title with the largest OCR line when the title is still empty', () => {
    const onChange = vi.fn()
    setup({
      ocrResult: ocrOf([
        { text: 'サブタイトル', w: 100, h: 14 },
        { text: 'メインタイトル', w: 100, h: 60 },
      ]),
      metadata: { title: '', author: '' },
      onChange,
    })
    expect(onChange).toHaveBeenCalledWith({ title: 'メインタイトル', author: '' })
  })

  it('does not overwrite a title the user already set', () => {
    const onChange = vi.fn()
    setup({
      ocrResult: ocrOf([{ text: 'メインタイトル', w: 100, h: 60 }]),
      metadata: { title: '手入力タイトル', author: '' },
      onChange,
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('lists OCR lines largest-first with size labels and lets the user assign title/author', () => {
    const onChange = vi.fn()
    setup({
      ocrResult: ocrOf([
        { text: '著者名', w: 100, h: 20 },
        { text: 'タイトル候補', w: 100, h: 50 },
      ]),
      metadata: { title: 'タイトル候補', author: '' },
      onChange,
    })
    const candidates = screen.getAllByRole('listitem')
    expect(within(candidates[0]).getByText('タイトル候補')).toBeInTheDocument()
    expect(within(candidates[0]).getByText('50px')).toBeInTheDocument()
    expect(within(candidates[1]).getByText('著者名')).toBeInTheDocument()

    fireEvent.click(within(candidates[1]).getByText('著者にする'))
    expect(onChange).toHaveBeenCalledWith({ title: 'タイトル候補', author: '著者名' })
  })

  it('runs OCR on the cover page on demand', () => {
    const onRunOcr = vi.fn()
    setup({ onRunOcr })
    fireEvent.click(screen.getByText('表紙をOCR'))
    expect(onRunOcr).toHaveBeenCalled()
  })

  it('renders the title/author text inputs and forwards edits', () => {
    const onChange = vi.fn()
    setup({ metadata: { title: 'T', author: 'A' }, onChange })
    fireEvent.change(screen.getByTestId('title-input'), { target: { value: 'New' } })
    expect(onChange).toHaveBeenCalledWith({ title: 'New', author: 'A' })
  })
})
```

Note: `within`は`@testing-library/react`からの追加importが必要(上のimport文に`within`を足す)。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/TitleStep.test.tsx`
Expected: FAIL — `Cannot find module './TitleStep'`

- [ ] **Step 3: 最小実装を書く**

```tsx
// src/components/TitleStep.tsx
import { useEffect, useState } from 'react'
import type { OcrResult } from '../lib/ocr/types'
import { lineFontSize, sortByFontSizeDesc } from '../lib/titleGuess'
import type { BookMetadata, PageEntry, RawImage } from '../types'
import { MetadataForm } from './MetadataForm'
import { AdjustedPreview, ZoomModal } from './ZoomModal'

export interface TitleStepProps {
  coverPage: PageEntry | undefined
  thumbnail?: string
  ocrResult: OcrResult | undefined
  ocrRunning: boolean
  onRunOcr: () => void
  metadata: BookMetadata
  onChange: (metadata: BookMetadata) => void
  getPagePreview: (pageId: string) => Promise<RawImage>
}

// 1ページ目を表紙と仮定し、そのOCR結果から文字サイズが最大の行をタイトルの
// 初期候補として自動的に入れる。タイトルが既に入力済みなら上書きしない。
export function TitleStep({
  coverPage,
  thumbnail,
  ocrResult,
  ocrRunning,
  onRunOcr,
  metadata,
  onChange,
  getPagePreview,
}: TitleStepProps) {
  const [zoomOpen, setZoomOpen] = useState(false)
  const [zoomImage, setZoomImage] = useState<RawImage | null>(null)
  const [zoomError, setZoomError] = useState<string | null>(null)

  useEffect(() => {
    setZoomImage(null)
    setZoomError(null)
    if (!zoomOpen || !coverPage) return
    let cancelled = false
    getPagePreview(coverPage.id)
      .then((image) => {
        if (!cancelled) setZoomImage(image)
      })
      .catch(() => {
        if (!cancelled) setZoomError('画像の読み込みに失敗しました')
      })
    return () => {
      cancelled = true
    }
  }, [zoomOpen, coverPage, getPagePreview])

  useEffect(() => {
    if (metadata.title !== '') return
    const guess = sortByFontSizeDesc(ocrResult)[0]?.text ?? ''
    if (guess !== '') onChange({ ...metadata, title: guess })
  }, [ocrResult, metadata, onChange])

  if (!coverPage) {
    return (
      <div className="panel">
        <p>ページがありません。「読み込み」工程で画像を追加してください。</p>
      </div>
    )
  }

  const candidates = sortByFontSizeDesc(ocrResult)

  return (
    <div className="title-step">
      <div className="panel">
        <h2>表紙</h2>
        <div className="title-step__cover">
          {thumbnail && (
            <button
              type="button"
              className="chapters-step__thumb-btn"
              aria-label="表紙を拡大表示"
              onClick={() => setZoomOpen(true)}
            >
              <img src={thumbnail} alt="" />
            </button>
          )}
          <button type="button" className="btn btn-ghost" disabled={ocrRunning} onClick={onRunOcr}>
            {ocrResult ? '表紙を再OCR' : '表紙をOCR'}
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>候補(文字サイズが大きい順)</h2>
        {candidates.length === 0 && <p>OCR結果がありません。表紙をOCRしてください。</p>}
        {candidates.length > 0 && (
          <ul className="title-step__candidates">
            {candidates.map((line) => (
              <li key={line.id} className="title-step__candidate">
                <span className="title-step__candidate-text">{line.text}</span>
                <span className="title-step__candidate-size">{`${lineFontSize(line)}px`}</span>
                <button
                  type="button"
                  className={metadata.title === line.text ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => onChange({ ...metadata, title: line.text })}
                >
                  タイトルにする
                </button>
                <button
                  type="button"
                  className={metadata.author === line.text ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => onChange({ ...metadata, author: line.text })}
                >
                  著者にする
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <MetadataForm metadata={metadata} onChange={onChange} />

      {zoomOpen && (
        <ZoomModal
          label={coverPage.fileName ?? `page ${coverPage.order + 1}`}
          onClose={() => setZoomOpen(false)}
        >
          {zoomImage ? (
            <AdjustedPreview image={zoomImage} adjustment={coverPage.adjustment} />
          ) : zoomError ? (
            <p>{zoomError}</p>
          ) : (
            <div className="thumb-modal__loading">loading...</div>
          )}
        </ZoomModal>
      )}
    </div>
  )
}
```

Also fix the test file's `within` import (add it to the `@testing-library/react` import line before running):

```typescript
import { render, screen, fireEvent, within } from '@testing-library/react'
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx vitest run src/components/TitleStep.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: CSSを追加する**

`src/index.css` の末尾(`.chapters-step__thumb-btn:hover { ... }` の直後)に追記する:

```css
.title-step { display: flex; flex-direction: column; gap: 1rem; }
.title-step__cover { display: flex; align-items: center; gap: 0.75rem; }
.title-step__cover img { width: 96px; height: auto; }
.title-step__candidates { display: flex; flex-direction: column; gap: 0.5rem; padding: 0; margin: 0.5rem 0 0; list-style: none; }

.title-step__candidate {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-divider);
  border-radius: 4px;
}

.title-step__candidate-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-step__candidate-size {
  color: var(--color-text-muted);
  font-size: 0.8rem;
  flex: none;
}
```

- [ ] **Step 6: 一覧表示を目視確認するため dev サーバーで軽く確認(任意)し、テストとlintを再実行する**

Run: `npx vitest run src/components/TitleStep.test.tsx src/lib/titleGuess.test.ts && npm run lint`
Expected: 全てPASS

- [ ] **Step 7: コミット**

```bash
git add src/components/TitleStep.tsx src/components/TitleStep.test.tsx src/index.css
git commit -m "feat: 表紙OCRの補助でタイトル・著者を設定するTitleStepコンポーネントを追加"
```

---

### Task 3: `App.tsx` にステップを組み込む

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 2の `TitleStep`/`TitleStepProps`(`./components/TitleStep`)。既存の `book.pages`, `book.thumbnails`, `book.metadata`, `book.setMetadata`, `book.getPagePreview`(`useBook`)、`ocr.results`, `ocr.running`, `ocr.runOne`(`useOcr`、`runOne(pageId: string, opts?: RunOptions) => Promise<RunSummary>`)。
- Produces: 更新後の `STEPS` 配列(6要素)とステップindexの対応関係(Task 4のautomationApi更新で参照する):
  - 0: 読み込み
  - 1: 並べ替え・調整
  - 2: OCR確認・修正
  - 3: タイトルの設定 (NEW)
  - 4: 目次の作成 (旧3から繰り下げ)
  - 5: 詳細＆書き出し (旧4から繰り下げ、`MetadataForm`はここから削除)

- [ ] **Step 1: `STEPS` 配列と、`step===3`(旧目次)/`step===4`(旧書き出し)ブロックのstep番号を更新する**

`src/App.tsx:17` を変更:

```typescript
const STEPS = ['読み込み', '並べ替え・調整', 'OCR確認・修正', 'タイトルの設定', '目次の作成', '詳細＆書き出し'] as const
```

`src/App.tsx:165-193`(ナビゲーションの`step === 2`/`step === 3`/`step === 4`ブロック)を、新しい`step === 3`(タイトルの設定)を挟むかたちに書き換える:

```tsx
{step === 2 && (
  <>
    <button type="button" className="btn btn-primary" onClick={() => goTo(3)}>
      タイトルの設定へ進む
    </button>
    {/* 目次の作成も任意工程。既存の章立ては消さずに書き出しへ進む。 */}
    <button type="button" className="btn btn-ghost" onClick={() => goTo(5)}>
      目次の作成をスキップして書き出しへ
    </button>
    <button type="button" className="btn btn-ghost" onClick={() => goTo(1)}>
      戻る
    </button>
  </>
)}
{step === 3 && (
  <>
    <button type="button" className="btn btn-primary" onClick={() => goTo(4)}>
      目次の作成へ進む
    </button>
    <button type="button" className="btn btn-ghost" onClick={() => goTo(2)}>
      戻る
    </button>
  </>
)}
{step === 4 && (
  <>
    <button type="button" className="btn btn-primary" onClick={() => goTo(5)}>
      詳細情報へ進む
    </button>
    <button type="button" className="btn btn-ghost" onClick={() => goTo(3)}>
      戻る
    </button>
  </>
)}
{step === 5 && (
  <button type="button" className="btn btn-ghost" onClick={() => goTo(4)}>
    目次の作成へ戻る
  </button>
)}
```

- [ ] **Step 2: ステップ本体(`step-content`)を更新する**

`import { TitleStep } from './components/TitleStep'` を先頭のimportに追加(`import { ChaptersStep } from './components/ChaptersStep'` の直後)。

旧`{step === 3 && <ChaptersStep .../>}`ブロックを`step === 4`に、旧`{step === 4 && (<><MetadataForm .../><ExportPanel .../></>)}`を`step === 5`(かつ`MetadataForm`を削除)に変更し、間に新しい`step === 3`ブロックを挿入する:

```tsx
{step === 3 && (
  <TitleStep
    coverPage={book.pages[0]}
    thumbnail={book.pages[0] ? book.thumbnails[book.pages[0].id] : undefined}
    ocrResult={book.pages[0] ? ocr.results[book.pages[0].id] : undefined}
    ocrRunning={ocr.running}
    onRunOcr={() => {
      const cover = book.pages[0]
      if (cover) void ocr.runOne(cover.id)
    }}
    metadata={book.metadata}
    onChange={book.setMetadata}
    getPagePreview={book.getPagePreview}
  />
)}

{step === 4 && (
  <ChaptersStep
    pages={book.pages}
    thumbnails={book.thumbnails}
    ocrResults={ocr.results}
    ocrRunning={ocr.running}
    onRunOcr={(ids) => void ocr.runAll(ids, { skipDone: true })}
    chapters={chapters.chapters}
    onChange={(next) => chapters.setChapters(next).catch(() => {})}
    getPagePreview={book.getPagePreview}
    onUpdateOcrLine={(pageId, lineId, text) => void ocr.updateLine(pageId, lineId, text)}
    onDeleteOcrLine={(pageId, lineId) => void ocr.deleteLine(pageId, lineId)}
    onMoveOcrLine={(pageId, lineId, toIndex) => void ocr.moveLine(pageId, lineId, toIndex)}
  />
)}

{step === 5 && (
  <ExportPanel
    onExport={book.exportBook}
    title={book.metadata.title}
    chapterCount={chapters.chapters.length}
  />
)}
```

`MetadataForm`のimport(`src/App.tsx:8`)は`TitleStep`が内部で使うため、`App.tsx`からは不要になり削除する(未使用importでlintが落ちるため)。

- [ ] **Step 3: 型チェック・lintを実行する**

Run: `npm run typecheck && npm run lint`
Expected: エラーなし(未使用import・型不一致がないこと)

- [ ] **Step 4: 既存テストを実行して壊れていないことを確認する**

Run: `npx vitest run`
Expected: 既存の全テストがPASS(App.tsxを直接テストするファイルがなければスキップでよい。もし`App.test.tsx`が存在すればステップ番号のアサーションを本タスクの新番号に合わせて更新する)

- [ ] **Step 5: 動作確認(dev サーバー)**

Run: `npm run dev` を起動し、ブラウザで画像を1枚以上読み込んで「OCR確認・修正」の次に「タイトルの設定」ステップが表示されること、表紙をOCRするとタイトル欄に候補が自動で入ること、候補ボタンで著者にも設定できることを確認する。確認後、devサーバーは停止する。

- [ ] **Step 6: コミット**

```bash
git add src/App.tsx
git commit -m "feat: タイトルの設定ステップをウィザードに組み込む"
```

---

### Task 4: automationApi のステップ説明を更新する

**Files:**
- Modify: `src/lib/automationApi.ts:68`

**Interfaces:**
- Consumes: Task 3で確定したステップ番号対応表。
- Produces: 更新された`goToStep`の説明文字列(型シグネチャ自体は変更しない)。

- [ ] **Step 1: `goToStep` の説明文を新しいステップ番号に合わせて書き換える**

`src/lib/automationApi.ts:68` を変更:

```typescript
    goToStep: '(step: number) => void — 工程(0:読み込み, 1:並べ替え・調整, 2:OCR確認・修正, 3:タイトルの設定, 4:目次の作成, 5:詳細＆書き出し)を切り替える。OCRと目次の作成は任意工程で、飛ばして5に進んでもよい。',
```

- [ ] **Step 2: automationApi関連のテストがあれば実行する**

Run: `npx vitest run src/lib/automationApi.test.ts`(該当ファイルが存在する場合のみ)
Expected: PASS。存在しなければ`npm run typecheck`のみで確認する。

- [ ] **Step 3: コミット**

```bash
git add src/lib/automationApi.ts
git commit -m "docs: automationApiのgoToStep説明をタイトルの設定ステップ追加後の番号に合わせる"
```

---

### Task 5: 全体の最終検証

**Files:**
- (変更なし。検証のみ)

**Interfaces:**
- Consumes: Task 1〜4の全成果物。
- Produces: なし(検証タスク)。

- [ ] **Step 1: フルテストスイートを実行する**

Run: `npm test`
Expected: 全テストPASS

- [ ] **Step 2: 型チェックとビルドを実行する**

Run: `npm run typecheck && npm run build`
Expected: エラーなくビルド成功

- [ ] **Step 3: lintを実行する**

Run: `npm run lint`
Expected: エラーなし

- [ ] **Step 4: (任意)e2eの該当シナリオを確認する**

`e2e/`配下にウィザードのステップ遷移を検証するテストがあれば、ステップ番号がずれていないか確認し、必要ならステップindexのアサーションを更新する。

Run: `npm run test:e2e`
Expected: PASS(既存シナリオがステップ番号に依存していた場合は本タスクで修正する)

- [ ] **Step 5: コミット(検証のみで差分があれば)**

差分がなければコミット不要。e2eの番号修正等の差分があれば:

```bash
git add e2e/
git commit -m "test: e2eのステップ番号をタイトルの設定ステップ追加後の番号に合わせる"
```
