import type { OcrResult } from './ocr/types'

/** 書籍順のページ列から、OCR済みページの行テキストを連結する。ページ間は空行。 */
export function buildPlainText(
  pages: { id: string }[],
  results: Record<string, OcrResult>,
): string {
  const blocks: string[] = []
  for (const p of pages) {
    const r = results[p.id]
    if (!r) continue
    const text = r.lines
      .map((l) => l.text)
      .filter((t) => t !== '')
      .join('\n')
    blocks.push(text)
  }
  return blocks.join('\n\n')
}
