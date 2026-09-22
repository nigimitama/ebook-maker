import type { Box, OcrLine } from './ocr/types'

export interface OcrParagraph {
  /** 段落の代表key(先頭行のid)。Reactのkey等に使う。 */
  id: string
  text: string
  lines: OcrLine[]
  /** 所属する行の外接矩形(原本画像のpx座標)。拡大表示の枠に使う。 */
  box: Box
}

function unionBox(lines: OcrLine[]): Box {
  const x0 = Math.min(...lines.map((l) => l.x))
  const y0 = Math.min(...lines.map((l) => l.y))
  const x1 = Math.max(...lines.map((l) => l.x + l.w))
  const y1 = Math.max(...lines.map((l) => l.y + l.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
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
      box: unionBox(groupLines),
    }
  })
}
