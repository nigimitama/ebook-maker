// 手組みした正しい1x1 JPEG(ベースラインDCT)。pdf-libのembedJpgで
// 読めることを構造検証済み(SOI/APP0/DQT/SOF0/DHT/SOS/EOIが揃っている)。
// pdfExport.test.ts / epubExport.test.ts / workers/exportCore.test.ts で共有し、
// フィクスチャのバイト列とデコーダの定義を1箇所にまとめている。
export const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='

export function decodeBase64Jpeg(): Uint8Array {
  const binary = atob(TINY_JPEG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
