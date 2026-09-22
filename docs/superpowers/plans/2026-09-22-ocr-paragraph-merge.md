# OCR段落結合(ブロックbbox活用) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DEIMのレイアウト検出が出力する段落・カラム境界(`text_block`, classId 0)を捨てずに使い、OCR行を段落単位でグループ化して、テキスト書き出しとOCR確認画面のプレビューで段落として連結表示する。

**Architecture:** `decodeDetections`が行bboxに加えてブロックbboxも返すようにし、`readingOrder.ts`の読み順アルゴリズムを上流(`ndlocrlite-web`)のXY-Cut(2Dグリッド上のヒストグラムの空白帯で再帰分割)に置き換える。各行の中心点が収まるブロックへ割り当て、割当率が70%未満ならブロックを使わずXY-Cutのみで並べる(上流と同じフォールバック)。割り当てたブロックIDを`OcrLine.blockId`として保存し、`buildParagraphs`という純関数で「同じblockIdの行を読み順に空文字連結した段落」を導出する。保存データは行のまま(段落は導出値)なので、既存の行単位の編集UIには影響しない。

**Tech Stack:** TypeScript, Vitest, React 19 (既存スタックのまま)

**Spec:** `docs/superpowers/specs/2026-09-22-ocr-paragraph-merge-design.md`

## Global Constraints

- `OcrLine.blockId`は任意項目(後方互換。IndexedDBのバージョン変更・移行は不要)。
- ブロック(`text_block`)は上下パディング拡張をせず、NMSもかけない(行だけ既存どおり2%拡張・NMS)。
- ブロック割当率が70%未満、または`blocks`が空なら、ブロックを使わず全行にXY-Cutをそのままかける(`blockId: null`)。
- 段落内のテキスト連結は空文字連結(語間スペースを入れない)。
- 保存データ(`OcrResult.lines`)の形は変えない。段落は書き出し・プレビュー時に`buildParagraphs`でその都度導出する。
- UI文言・コードコメントは日本語(既存に合わせる)。lintは`npm run lint`(oxlint)、型検査は`npm run typecheck`。`npm test`は型検査しないので、変更のたびに`npm run typecheck`も実行する。
- 対象外: 段落bboxの画像オーバーレイ、段落単位の編集、英語混じりテキストの語間スペース補完、`window.EbookMaker`への段落API追加、`ChaptersStep`の拡大モーダルOCRパネルへの段落表示。

---

## Task 1: XY-Cutエンジン(純関数)

**Files:**
- Create: `src/lib/ocr/xyCut.ts`
- Test: `src/lib/ocr/xyCut.test.ts`

**Interfaces:**
- Consumes: `Box`(`src/lib/ocr/types.ts`、既存: `{ x: number; y: number; w: number; h: number }`)
- Produces: `rankByXYCut(boxes: Box[]): number[]` — 入力と同じ長さの順位配列(値が小さいほど先に読む。同順位はない)。Task 3で使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ocr/xyCut.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rankByXYCut } from './xyCut'
import type { Box } from './types'

const b = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })

