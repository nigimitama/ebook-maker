// A hand-built valid 2x1 PNG (red pixel, green pixel), generated and
// verified against pdf-lib's embedPng at plan-authoring time. Shared by
// pdfExport.test.ts, epubExport.test.ts, and exportCore.test.ts so the
// fixture bytes and decoder are defined in exactly one place.
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII='

export function decodeBase64Png(): Uint8Array {
  const binary = atob(TINY_PNG_BASE64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
