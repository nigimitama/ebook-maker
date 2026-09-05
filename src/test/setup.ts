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
