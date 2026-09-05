import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

// jsdom does not implement URL.createObjectURL/revokeObjectURL — stub them
// so components that create download links (ExportPanel, Task 13) can be
// unit tested without a real Blob URL.
if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = () => 'blob:mock-url'
}
if (!window.URL.revokeObjectURL) {
  window.URL.revokeObjectURL = () => {}
}

// jsdom does not implement canvas 2D rendering and logs a noisy
// "Not implemented" warning every time getContext('2d') is called.
// Stub it to return null directly — application code already handles
// a null 2D context (see AdjustmentEditor's draw effect) — so tests
// stay pristine instead of printing that warning on every render.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
