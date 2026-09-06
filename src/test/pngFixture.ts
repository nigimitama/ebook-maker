// 手組みした正しい2x1 PNG(赤1画素、緑1画素)。計画策定時にpdf-libの
// embedPngで読めることを確認済み。pdfExport.test.ts / epubExport.test.ts /
// exportCore.test.ts で共有し、フィクスチャのバイト列とデコーダの定義を
// 1箇所にまとめている。
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII='

export function decodeBase64Png(): Uint8Array {
  const binary = atob(TINY_PNG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
