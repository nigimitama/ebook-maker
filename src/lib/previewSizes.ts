// プレビューはスキャン画像の実サイズよりはるかに小さく描画される
// (サムネイルは高さ約140px、調整キャンバスは幅数百px)。この上限は各プレビューが
// 抱える画素データの長辺を制限するためのもので、122x140のサムネイルを描くために
// 2480x3508のスキャンをフルデコードする事態を防ぐ。
//
// 表示専用 — 見開き結合と書き出しは原本のblobを使い続ける。
export const THUMBNAIL_MAX_EDGE = 320
export const PREVIEW_MAX_EDGE = 1200

// width x height を maxEdge の正方形に収める(アスペクト比は維持)。
// 拡大はしない: 上限より小さい画像はそのまま返す。
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
