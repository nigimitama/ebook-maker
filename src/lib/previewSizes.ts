// Previews are painted far smaller than a scanned page really is: thumbnails
// at roughly 140px tall, the adjustment canvas at a few hundred px wide. These
// caps bound the long edge of the pixel data behind each, so a 2480x3508 scan
// isn't decoded in full just to paint a 122x140 thumbnail.
//
// Display only — merging and exporting keep using the original blob.
export const THUMBNAIL_MAX_EDGE = 320
export const PREVIEW_MAX_EDGE = 1200

// Fits width x height inside a maxEdge square, preserving aspect ratio.
// Never upscales: an image already smaller than the cap is left alone.
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
