import type { Detection } from './types'

// 行の縦横比の多数決で縦書き/横書きを判定し、その向きの読み順に並べる。
// 列/行の中心が多少ずれても同じ列/行として扱うため、比較関数ではなく
// 「主軸で並べてから、行/列の太さの半分以内を同じ群としてまとめる」方式にする
// (許容つきの比較関数は推移律を満たさず、ソート結果が不安定になるため)。
export function sortReadingOrder(dets: Detection[]): Detection[] {
  if (dets.length === 0) return []
  const tall = dets.filter((b) => b.h > b.w).length > dets.length / 2
  // 縦書きは右→左に列を、横書きは上→下に行を辿る。center が群を分ける主軸。
  const center = (b: Detection) => (tall ? b.x + b.w / 2 : b.y + b.h / 2)
  const thickness = (b: Detection) => (tall ? b.w : b.h)
  const sign = tall ? -1 : 1
  const primary = dets.slice().sort((a, b) => sign * (center(a) - center(b)))

  const widths = dets.map(thickness).sort((a, b) => a - b)
  const tolerance = widths[Math.floor(widths.length / 2)] / 2

  const groups: Detection[][] = []
  let anchor = 0
  for (const b of primary) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(center(b) - anchor) < tolerance) {
      last.push(b)
    } else {
      groups.push([b])
      anchor = center(b)
    }
  }
  // 群の中は副軸(縦書きは上→下、横書きは左→右)で並べる
  return groups.flatMap((g) => g.sort((a, b) => (tall ? a.y - b.y : a.x - b.x)))
}
