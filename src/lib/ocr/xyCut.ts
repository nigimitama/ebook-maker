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
