export interface AdjustmentParams {
  brightness: number // -100..100, 0 = no change
  contrast: number // -100..100, 0 = no change
}

export const DEFAULT_ADJUSTMENT: AdjustmentParams = { brightness: 0, contrast: 0 }

export interface PageEntry {
  id: string
  order: number
  blobId: string
  // Small copy of the original, used to paint the page list. Optional because
  // pages stored before thumbnails existed don't have one; those are backfilled
  // on load. `blobId` always points at the untouched original.
  thumbBlobId?: string
  width: number
  height: number
  adjustment: AdjustmentParams
}

export interface BookMetadata {
  title: string
  author: string
}

// Structurally compatible with DOM ImageData ({data, width, height}), but
// defined locally so pure image-processing functions can be unit tested
// without a browser/canvas — jsdom does not implement ImageData (verified
// against jsdom 30: `new window.ImageData(...)` throws "not a constructor").
// A real `CanvasRenderingContext2D.getImageData()` result satisfies this
// interface as-is; no conversion needed at runtime.
export interface RawImage {
  data: Uint8ClampedArray
  width: number
  height: number
}
