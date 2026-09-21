# フェーズ2 設計書: ブラウザ内OCR

## 作ったもの
調整と書き出しの間に任意の「OCR」工程を追加した。画像はサーバーに送らず、ブラウザ内(ONNX Runtime Web / WASM)でレイアウト検出と文字認識を行い、行単位で確認・修正でき、.txtとして保存できる。PDF/EPUBへの埋め込みは対象外。

## アーキテクチャ
- `src/lib/ocr/`: 設定(`ocrConfig.ts`)、前後処理(letterbox、検出デコード、読み順、認識)、Worker(`ocrWorker`)とそれを束ねるランナー。
- `useOcr`(hook): 実行(1ページ/全ページ、中止、進捗)と結果の編集操作(行の更新・削除・追加・移動)を提供し、結果はIndexedDBへ保存。
- `OcrReview` / `OcrOverlay`: ページ一覧、画像上の枠、行テキスト編集のUI。
- `ocrText.ts`: `buildPlainText` — 書籍順のページから行テキストを連結。
- モデルは `npm run fetch-models` で取得(SHA-256検証、git管理外)し、デプロイ時に自サイトから配信。

## データモデル
`OcrResult { pageId, lines: OcrLine[], modelVersion, updatedAt }`、`OcrLine = Box + { id, text, edited }`(原本画像のpx座標、配列順が読み順)。IndexedDBはv2で `ocr` ストアを追加し、pageId をキーに保存。

## 決定と裁定
- 検出はDEIM 800x800、認識はPARSeq(高さ24px、202604版)。文字数のカスケード(char_count int64: 3→30, 2→50, その他→100)で認識器を選ぶ。
- 連続同一文字の重複除去はしない。PARSeqは自己回帰でCTCではなく、除去すると「ああ」「ーー」を壊すため。実機で確認済み。
- 文字セットは id-1 でのマッピング(`charList[id-1]`)。実画像で正しいことを確認済み(id-4は文字化け)。
- ベースURL解決: モデル・設定・wasmは `import.meta.env.BASE_URL` を基準にWorker内で解決する(GitHub Pagesのサブパス対応)。
- IndexedDBはv2へ移行(既存データを壊さず `ocr` ストアを追加)。
- 修正の保護方針: 修正済みの行があるページは再実行で上書きしない。「上書きして再実行」を明示したときのみ置き換え、実行中にページが修正された場合は新しい結果を破棄する。「全ページをOCR」は認識済みを飛ばす。
- WASMは単一スレッド固定(GitHub PagesはCOOP/COEP不可)。実測25行で約14秒/ページ。進捗表示と中止を用意。
- 帰属表示(NDLOCR-Lite / ndlocrlite-web, CC BY 4.0)をUIとREADMEに記載。

## 範囲外
OCRテキストのPDF/EPUBへの埋め込み、キーボードだけでの枠追加、複数スレッド実行、モデルの自前学習・別配布元への切替(個人バケット依存のリスクは [モデル調査メモ](2026-09-21-ocr-phase2-model-notes.md) 参照)。
