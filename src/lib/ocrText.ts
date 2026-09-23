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

/** 書き出せる(空でない)テキストが1行でもあるか。 */
export function hasOcrText(pages: { id: string }[], results: Record<string, OcrResult>): boolean {
  return buildPlainText(pages, results) !== ''
}

/** 書名からテキストのファイル名を作る。使えない文字・ドットだけ・空は 'ocr' に落とす。 */
export function ocrFileName(title?: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (title ?? '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim()
  return `${/^\.*$/.test(base) ? 'ocr' : base}.txt`
}
