# ebook-maker

スキャンした文書画像を輝度・コントラスト調整して、1つのPDFまたはEPUBに変換するWebアプリです。

画像は一切サーバーに送信されません。デコード・補正・見開き結合・PDF/EPUB生成のすべてがブラウザ内で完結し、
ページ画像と調整パラメータはIndexedDBに保存されるためリロードしても作業内容が残ります。

## 機能

- 複数画像ファイル/フォルダの取込(ドラッグ&ドロップ対応)
- 自動輝度・コントラスト補正 + スライダによる手動調整(プレビュー付き)
- 見開き結合(2ページを1枚に結合)、並べ替え、削除
- OCR(任意の3番目の工程): 文字を認識して行ごとに確認・修正し、テキスト(.txt)として保存
- タイトル・著者のメタデータ入力
- PDF / EPUB(固定レイアウト・画像埋め込み型)の書き出し

## 技術スタック

React + TypeScript + Vite / Canvas 2D API / pdf-lib / JSZip / IndexedDB。
書き出し処理はWeb Worker上で実行され、UIをブロックしません。

## コマンド

```sh
npm install        # 依存関係のインストール
npm run dev        # 開発サーバー起動
npm test           # 単体・コンポーネントテスト (Vitest)
npm run build      # 型チェック (tsc -b) + 本番ビルド
npm run test:e2e   # E2Eテスト (Playwright)
npm run lint       # oxlint
```

`npm test` は esbuild 経由で型チェックを行わないため、変更後は `npm run build` も必ず実行してください。

## OCRモデルの出典・ライセンス・帰属表示

本機能は国立国会図書館 NDLOCR-Lite (https://github.com/ndl-lab/ndlocr-lite, CC BY 4.0) のレイアウト検出・文字認識モデルおよび文字セットを利用し、ndlocrlite-web (Yuta Hashimoto, CC BY 4.0, https://github.com/yuta1984/ndlocrlite-web) の再学習済み文字認識モデルを、ONNX 形式のまま自サイトから配信しています。

モデルはNDL公式リポジトリ `ndl-lab/ndlocr-lite` の固定コミット `d25e0d415b607ad44459ca6b95c7512a54363935` から取得します(以前使っていたファイルとバイト単位で同一で、SHA-256で検証済み)。文字セットも公式の `NDLmoji.yaml` を採用しています。個人バケットへの依存はありません。

ライセンスの解釈に関する注意: 公式リポジトリ全体は CC BY 4.0 ですが、ONNXモデルファイルが明示的に列挙されているわけではありません。判断の経緯は [モデル配布元の判断(ADR)](docs/superpowers/specs/2026-09-21-model-hosting-decision.md) を参照してください。

モデルは `npm run fetch-models` で取得します(git管理外)。取得元を順に試し、各ファイルのSHA-256を検証します(DEIMv2は第2ソースとして ndlocrlite-web@50216cc も持ちます)。`npm run mirror-models` は将来のCloudflare R2ミラー用で、既定はdry-runです(実行には環境変数 `R2_BUCKET` が必要)。現時点ではまだ使っていません。

## OCR機能の使い方と注意

- 工程は「取込 → 調整 → OCR(任意) → 書き出し」。OCRは飛ばしても従来どおり書き出せます。
- 初回のみモデル(合計約157MB)をダウンロードします。以降はブラウザのCache APIに保存され、再取得しません。
- GitHub Pagesでは COOP/COEP を設定できないため WASM は単一スレッドで動き、1ページあたり十数秒(実測の一例: 25行のページで14.4秒)かかります。
- 「このページをOCR」「全ページをOCR」で実行します。「全ページをOCR」は認識済みのページを飛ばします。
- 行の文字の修正・削除・並べ替え・枠の追加はブラウザに保存されます。修正済みの行があるページは再実行しても上書きされず、確認のうえ「上書きして再実行」を選んだときだけ置き換わります。
- 結果は「テキストを保存(.txt)」でページ順に書き出せます(ページ間は空行)。

### 既知の制限

- OCRのテキストはまだPDF/EPUBには埋め込まれません(今後の課題)。
- 枠の追加はマウス/タッチのドラッグのみで、キーボードだけでは追加できません。
- モデルの出典とライセンス解釈の詳細は [モデル調査メモ](docs/superpowers/specs/2026-09-21-ocr-phase2-model-notes.md) を参照。

## 今後の課題

- Cloudflare R2 バケット・APIトークン・GitHub Secrets の作成(オーナー作業、フェーズ3 Task 3)。
- R2ミラーを `fetch-models` のフォールバックソースにする(Secrets がある場合のみ)、および取得元の死活確認を行う週次ワークフローの追加(フェーズ3 Task 4)。次のPRで対応予定です。
