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
