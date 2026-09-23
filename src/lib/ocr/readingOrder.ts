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