describe('rankByXYCut', () => {
  it('空配列は空配列を返す', () => {
    expect(rankByXYCut([])).toEqual([])
  })

  it('1個は0を返す', () => {
    expect(rankByXYCut([b(0, 0, 10, 10)])).toEqual([0])
  })

  it('横書き2行(上下に離れている)は上が先', () => {
    const top = b(0, 10, 300, 20)
    const bottom = b(0, 100, 300, 20)
    const ranks = rankByXYCut([bottom, top])
    // bottomが先頭に渡っているが、rankはtop<bottomになるはず
    expect(ranks[1]).toBeLessThan(ranks[0])
  })

  it('縦書き2列(左右に離れている、縦長の箱)は右の列が先', () => {
    const left = b(10, 0, 20, 300)
    const right = b(100, 0, 20, 300)
    const ranks = rankByXYCut([left, right])
    // 縦長の箱が過半数 -> 縦書き扱い。x分割ノードは右→左の順に並ぶ。
    expect(ranks[1]).toBeLessThan(ranks[0])
  })

  it('4箱(2行×2列)には重複のない順位が付く', () => {
    // このケースは分割順(先にX軸で割るかY軸で割るか)によって具体的な順序が
    // 変わりうる(どちらで割っても「読み順として妥当」ではあるが、一意に
    // 決め打てない)。ここでは「境界の妥当性」(0..3の順位が重複なく付くこと)
    // だけを確認する。読み順の具体的な正しさは横書き2行・縦書き2列の
    // 単純ケース(このファイルの他のテスト)で担保する。
    const boxes = [
      b(200, 100, 100, 20),
      b(0, 0, 100, 20),
      b(0, 100, 100, 20),
      b(200, 0, 100, 20),
    ]
    const ranks = rankByXYCut(boxes)
    expect(new Set(ranks).size).toBe(4)
    expect([...ranks].sort((a, c) => a - c)).toEqual([0, 1, 2, 3])
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/ocr/xyCut.test.ts`
Expected: FAIL(`./xyCut`が存在しない)

- [ ] **Step 3: 実装する**

`src/lib/ocr/xyCut.ts`:

```ts
import type { Box } from './types'

// ページを2Dグリッド(短辺を100目盛りに正規化)に投影し、x/yヒストグラムの
// 最大ゼロ区間(=空白帯)を検出して再帰的に分割する読み順推定(XY-Cut)。
// 移植元: ndlocrlite-web (Yuta Hashimoto, CC BY 4.0, コミット50216cc固定)の
// src/worker/reading-order.ts、さらに参照実装
// ndlocr-lite/src/reading_order/xy_cut/block_xy_cut.py 由来。

const GRID = 100

interface XYNode {
  x0: number
  y0: number
  x1: number
  y1: number
  children: XYNode[]
  boxIndices: number[]
  numBoxes: number
  numVerticalBoxes: number
  isXSplit: boolean // true = 左右分割、false = 上下分割
}

function makeNode(x0: number, y0: number, x1: number, y1: number): XYNode {
  return {
    x0,
    y0,
    x1,
    y1,
    children: [],
    boxIndices: [],
    numBoxes: 0,
    numVerticalBoxes: 0,
    isXSplit: false,
  }
}

function toRawBbox(b: Box): [number, number, number, number] {
  return [b.x, b.y, b.x + b.w, b.y + b.h]
}

// bboxes を [0, GRID] の整数グリッドにスケーリングする(短辺にGRIDを割り当て、長辺はアスペクト比を維持)。
function normalizeBboxes(bboxes: number[][]): { normBboxes: number[][]; w: number; h: number } {
  const xMin = Math.min(...bboxes.map((b) => b[0]))
  const yMin = Math.min(...bboxes.map((b) => b[1]))
  const xMax = Math.max(...bboxes.map((b) => b[2]))
  const yMax = Math.max(...bboxes.map((b) => b[3]))
  const wPage = xMax - xMin
  const hPage = yMax - yMin
  if (wPage === 0 || hPage === 0) {
    // 全箱が同一座標: 正規化不能 -> そのまま返す。
    return { normBboxes: bboxes.map(() => [0, 0, 1, 1]), w: 2, h: 2 }
  }
  const isPortrait = hPage >= wPage
  const xGrid = isPortrait ? GRID * (wPage / hPage) : GRID
  const yGrid = isPortrait ? GRID : GRID * (hPage / wPage)
  const w = Math.ceil(xGrid) + 1
  const h = Math.ceil(yGrid) + 1
  const normBboxes = bboxes.map((b) => {
    const nx0 = Math.max(0, Math.floor(((b[0] - xMin) * xGrid) / wPage))
    const ny0 = Math.max(0, Math.floor(((b[1] - yMin) * yGrid) / hPage))
    const nx1 = Math.min(w - 1, Math.ceil(((b[2] - xMin) * xGrid) / wPage))
    const ny1 = Math.min(h - 1, Math.ceil(((b[3] - yMin) * yGrid) / hPage))
    return [nx0, ny0, Math.max(nx0 + 1, nx1), Math.max(ny0 + 1, ny1)]
  })
  return { normBboxes, w, h }
}

// 正規化済みbboxesをw×hの0/1二値テーブルに描画する。
function makeMeshTable(bboxes: number[][], w: number, h: number): number[][] {
  const table: number[][] = Array.from({ length: h }, () => new Array(w).fill(0))
  for (const [x0, y0, x1, y1] of bboxes) {
    for (let y = y0; y < Math.min(y1, h); y += 1) {
      for (let x = x0; x < Math.min(x1, w); x += 1) {
        table[y][x] = 1
      }
    }
  }
  return table
}

// 領域[x0,y0,x1,y1]内のx方向(列和)・y方向(行和)ヒストグラムを計算する。
function calcHist(
  table: number[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { xHist: number[]; yHist: number[] } {
  const xHist = new Array(x1 - x0).fill(0)
  const yHist = new Array(y1 - y0).fill(0)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const v = table[y][x]
      xHist[x - x0] += v
      yHist[y - y0] += v
    }
  }
  return { xHist, yHist }
}

// ヒストグラムの最小値が連続する最長区間(=最大の空白帯)を返す。
// 戻り値: [区間開始, 区間終了, スコア]。スコアは小さいほど明確な空白。
function calcMinSpan(hist: number[]): [number, number, number] {
  if (hist.length <= 1) return [0, hist.length, 0]
  const minVal = Math.min(...hist)
  const maxVal = Math.max(...hist)
  let bestStart = 0
  let bestEnd = 0
  let bestLen = 0
  let gapStart = -1
  for (let i = 0; i <= hist.length; i += 1) {
    if (i < hist.length && hist[i] === minVal) {
      if (gapStart === -1) gapStart = i
    } else {
      if (gapStart !== -1) {
        const len = i - gapStart
        if (len > bestLen) {
          bestLen = len
          bestStart = gapStart
          bestEnd = i
        }
        gapStart = -1
      }
    }
  }
  const score = maxVal > 0 ? -minVal / maxVal : 0
  return [bestStart, bestEnd, score]
}

function addChildAndCut(
  table: number[][],
  parent: XYNode,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  if (x0 >= x1 || y0 >= y1) return
  // 親ノードと同一領域なら追加しない(無限ループ防止)。
  if (x0 === parent.x0 && y0 === parent.y0 && x1 === parent.x1 && y1 === parent.y1) return
  const child = makeNode(x0, y0, x1, y1)
  parent.children.push(child)
  xyCut(table, child)
}

// 左・ギャップ・右の3ノードを追加して再帰する。
function splitX(table: number[][], parent: XYNode, gapX0: number, gapX1: number): void {
  parent.isXSplit = true
  const { x0, y0, x1, y1 } = parent
  addChildAndCut(table, parent, x0, y0, gapX0, y1)
  addChildAndCut(table, parent, gapX0, y0, gapX1, y1)
  addChildAndCut(table, parent, gapX1, y0, x1, y1)
}

// 上・ギャップ・下の3ノードを追加して再帰する。
function splitY(table: number[][], parent: XYNode, gapY0: number, gapY1: number): void {
  parent.isXSplit = false
  const { x0, y0, x1, y1 } = parent
  addChildAndCut(table, parent, x0, y0, x1, gapY0)
  addChildAndCut(table, parent, x0, gapY0, x1, gapY1)
  addChildAndCut(table, parent, x0, gapY1, x1, y1)
}

function xyCut(table: number[][], node: XYNode): void {
  const { x0, y0, x1, y1 } = node
  if (x0 >= x1 || y0 >= y1) return
  const { xHist, yHist } = calcHist(table, x0, y0, x1, y1)
  let [xBeg, xEnd, xVal] = calcMinSpan(xHist)
  let [yBeg, yEnd, yVal] = calcMinSpan(yHist)
  xBeg += x0
  xEnd += x0
  yBeg += y0
  yEnd += y0
  // 全域と一致する場合(分割不能) -> 再帰終了。
  if (x0 === xBeg && x1 === xEnd && y0 === yBeg && y1 === yEnd) return
  if (yVal < xVal) {
    splitX(table, node, xBeg, xEnd)
  } else if (xVal < yVal) {
    splitY(table, node, yBeg, yEnd)
  } else if (xEnd - xBeg < yEnd - yBeg) {
    splitY(table, node, yBeg, yEnd)
  } else {
    splitX(table, node, xBeg, xEnd)
  }
}

function collectLeaves(node: XYNode): XYNode[] {
  if (node.children.length === 0) return [node]
  return node.children.flatMap((c) => collectLeaves(c))
}

function calcIou(a: number[], b: number[]): number {
  const ix0 = Math.max(a[0], b[0])
  const iy0 = Math.max(a[1], b[1])
  const ix1 = Math.min(a[2], b[2])
  const iy1 = Math.min(a[3], b[3])
  const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0)
  if (inter === 0) return 0
  const areaA = (a[2] - a[0]) * (a[3] - a[1])
  const areaB = (b[2] - b[0]) * (b[3] - b[1])
  return inter / (areaA + areaB - inter)
}

// 各bboxを最大IoUの葉ノードに割り当てる。
function assignBboxToNode(root: XYNode, bboxes: number[][]): void {
  const leaves = collectLeaves(root)
  const leafBboxes = leaves.map((l) => [l.x0, l.y0, l.x1, l.y1])
  for (let i = 0; i < bboxes.length; i += 1) {
    let bestJ = 0
    let bestIou = -1
    for (let j = 0; j < leafBboxes.length; j += 1) {
      const v = calcIou(bboxes[i], leafBboxes[j])
      if (v > bestIou) {
        bestIou = v
        bestJ = j
      }
    }
    leaves[bestJ].boxIndices.push(i)
  }
}

// 縦長の箱が過半数なら縦書きとみなす。
function isVertical(node: XYNode): boolean {
  return node.numBoxes < node.numVerticalBoxes * 2
}

// 各ノード内のboxIndicesとchildrenをソートし、縦書きのx分割ノードは逆順(右→左)にする。
function sortNodes(node: XYNode, bboxes: number[][]): [number, number] {
  if (node.boxIndices.length > 0) {
    const indices = node.boxIndices
    node.numBoxes = indices.length
    node.numVerticalBoxes = indices.filter((i) => {
      const b = bboxes[i]
      return b[2] - b[0] < b[3] - b[1] // width < height
    }).length
    if (indices.length > 1) {
      const vert = isVertical(node)
      indices.sort((a, b) => {
        const ba = bboxes[a]
        const bb = bboxes[b]
        // 縦書き: x降順 y昇順、横書き: y昇順 x昇順。
        if (vert) return ba[0] !== bb[0] ? bb[0] - ba[0] : ba[1] - bb[1]
        return ba[1] !== bb[1] ? ba[1] - bb[1] : ba[0] - bb[0]
      })
    }
  } else {
    for (const child of node.children) {
      const [n, v] = sortNodes(child, bboxes)
      node.numBoxes += n
      node.numVerticalBoxes += v
    }
    if (node.isXSplit && isVertical(node)) {
      node.children.reverse()
    }
  }
  return [node.numBoxes, node.numVerticalBoxes]
}

// 深さ優先でrankを付番する。
function getRanking(node: XYNode, ranks: number[], rank: number): number {
  let next = rank
  for (const i of node.boxIndices) {
    ranks[i] = next
    next += 1
  }
  for (const child of node.children) {
    next = getRanking(child, ranks, next)
  }
  return next
}

/**
 * XY-Cutで箱の読み順を推定する。戻り値は入力と同じ長さの順位配列
 * (値が小さいほど先に読む。同順位はない)。
 */
export function rankByXYCut(boxes: Box[]): number[] {
  if (boxes.length === 0) return []
  if (boxes.length === 1) return [0]
  const rawBboxes = boxes.map(toRawBbox)
  const { normBboxes, w, h } = normalizeBboxes(rawBboxes)
  const table = makeMeshTable(normBboxes, w, h)
  const root = makeNode(0, 0, w, h)
  xyCut(table, root)
  assignBboxToNode(root, normBboxes)
  sortNodes(root, normBboxes)
  const ranks = new Array(boxes.length).fill(-1)
  getRanking(root, ranks, 0)
  return ranks
}
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/lib/ocr/xyCut.test.ts && npm run typecheck`
Expected: PASS(5ケース全て)。

- [ ] **Step 5: コミット**

```bash
git add src/lib/ocr/xyCut.ts src/lib/ocr/xyCut.test.ts
git commit -m "feat: XY-Cutによる読み順推定エンジンを追加する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: レイアウト検出がブロックbboxも返すようにする

**Files:**
- Modify: `src/lib/ocr/layoutPost.ts`
- Modify: `src/lib/ocr/layoutPost.test.ts`

**Interfaces:**
- Consumes: `OCR_CONFIG.layout.blockClassId`(既存定数、`src/lib/ocr/ocrConfig.ts`ですでに`0`として定義済み、これまで未使用)
- Produces: `interface DetectionResult { lines: Detection[]; blocks: Box[] }`、`decodeDetections(...): DetectionResult`(戻り値の形が`Detection[]`から変わる)。Task 4で使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ocr/layoutPost.test.ts`を全文置き換える(`decodeDetections`の戻り値が`{lines, blocks}`になったことに合わせて既存アサーションを更新し、ブロック抽出のケースを追加する):

```ts
import { describe, it, expect } from 'vitest'
import { decodeDetections, nms } from './layoutPost'
import type { Detection } from './types'

const det = (x: number, y: number, w: number, h: number, score: number): Detection => ({
  x,
  y,
  w,
  h,
  score,
  classId: 1,
})

describe('nms', () => {
  it('IoUが閾値を超える低スコアの箱は落ちる', () => {
    const hi = det(0, 0, 100, 100, 0.9)
    const lo = det(5, 5, 100, 100, 0.5)
    expect(nms([lo, hi], 0.5)).toEqual([hi])
  })
  it('離れた2箱は両方残る', () => {
    const a = det(0, 0, 50, 50, 0.9)
    const b = det(200, 200, 50, 50, 0.8)
    expect(nms([a, b], 0.5)).toHaveLength(2)
  })
})

describe('decodeDetections', () => {
  // ラベルは1始まり。label-1 の class が lineClassIds(1,2,3,4,5,16) なら行、0はtext_block。
  const base = (over: Partial<Parameters<typeof decodeDetections>[0]> = {}) => ({
    boxes: new Float32Array([0, 0, 100, 40]),
    scores: new Float32Array([0.9]),
    classIds: new BigInt64Array([2n]), // class 1 = line_main
    ...over,
  })

  it('スコアが閾値(0.3)未満の検出は除外する', () => {
    const raw = base({
      boxes: new Float32Array([0, 0, 100, 40, 0, 100, 100, 140]),
      scores: new Float32Array([0.2, 0.9]),
      classIds: new BigInt64Array([2n, 2n]),
    })
    const out = decodeDetections(raw, 1, 1000, 1000)
    expect(out.lines).toHaveLength(1)
    expect(out.lines[0].score).toBeCloseTo(0.9)
  })
  it('scaleで割って原本座標へ戻す', () => {
    const raw = base({ boxes: new Float32Array([0, 200, 200, 400]) })
    const [o] = decodeDetections(raw, 0.5, 1000, 1000).lines
    expect(o.x).toBeCloseTo(0)
    expect(o.w).toBeCloseTo(400)
    // 高さ400に対し上下2%(8px)拡張
    expect(o.y).toBeCloseTo(400 - 8)
    expect(o.h).toBeCloseTo(400 + 16)
  })
  it('画像外にはみ出た箱を画像内に丸める', () => {
    const raw = base({ boxes: new Float32Array([-30, -30, 5000, 5000]) })
    const [o] = decodeDetections(raw, 1, 300, 200).lines
    expect(o).toMatchObject({ x: 0, y: 0, w: 300, h: 200 })
  })
  it('行クラスはclassIdをlabel-1で持ち、ブロックはlinesに入らない', () => {
    const raw = base({
      boxes: new Float32Array([0, 0, 100, 40, 0, 100, 100, 140]),
      scores: new Float32Array([0.9, 0.9]),
      classIds: new BigInt64Array([1n, 17n]), // class 0=text_block, class 16=title(行)
    })
    const out = decodeDetections(raw, 1, 1000, 1000)
    expect(out.lines).toHaveLength(1)
    expect(out.lines[0].classId).toBe(16)
  })
  it('Int32Arrayのclass idも受け付ける', () => {
    const out = decodeDetections(base({ classIds: new Int32Array([2]) }), 1, 1000, 1000)
    expect(out.lines).toHaveLength(1)
  })
  it('10px未満の箱は捨てる', () => {
    const raw = base({ boxes: new Float32Array([0, 0, 5, 5]) })
    expect(decodeDetections(raw, 1, 1000, 1000).lines).toEqual([])
  })
  it('char_count(int64)をnumberのcharCountとして付ける', () => {
    const out = decodeDetections(base({ charCounts: new BigInt64Array([3n]) }), 1, 1000, 1000)
    expect(out.lines[0].charCount).toBe(3)
    expect(typeof out.lines[0].charCount).toBe('number')
  })
  it('char_countが無ければcharCountはundefined', () => {
    const [o] = decodeDetections(base(), 1, 1000, 1000).lines
    expect(o.charCount).toBeUndefined()
  })

  it('text_block(classId 0)はblocksに入り、パディング拡張されない', () => {
    const raw = base({
      boxes: new Float32Array([0, 200, 200, 400]), // label1 -> classId0 = text_block
      scores: new Float32Array([0.9]),
      classIds: new BigInt64Array([1n]),
    })
    const out = decodeDetections(raw, 0.5, 1000, 1000)
    expect(out.lines).toEqual([])
    expect(out.blocks).toEqual([{ x: 0, y: 400, w: 400, h: 400 }])
  })
  it('10px未満のブロックは捨てる', () => {
    const raw = base({
      boxes: new Float32Array([0, 0, 5, 5]),
      classIds: new BigInt64Array([1n]),
    })
    expect(decodeDetections(raw, 1, 1000, 1000).blocks).toEqual([])
  })
  it('ブロックにはNMSをかけない(重なっていても両方残る)', () => {
    const raw = base({
      boxes: new Float32Array([0, 0, 100, 100, 5, 5, 105, 105]),
      scores: new Float32Array([0.9, 0.8]),
      classIds: new BigInt64Array([1n, 1n]),
    })
    expect(decodeDetections(raw, 1, 1000, 1000).blocks).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/ocr/layoutPost.test.ts`
Expected: FAIL(`out.lines`が`undefined`になる、`out.blocks`が無い等)

- [ ] **Step 3: 実装する**

`src/lib/ocr/layoutPost.ts`を全文置き換える:

```ts
import { OCR_CONFIG } from './ocrConfig'
import type { Box, Detection } from './types'

function iou(a: Detection, b: Detection): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const inter = ix * iy
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

// スコア降順に貪欲に採用し、採用済みとIoUが閾値を超える箱を捨てる。
export function nms(dets: Detection[], iouThreshold: number): Detection[] {
  const sorted = dets.slice().sort((a, b) => b.score - a.score)
  const kept: Detection[] = []
  for (const d of sorted) {
    if (kept.every((k) => iou(k, d) <= iouThreshold)) kept.push(d)
  }
  return kept
}

export interface DetectionResult {
  lines: Detection[]
  /** text_block(段・カラム境界)。パディング拡張・NMSはかけない。 */
  blocks: Box[]
}

// DEIMの生出力を原本座標のDetectionにする。
// - class = label-1(labelは1始まり)
// - 行クラス(lineClassIds)は上下2%拡張してNMSの対象にする。
// - ブロック(blockClassId=text_block、段境界)は拡張せず別枠のblocksとして返す。
// - char_count は int64 なので BigInt64Array で受け、Number() に変換する。
export function decodeDetections(
  raw: {
    boxes: Float32Array
    scores: Float32Array
    classIds: Int32Array | BigInt64Array
    charCounts?: BigInt64Array
  },
  scale: number,
  imgW: number,
  imgH: number,
): DetectionResult {
  const { scoreThreshold, lineBoxPadRatio, minBoxPx, lineClassIds, blockClassId } = OCR_CONFIG.layout
  const lineIds: readonly number[] = lineClassIds
  const lines: Detection[] = []
  const blocks: Box[] = []
  for (let i = 0; i < raw.scores.length; i += 1) {
    const score = raw.scores[i]
    if (score < scoreThreshold) continue
    const classId = Number(raw.classIds[i]) - 1
    const x1raw = raw.boxes[i * 4] / scale
    const y1raw = raw.boxes[i * 4 + 1] / scale
    const x2raw = raw.boxes[i * 4 + 2] / scale
    const y2raw = raw.boxes[i * 4 + 3] / scale

    if (classId === blockClassId) {
      const bx1 = Math.max(0, x1raw)
      const by1 = Math.max(0, y1raw)
      const bx2 = Math.min(imgW, x2raw)
      const by2 = Math.min(imgH, y2raw)
      const bw = bx2 - bx1
      const bh = by2 - by1
      if (bw < minBoxPx || bh < minBoxPx) continue
      blocks.push({ x: bx1, y: by1, w: bw, h: bh })
      continue
    }
    if (!lineIds.includes(classId)) continue
    // 行bboxは上下を2%拡張してから画像内に丸める。
    const pad = (y2raw - y1raw) * lineBoxPadRatio
    const cx1 = Math.max(0, x1raw)
    const cy1 = Math.max(0, y1raw - pad)
    const cx2 = Math.min(imgW, x2raw)
    const cy2 = Math.min(imgH, y2raw + pad)
    const w = cx2 - cx1
    const h = cy2 - cy1
    if (w < minBoxPx || h < minBoxPx) continue
    const det: Detection = { x: cx1, y: cy1, w, h, score, classId }
    if (raw.charCounts) det.charCount = Number(raw.charCounts[i])
    lines.push(det)
  }
  return { lines, blocks }
}
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/lib/ocr/layoutPost.test.ts && npm run typecheck`
Expected: PASS。`npm run typecheck`はこの時点で`ocrPipeline.ts`が`decodeDetections`の戻り値を配列として使っている箇所でエラーになる想定(Task 4で直す)。このタスクではエラーが出ていることだけ確認し、直すのはTask 4で行う。

- [ ] **Step 5: コミット**

```bash
git add src/lib/ocr/layoutPost.ts src/lib/ocr/layoutPost.test.ts
git commit -m "feat: レイアウト検出がtext_block(段境界)のbboxも返すようにする

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: ブロック割当てと読み順(readingOrder.ts)

**Files:**
- Modify: `src/lib/ocr/readingOrder.ts`
- Modify: `src/lib/ocr/readingOrder.test.ts`

**Interfaces:**
- Consumes: `rankByXYCut`(Task 1)、`Detection`・`Box`(既存)
- Produces: `interface OrderedDetection { detection: Detection; blockId: string | null }`、`sortReadingOrder(dets: Detection[], blocks?: Box[]): OrderedDetection[]`(シグネチャ・戻り値が変わる)。Task 4で使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ocr/readingOrder.test.ts`を全文置き換える:

```ts
import { describe, it, expect } from 'vitest'
import { sortReadingOrder } from './readingOrder'

const d = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, score: 1, classId: 1 })

describe('sortReadingOrder without blocks', () => {
  it('縦書き(細長い行)は右の行から左へ、同じ列なら上から', () => {
    const left = d(10, 0, 20, 300)
    const right = d(100, 0, 20, 300)
    expect(sortReadingOrder([left, right]).map((o) => o.detection)).toEqual([right, left])
  })
  it('横書き(平たい行)は上の行から下へ、同じ行なら左から', () => {
    const top = d(0, 10, 300, 20)
    const bottom = d(0, 100, 300, 20)
    expect(sortReadingOrder([bottom, top]).map((o) => o.detection)).toEqual([top, bottom])
  })
  it('空配列は空配列を返す', () => {
    expect(sortReadingOrder([])).toEqual([])
  })
  it('blocksを渡さない/空なら全行のblockIdはnull', () => {
    const top = d(0, 10, 300, 20)
    const bottom = d(0, 100, 300, 20)
    const result = sortReadingOrder([top, bottom])
    expect(result.every((o) => o.blockId === null)).toBe(true)
  })
})

describe('sortReadingOrder with blocks', () => {
  it('2カラムを別ブロックとして割り当て、ブロックごとに読み順をまとめる', () => {
    // 左カラム: 上下2行(小さい間隔)。右カラム: 上下2行。列間は大きく離す。
    // グループ(ブロック)のbboxが横長(w>h)になるようにする
    // (縦長だとXY-Cutが縦書きと誤判定し、列の順序が右→左に反転してしまうため)。
    const leftTop = d(0, 0, 100, 20)
    const leftBottom = d(0, 30, 100, 20)
    const rightTop = d(300, 0, 100, 20)
    const rightBottom = d(300, 30, 100, 20)
    const leftBlock = { x: 0, y: 0, w: 100, h: 50 }
    const rightBlock = { x: 300, y: 0, w: 100, h: 50 }
    const result = sortReadingOrder(
      [rightBottom, leftBottom, rightTop, leftTop],
      [leftBlock, rightBlock],
    )
    // 同じブロックの行は同じblockId、異なるブロックは異なるblockId(順序は問わない)。
    const leftIds = new Set(
      result.filter((o) => o.detection === leftTop || o.detection === leftBottom).map((o) => o.blockId),
    )
    const rightIds = new Set(
      result.filter((o) => o.detection === rightTop || o.detection === rightBottom).map((o) => o.blockId),
    )
    expect(leftIds.size).toBe(1)
    expect(rightIds.size).toBe(1)
    expect([...leftIds][0]).not.toBeNull()
    expect([...leftIds][0]).not.toBe([...rightIds][0])
    // 列内は上→下、列間は左→右(このジオメトリでは一意に決まるはずだが、
    // XY-Cutのグリッド量子化の具合で列の順序が変わったら、このtoEqualだけ
    // 実際の出力に合わせて直してよい。blockIdの分離・非nullは必ず保つこと)。
    expect(result.map((o) => o.detection)).toEqual([leftTop, leftBottom, rightTop, rightBottom])
  })

  it('どのブロックにも中心が収まらない行は独立した1行ブロックになる(割当率70%以上を維持)', () => {
    // 4行中3行がブロックに収まる(75% >= 70%)。1行だけだと閾値を割ってフォールバックしてしまう。
    const in1 = d(0, 0, 100, 20)
    const in2 = d(0, 30, 100, 20)
    const in3 = d(0, 60, 100, 20)
    const outside = d(500, 500, 100, 20)
    const block = { x: 0, y: 0, w: 100, h: 80 }
    const result = sortReadingOrder([outside, in3, in2, in1], [block])
    const outsideEntry = result.find((o) => o.detection === outside)!
    const insideEntries = result.filter((o) => o.detection !== outside)
    expect(insideEntries).toHaveLength(3)
    expect(new Set(insideEntries.map((o) => o.blockId)).size).toBe(1)
    expect(insideEntries[0].blockId).not.toBeNull()
    expect(outsideEntry.blockId).toBeNull()
  })

  it('割当率が70%未満ならブロックを使わずフォールバックする(全行blockId: null)', () => {
    // 3行のうち1行しかブロックに収まらない(33% < 70%)。
    const a = d(0, 0, 100, 20)
    const b = d(0, 100, 100, 20)
    const c = d(0, 200, 100, 20)
    const onlyCoversA = { x: 0, y: 0, w: 100, h: 20 }
    const result = sortReadingOrder([a, b, c], [onlyCoversA])
    expect(result.every((o) => o.blockId === null)).toBe(true)
    expect(result.map((o) => o.detection)).toEqual([a, b, c])
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/ocr/readingOrder.test.ts`
Expected: FAIL(現行の`sortReadingOrder`は`Detection[]`をそのまま返すため、`.detection`アクセスが`undefined`になる)

- [ ] **Step 3: 実装する**

`src/lib/ocr/readingOrder.ts`を全文置き換える:

```ts
import { rankByXYCut } from './xyCut'
import type { Box, Detection } from './types'

// 割当率がこの値未満ならブロックを使わずフォールバックする(上流と同じ閾値)。
const BLOCK_COVERAGE_THRESHOLD = 0.7

export interface OrderedDetection {
  detection: Detection
  /** 所属ブロックのID(ページ内で一意)。ブロック未使用/割当なしならnull。 */
  blockId: string | null
}

function centerIn(det: Detection, block: Box): boolean {
  const cx = det.x + det.w / 2
  const cy = det.y + det.h / 2
  return cx >= block.x && cx <= block.x + block.w && cy >= block.y && cy <= block.y + block.h
}

function unionBox(dets: Detection[]): Box {
  const x0 = Math.min(...dets.map((d) => d.x))
  const y0 = Math.min(...dets.map((d) => d.y))
  const x1 = Math.max(...dets.map((d) => d.x + d.w))
  const y1 = Math.max(...dets.map((d) => d.y + d.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// 全行にXY-Cutをそのままかける(ブロック不使用時のフォールバック)。
function sortWithoutBlocks(dets: Detection[]): OrderedDetection[] {
  const ranks = rankByXYCut(dets)
  return dets
    .map((detection, i) => ({ detection, blockId: null as string | null, rank: ranks[i] }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ detection, blockId }) => ({ detection, blockId }))
}

/**
 * 検出した行をブロック(段・カラム境界)に割り当て、ブロック間→ブロック内の順に
 * XY-Cutで読み順を決める。DEIMのtext_block出力を使う上流(ndlocrlite-web)の
 * reading-order.tsと同じ方針: 割当率が70%未満ならブロックを使わず、
 * 全行にXY-Cutをそのままかける。
 */
export function sortReadingOrder(dets: Detection[], blocks: Box[] = []): OrderedDetection[] {
  if (dets.length === 0) return []
  if (blocks.length === 0) return sortWithoutBlocks(dets)

  const assigned = new Map<number, number[]>() // blockIndex -> det index[]
  const unassigned: number[] = []
  dets.forEach((det, i) => {
    const blockIndex = blocks.findIndex((b) => centerIn(det, b))
    if (blockIndex === -1) {
      unassigned.push(i)
      return
    }
    if (!assigned.has(blockIndex)) assigned.set(blockIndex, [])
    assigned.get(blockIndex)!.push(i)
  })

  const coveredCount = dets.length - unassigned.length
  if (coveredCount < dets.length * BLOCK_COVERAGE_THRESHOLD) {
    return sortWithoutBlocks(dets)
  }

  interface Group {
    indices: number[]
    bbox: Box
    blockId: string | null
  }
  const groups: Group[] = []
  let blockSeq = 0
  for (const indices of assigned.values()) {
    groups.push({ indices, bbox: unionBox(indices.map((i) => dets[i])), blockId: `block-${blockSeq}` })
    blockSeq += 1
  }
  for (const i of unassigned) {
    groups.push({ indices: [i], bbox: dets[i], blockId: null })
  }

  const groupRanks = rankByXYCut(groups.map((g) => g.bbox))
  const orderedGroups = groups
    .map((g, i) => ({ ...g, rank: groupRanks[i] }))
    .sort((a, b) => a.rank - b.rank)

  const result: OrderedDetection[] = []
  for (const group of orderedGroups) {
    if (group.indices.length === 1) {
      result.push({ detection: dets[group.indices[0]], blockId: group.blockId })
      continue
    }
    const groupDets = group.indices.map((i) => dets[i])
    const withinRanks = rankByXYCut(groupDets)
    const orderedIndices = group.indices
      .map((idx, k) => ({ idx, rank: withinRanks[k] }))
      .sort((a, b) => a.rank - b.rank)
      .map((x) => x.idx)
    for (const idx of orderedIndices) {
      result.push({ detection: dets[idx], blockId: group.blockId })
    }
  }
  return result
}
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/lib/ocr/readingOrder.test.ts && npm run typecheck`
Expected: PASS。`npm run typecheck`は`ocrPipeline.ts`側のエラーが残ったままでよい(Task 4で直す)。

- [ ] **Step 5: コミット**

```bash
git add src/lib/ocr/readingOrder.ts src/lib/ocr/readingOrder.test.ts
git commit -m "feat: ブロック割当てとXY-Cutで読み順を決めるようにする

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: OcrLineにblockIdを持たせる(型・パイプライン配線)

**Files:**
- Modify: `src/lib/ocr/types.ts`
- Modify: `src/lib/ocr/ocrPipeline.ts`
- Modify: `src/lib/ocr/ocrPipeline.test.ts`

**Interfaces:**
- Consumes: `DetectionResult`(Task 2)、`OrderedDetection`/`sortReadingOrder`(Task 3)
- Produces: `OcrLine.blockId?: string`。Task 5で使う。

- [ ] **Step 1: 型を変更する**

`src/lib/ocr/types.ts`の`OcrLine`を変更:

```ts
export interface OcrLine extends Box {
  id: string
  text: string
  edited: boolean
  /** 読み順推定で割り当てたブロック(段落)ID。手動追加した行やブロック未使用時はundefined。 */
  blockId?: string
}
```

- [ ] **Step 2: 失敗するテストを書く**

`src/lib/ocr/ocrPipeline.test.ts`の既存の1つ目のテスト(`'読み順に並んだ2行・期待テキスト・edited:false・一意なidを返す'`)に、末尾でアサーションを1つ追加する(このテストのraw検出には`classId 0`の`text_block`が含まれないので、`blocks`は空になり、`blockId`は両方`undefined`になるはず):

```ts
    expect(result.lines[1].y).toBeCloseTo(100 - 40 * 0.02, 5)
    // ブロック検出が無い(rawにtext_blockを含めていない)ので、blockIdは付かない。
    expect(result.lines.every((l) => l.blockId === undefined)).toBe(true)
```

続けて、同じ`describe('runOcr', ...)`ブロックの末尾に新しいテストを追加する。画像は既存のテストと同じ`img`(400x200, scale=800/400=2)を使い、上下2行を両方とも1つのtext_blockに収める(この画像・スケールでの座標変換は既存テストのコメントと同じ考え方):

```ts
  it('text_blockに収まる行には同じblockIdを付ける', async () => {
    // 上下2行(既存テストと同じ座標)を、それを覆うtext_block(原本座標で
    // x:0..400, y:0..150 = raw値 0,0,800,300)に収める。
    const rawWithBlock = {
      boxes: new Float32Array([
        20 * 2, 20 * 2, 300 * 2, 60 * 2, // 上の行(y=20..60)
        20 * 2, 100 * 2, 300 * 2, 140 * 2, // 下の行(y=100..140)
        0, 0, 800, 300, // text_block本体(label1 -> classId0、原本座標でy=0..150)
      ]),
      scores: new Float32Array([0.95, 0.9, 0.9]),
      classIds: new BigInt64Array([2n, 2n, 1n]),
      charCounts: new BigInt64Array([2n, 3n]),
    }
    const sessions: OcrSessions = {
      detect: async () => rawWithBlock,
      recognize: async () => ({ logits: logitsFor([0], vocab), seqLen: 1, vocab }),
    }
    const result = await runOcr(img, sessions, charset)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].blockId).toBeDefined()
    expect(result.lines[0].blockId).toBe(result.lines[1].blockId)
  })
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run src/lib/ocr/ocrPipeline.test.ts`
Expected: FAIL(`decodeDetections`の戻り値の扱いが古いままで型エラー、または`blockId`が無い)

- [ ] **Step 4: 実装する**

`src/lib/ocr/ocrPipeline.ts`の`runOcr`本体を変更する(import文と関数本体を以下に置き換え):

```ts
import type { RawImage } from '../../types'
import { letterboxToTensor } from './layoutPre'
import { decodeDetections, nms } from './layoutPost'
import { OCR_CONFIG, type RecognizerKey } from './ocrConfig'
import { sortReadingOrder } from './readingOrder'
import { cropLine, lineToTensor } from './recognizePre'
import { decodeSequence, pickRecognizer } from './recognizePost'
import type { OcrLine, OcrResult } from './types'

// ONNXセッションをここで抽象化する。実体は Worker 側で ort から作り、
// テストでは偽のセッションを差し込む(runOcr 自体は ort に依存しない)。
export interface OcrSessions {
  detect(
    tensor: Float32Array,
    size: number,
  ): Promise<{
    boxes: Float32Array
    scores: Float32Array
    classIds: Int32Array | BigInt64Array
    charCounts?: BigInt64Array
  }>
  recognize(
    key: RecognizerKey,
    tensor: Float32Array,
  ): Promise<{ logits: Float32Array; seqLen: number; vocab: number }>
}

let idCounter = 0
function newLineId(): string {
  idCounter += 1
  return `line-${Date.now()}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`
}

// 1ページ分のOCR。レイアウト検出 -> 行の抽出・ブロック割当て -> 読み順 -> 行ごとの文字認識。
// 行ごとに逐次実行する(同時実行するとメモリを食うため。バッチ化はしない)。
export async function runOcr(
  img: RawImage,
  sessions: OcrSessions,
  charset: string[],
): Promise<Omit<OcrResult, 'pageId' | 'modelVersion' | 'updatedAt'>> {
  const size = OCR_CONFIG.layout.inputSize
  const { data, scale } = letterboxToTensor(img, size)
  const raw = await sessions.detect(data, size)
  const { lines: dets, blocks } = decodeDetections(raw, scale, img.width, img.height)
  const ordered = sortReadingOrder(nms(dets, OCR_CONFIG.layout.nmsIou), blocks)

  const lines: OcrLine[] = []
  for (const { detection: det, blockId } of ordered) {
    const key = pickRecognizer(det.charCount, det)
    const spec = OCR_CONFIG.recognizers[key]
    const tensor = lineToTensor(cropLine(img, det), spec.height, spec.width)
    const { logits, seqLen, vocab } = await sessions.recognize(key, tensor)
    lines.push({
      id: newLineId(),
      x: det.x,
      y: det.y,
      w: det.w,
      h: det.h,
      text: decodeSequence(logits, seqLen, vocab, charset),
      edited: false,
      ...(blockId ? { blockId } : {}),
    })
  }
  return { lines }
}
```

- [ ] **Step 5: 通過を確認する**

Run: `npx vitest run src/lib/ocr/ocrPipeline.test.ts && npm run typecheck`
Expected: PASS(型エラーもすべて解消)。Step 2で追加したテストの`recognize`実装が型に合っているか確認し、合っていなければ`{ logits: logitsFor([0], vocab), seqLen: 1, vocab }`だけを返す形に直すこと。

- [ ] **Step 6: コミット**

```bash
git add src/lib/ocr/types.ts src/lib/ocr/ocrPipeline.ts src/lib/ocr/ocrPipeline.test.ts
git commit -m "feat: OCR行にブロック(段落)IDを付けるようパイプラインを配線する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: 段落結合(buildParagraphs)

**Files:**
- Create: `src/lib/paragraphs.ts`
- Test: `src/lib/paragraphs.test.ts`

**Interfaces:**
- Consumes: `OcrLine`(Task 4で`blockId`追加済み)
- Produces: `interface OcrParagraph { id: string; text: string; lines: OcrLine[] }`、`buildParagraphs(lines: OcrLine[]): OcrParagraph[]`。Task 6・7で使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/paragraphs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildParagraphs } from './paragraphs'
import type { OcrLine } from './ocr/types'

function line(id: string, text: string, blockId?: string): OcrLine {
  return { id, x: 0, y: 0, w: 1, h: 1, text, edited: false, ...(blockId ? { blockId } : {}) }
}

describe('buildParagraphs', () => {
  it('同じblockIdの行を読み順に空文字連結して1段落にする', () => {
    const lines = [line('a', '吾輩は猫である。名前はまだ', 'b1'), line('b', '無い。', 'b1')]
    expect(buildParagraphs(lines)).toEqual([
      { id: 'a', text: '吾輩は猫である。名前はまだ無い。', lines },
    ])
  })

  it('blockIdが無い行はそれぞれ独立した段落にする', () => {
    const lines = [line('a', '一行目'), line('b', '二行目')]
    expect(buildParagraphs(lines)).toEqual([
      { id: 'a', text: '一行目', lines: [lines[0]] },
      { id: 'b', text: '二行目', lines: [lines[1]] },
    ])
  })

  it('段落の並びは各グループの先頭行が現れる位置で決まる', () => {
    const lines = [line('a', 'A', 'b1'), line('x', 'X'), line('b', 'B', 'b1')]
    const result = buildParagraphs(lines)
    expect(result.map((p) => p.id)).toEqual(['a', 'x'])
    expect(result[0].text).toBe('AB')
    expect(result[0].lines).toEqual([lines[0], lines[2]])
  })

  it('行が空配列なら空配列を返す', () => {
    expect(buildParagraphs([])).toEqual([])
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/paragraphs.test.ts`
Expected: FAIL(`./paragraphs`が存在しない)

- [ ] **Step 3: 実装する**

`src/lib/paragraphs.ts`:

```ts
import type { OcrLine } from './ocr/types'

export interface OcrParagraph {
  /** 段落の代表key(先頭行のid)。Reactのkey等に使う。 */
  id: string
  text: string
  lines: OcrLine[]
}

/**
 * 行を段落(同じblockId)ごとにまとめ、読み順(配列の並び)のまま連結する。
 * blockIdが無い行(枠を追加した行など)は単独の段落として扱う。
 * 段落の並び順は各グループの先頭行(最初に現れる行)の位置で決まるので、
 * 編集で同じblockIdの行が配列内で分断されても、グループとしては結合される。
 * 段落内のテキストは空文字連結(日本語の行送りは語間空白が不要なため)。
 */
export function buildParagraphs(lines: OcrLine[]): OcrParagraph[] {
  const order: string[] = []
  const groups = new Map<string, OcrLine[]>()
  for (const line of lines) {
    const key = line.blockId ?? line.id
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(line)
  }
  return order.map((key) => {
    const groupLines = groups.get(key)!
    return {
      id: groupLines[0].id,
      text: groupLines.map((l) => l.text).join(''),
      lines: groupLines,
    }
  })
}
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/lib/paragraphs.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/paragraphs.ts src/lib/paragraphs.test.ts
git commit -m "feat: OCR行をブロック単位で段落に結合するbuildParagraphsを追加する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: テキスト書き出しを段落単位にする

**Files:**
- Modify: `src/lib/ocrText.ts`
- Modify: `src/lib/ocrText.test.ts`

**Interfaces:**
- Consumes: `buildParagraphs`(Task 5)
- Produces: `buildPlainText`の内部実装のみ変更(シグネチャ・既存の呼び出し元は無変更)

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/ocrText.test.ts`の`describe('buildPlainText', ...)`ブロックの末尾に追加する(既存の2ケースはそのまま残す):

```ts
  it('同じブロックの行は改行を入れずに連結する', () => {
    const withBlock: OcrResult = {
      pageId: 'a',
      modelVersion: 'v',
      updatedAt: 1,
      lines: [
        { id: 'a0', x: 0, y: 0, w: 1, h: 1, text: '吾輩は猫である。名前はまだ', edited: false, blockId: 'b1' },
        { id: 'a1', x: 0, y: 0, w: 1, h: 1, text: '無い。', edited: false, blockId: 'b1' },
      ],
    }
    expect(buildPlainText([{ id: 'a' }], { a: withBlock })).toBe('吾輩は猫である。名前はまだ無い。')
  })
```

このテストを使うには、ファイル先頭の`import type { OcrResult } from './ocr/types'`がすでにあることを確認する(既存の`res()`ヘルパーの型で使われているはず)。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/ocrText.test.ts`
Expected: FAIL(現在は行ごとに`\n`で連結するので`'吾輩は猫である。名前はまだ\n無い。'`になる)

- [ ] **Step 3: 実装する**

`src/lib/ocrText.ts`の`buildPlainText`を変更する:

```ts
import type { OcrResult } from './ocr/types'
import { buildParagraphs } from './paragraphs'

/** 書籍順のページ列から、OCR済みページの段落テキストを連結する。ページ間は空行。 */
export function buildPlainText(
  pages: { id: string }[],
  results: Record<string, OcrResult>,
): string {
  const blocks: string[] = []
  for (const p of pages) {
    const r = results[p.id]
    if (!r) continue
    const text = buildParagraphs(r.lines)
      .map((paragraph) => paragraph.text)
      .filter((t) => t !== '')
      .join('\n')
    if (text === '') continue
    blocks.push(text)
  }
  return blocks.join('\n\n')
}
```

(`hasOcrText`・`ocrFileName`は変更しない。)

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/lib/ocrText.test.ts && npm run typecheck`
Expected: PASS(既存の2ケースも含めて全て通ること。`blockId`の無い行は`buildParagraphs`で1行=1段落になるため、既存の期待値は変わらない)

- [ ] **Step 5: コミット**

```bash
git add src/lib/ocrText.ts src/lib/ocrText.test.ts
git commit -m "feat: テキスト書き出しを段落単位で連結する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: 段落プレビューコンポーネント

**Files:**
- Create: `src/components/OcrParagraphList.tsx`
- Test: `src/components/OcrParagraphList.test.tsx`

**Interfaces:**
- Consumes: `buildParagraphs`(Task 5)、`OcrLine`(既存)
- Produces: `OcrParagraphList`コンポーネント。Task 8で使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/OcrParagraphList.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OcrParagraphList } from './OcrParagraphList'
import type { OcrLine } from '../lib/ocr/types'

function line(id: string, text: string, blockId?: string): OcrLine {
  return { id, x: 0, y: 0, w: 1, h: 1, text, edited: false, ...(blockId ? { blockId } : {}) }
}

describe('OcrParagraphList', () => {
  it('同じブロックの行を1つの段落として表示する', () => {
    render(
      <OcrParagraphList
        lines={[line('a', '吾輩は猫である。名前はまだ', 'b1'), line('b', '無い。', 'b1')]}
      />,
    )
    expect(screen.getByText('吾輩は猫である。名前はまだ無い。')).toBeInTheDocument()
  })

  it('ブロックが無い行はそれぞれ別の段落として表示する', () => {
    render(<OcrParagraphList lines={[line('a', '一行目'), line('b', '二行目')]} />)
    expect(screen.getByText('一行目')).toBeInTheDocument()
    expect(screen.getByText('二行目')).toBeInTheDocument()
  })

  it('行が無ければ未OCRの案内を出す', () => {
    render(<OcrParagraphList lines={[]} />)
    expect(screen.getByText('このページはまだOCRされていません。')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/OcrParagraphList.test.tsx`
Expected: FAIL(`./OcrParagraphList`が存在しない)

- [ ] **Step 3: 実装する**

`src/components/OcrParagraphList.tsx`:

```tsx
import type { OcrLine } from '../lib/ocr/types'
import { buildParagraphs } from '../lib/paragraphs'

export interface OcrParagraphListProps {
  lines: OcrLine[]
}

// OCR結果を段落単位(同じブロックの行を読み順に連結したもの)で表示する、
// 読み取り専用のプレビュー。行ごとの修正はOcrLineList(行ごと表示)で行う。
export function OcrParagraphList({ lines }: OcrParagraphListProps) {
  const paragraphs = buildParagraphs(lines)
  if (paragraphs.length === 0) {
    return <p className="ocr-review__empty">このページはまだOCRされていません。</p>
  }
  return (
    <div className="ocr-paragraphs">
      {paragraphs.map((p) => (
        <p key={p.id} className="ocr-paragraphs__item">
          {p.text}
        </p>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/components/OcrParagraphList.test.tsx && npm run typecheck`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/OcrParagraphList.tsx src/components/OcrParagraphList.test.tsx
git commit -m "feat: OCR結果の段落プレビューコンポーネントを追加する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: OCR確認画面に段落プレビューの切り替えを追加する

**Files:**
- Modify: `src/components/OcrReview.tsx`
- Modify: `src/components/OcrReview.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `OcrParagraphList`(Task 7)
- Produces: `OcrReview`に表示切り替えUIを追加(propsは変更しない)

- [ ] **Step 1: 失敗するテストを書く**

`src/components/OcrReview.test.tsx`には既に`page(id, order)`ヘルパー、`pages = [page('a', 0), page('b', 1), page('c', 2)]`、`thumbnails`、`makeOcr(over: Partial<UseOcrResult> = {})`(内部で`results: {}`をデフォルトに持つ)が定義済み。行のテキストは`<textarea>`の値として描画されるため、`screen.getByDisplayValue(...)`で取得する(既存テストの慣習どおり)。

ファイル末尾の`describe`ブロックの閉じ`})`の直前に、次のテストを追加する:

```tsx
  it('「段落プレビュー」に切り替えると段落結合した文字列を表示し、「行ごと」に戻せる', () => {
    const resultWithBlock: OcrResult = {
      pageId: 'a',
      modelVersion: 'v',
      updatedAt: 1,
      lines: [
        { id: 'l1', x: 0, y: 0, w: 1, h: 1, text: '吾輩は猫である。名前はまだ', edited: false, blockId: 'b1' },
        { id: 'l2', x: 0, y: 0, w: 1, h: 1, text: '無い。', edited: false, blockId: 'b1' },
      ],
    }
    render(
      <OcrReview
        pages={pages}
        thumbnails={thumbnails}
        selectedPageId="a"
        selectedImage={null}
        onSelect={() => {}}
        ocr={makeOcr({ results: { a: resultWithBlock } })}
      />,
    )
    expect(screen.getByDisplayValue('吾輩は猫である。名前はまだ')).toBeInTheDocument()
    fireEvent.click(screen.getByText('段落プレビュー'))
    expect(screen.getByText('吾輩は猫である。名前はまだ無い。')).toBeInTheDocument()
    fireEvent.click(screen.getByText('行ごと'))
    expect(screen.getByDisplayValue('吾輩は猫である。名前はまだ')).toBeInTheDocument()
  })
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/components/OcrReview.test.tsx`
Expected: FAIL(「段落プレビュー」ボタンが存在しない)

- [ ] **Step 3: 実装する**

`src/components/OcrReview.tsx`の変更点:

1. importに追加:

```ts
import { OcrParagraphList } from './OcrParagraphList'
```

2. コンポーネント内、`const [selectedLineId, setSelectedLineId] = useState<string | null>(null)`の直後に追加:

```ts
  const [viewMode, setViewMode] = useState<'lines' | 'paragraphs'>('lines')
```

3. `.ocr-review__lines panel`のブロックを次のように置き換える:

```tsx
        <div className="ocr-review__lines panel">
          {result ? (
            <>
              <div className="ocr-review__view-toggle" role="group" aria-label="表示切り替え">
                <button
                  type="button"
                  className={viewMode === 'lines' ? 'btn btn-primary' : 'btn btn-ghost'}
                  aria-pressed={viewMode === 'lines'}
                  onClick={() => setViewMode('lines')}
                >
                  行ごと
                </button>
                <button
                  type="button"
                  className={viewMode === 'paragraphs' ? 'btn btn-primary' : 'btn btn-ghost'}
                  aria-pressed={viewMode === 'paragraphs'}
                  onClick={() => setViewMode('paragraphs')}
                >
                  段落プレビュー
                </button>
              </div>
              {viewMode === 'lines' ? (
                <OcrLineList
                  lines={lines}
                  selectedLineId={selectedLineId}
                  onSelectLine={setSelectedLineId}
                  registerTextareaRef={(id, el) => {
                    if (el) textareas.current.set(id, el)
                    else textareas.current.delete(id)
                  }}
                  onCommit={(lineId, text) => void ocr.updateLine(page!.id, lineId, text)}
                  onDelete={(lineId) => void ocr.deleteLine(page!.id, lineId)}
                  onMove={(lineId, to) => void ocr.moveLine(page!.id, lineId, to)}
                />
              ) : (
                <OcrParagraphList lines={lines} />
              )}
            </>
          ) : (
            <p className="ocr-review__empty">このページはまだOCRされていません。</p>
          )}
        </div>
```

- [ ] **Step 4: CSSを追加する**

`src/index.css`の`.ocr-review__attribution`の直前に追加:

```css
.ocr-review__view-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.ocr-paragraphs__item {
  padding: 8px 0;
  border-bottom: 1px solid var(--color-divider);
  white-space: pre-wrap;
  word-break: break-word;
}
```

- [ ] **Step 5: 通過を確認する**

Run: `npx vitest run src/components/OcrReview.test.tsx && npm run typecheck && npm run lint`
Expected: PASS。既存の`OcrReview.test.tsx`のテスト(行の選択・編集・削除・並べ替え等)がすべて引き続き通ること(「行ごと」がデフォルトの`viewMode`なので、既存テストは変更なしで通るはず)。

- [ ] **Step 6: コミット**

```bash
git add src/components/OcrReview.tsx src/components/OcrReview.test.tsx src/index.css
git commit -m "feat: OCR確認画面に段落プレビューの切り替えを追加する

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: 全体検証

**Files:** なし(検証のみ。失敗があれば該当タスクのファイルを直す)

- [ ] **Step 1: 型・lint・単体テスト・ビルドを通す**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: すべて成功。失敗があれば、出力を読んで原因のタスクに戻って直す(テストの期待値を安易に緩めない)。

- [ ] **Step 2: 既存のOCR関連テストへの影響を確認する**

Run: `npx vitest run src/lib/ocr src/lib/ocrText.test.ts src/lib/paragraphs.test.ts src/components/OcrReview.test.tsx src/components/OcrParagraphList.test.tsx src/components/OcrLineList.test.tsx`
Expected: 全て通過。特に`readingOrder.test.ts`の縦書き/横書きの単純ケースがXY-Cutでも既存の期待どおりの順序になっていることを確認する(Task 3のStep 4で既に確認済みのはずだが、他タスクの変更の影響がないか最終確認する)。

- [ ] **Step 3: 結果を報告する**

確認できた項目と、確認できなかった項目(実ブラウザでの通し確認をしていない場合はその旨)を、そのまま報告する。ブラウザでの確認は必須ではない(OCRモデルの実推論が絡むテストではなく、既存のfake-based単体テストで挙動を担保しているため)。
