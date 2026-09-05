import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

// jsdomは URL.createObjectURL/revokeObjectURL を実装していないため差し替える。
// ダウンロードリンクを生成するコンポーネント(ExportPanel)を、実際のBlob URLなしで
// ユニットテストできるようにするため。
if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = () => 'blob:mock-url'
}
if (!window.URL.revokeObjectURL) {
  window.URL.revokeObjectURL = () => {}
}

// jsdomはcanvasの2D描画を実装しておらず、getContext('2d')を呼ぶたびに
// "Not implemented" 警告を出力する。アプリ側はnullの2Dコンテキストを
// 既に正しく扱っている(AdjustmentEditorの描画effectを参照)ので、
// 直接nullを返すよう差し替え、描画のたびに警告が出るのを防ぐ。
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
