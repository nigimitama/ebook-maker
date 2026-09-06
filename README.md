# ebook-maker

スキャンした文書画像を輝度・コントラスト調整して、1つのPDFまたはEPUBに変換するWebアプリです。

画像は一切サーバーに送信されません。デコード・補正・見開き結合・PDF/EPUB生成のすべてがブラウザ内で完結し、
ページ画像と調整パラメータはIndexedDBに保存されるためリロードしても作業内容が残ります。

## 機能

- 複数画像ファイル/フォルダの取込(ドラッグ&ドロップ対応)
- 自動輝度・コントラスト補正 + スライダによる手動調整(プレビュー付き)
- 見開き結合(2ページを1枚に結合)、並べ替え、削除
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
