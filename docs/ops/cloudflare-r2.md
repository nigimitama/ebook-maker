# Cloudflare R2 運用手順(OCRモデルのミラー)

OCRモデルは通常、NDL公式リポジトリの固定コミットからビルド時に取得する(`npm run fetch-models`)。R2は**公式ソースが使えなくなったときの保険(非公開ミラー)**で、実行時にブラウザから直接読むものではない。判断の経緯は [モデル配布元のADR](../superpowers/specs/2026-09-21-model-hosting-decision.md) を参照。

## 前提

- 認証情報(APIトークン・アクセスキー・アカウントID等)は**絶対にリポジトリへコミットしない**。置き場所は手元の環境変数と GitHub Secrets のみ。
- `wrangler` は `npx wrangler@4`(メジャー固定)で使う。`wrangler login` はブラウザで認可する(所有者が実行)。
- R2の無料枠は保存10 GB-month・Class A 100万/月・Class B 1000万/月・転送(egress)無料。モデルは合計 約157 MB。

## バケット(現状)

- 使用バケット: `ebook-maker`(2026-09-21 作成、ロケーション APAC、Standard)
- **非公開のまま運用する**: `r2.dev` の公開URLは無効、カスタムドメインは未接続(`wrangler r2 bucket dev-url get ebook-maker` と `wrangler r2 bucket domain list ebook-maker` で確認できる)。公開が要らないので CORS 設定も不要。
- オブジェクトのキーは内容アドレス(`models/<SHA-256>/<ファイル名>`)。同じキーの中身は変わらないため、上書き事故が起きない。

## ミラー実行(2026-09-21 実施済み)

```bash
npm run fetch-models                                   # 公式ソースから取得しSHA-256検証
R2_BUCKET=ebook-maker npm run mirror-models            # dry-run(計画表示のみ)
R2_BUCKET=ebook-maker npm run mirror-models -- --execute
```

`--execute` は、アップロード前にローカルの全ファイルのSHA-256を再検証し、1つでも不一致なら1件もアップロードせず中止する。アップロードしたのは次の5件(キーの `<SHA-256>` は `scripts/modelFiles.mjs` の値):

| ファイル | キー |
|---|---|
| deim-s-1024x1024.onnx | `models/c156ce0c…7373/deim-s-1024x1024.onnx` |
| parseq-ndl-24x256-30-…-202604.onnx | `models/9e651bae…772d/…` |
| parseq-ndl-24x384-50-…-202604.onnx | `models/49cea9db…7a99/…` |
| parseq-ndl-24x768-100-…-202604.onnx | `models/06462b0d…0602/…` |
| NDLmoji.yaml | `models/f6ad5a2d…c529/NDLmoji.yaml` |

## 確認

R2から取り出して元のハッシュと一致することを確認する(実施済み: 24x256 のモデルで一致)。

```bash
npx wrangler@4 r2 object get "ebook-maker/models/<SHA-256>/<ファイル名>" --file <出力先> --remote
sha256sum <出力先>   # <SHA-256> と一致すること
```

注: `wrangler r2 bucket info` の `object_count` / `bucket_size` は反映に時間がかかることがあり、アップロード直後は 0 のままに見える。

## APIトークン(読み取り専用)— 未実施(次のPR)

CIがR2をフォールバックとして読むためのトークン。**所有者がダッシュボードで作る**。

1. Cloudflare ダッシュボード → R2 → API → 「APIトークンを管理」→ トークン作成
2. 権限は「オブジェクトの読み取りのみ」、対象は `ebook-maker` バケットに限定(書き込み・削除は付けない)
3. 発行された値は一度しか表示されないので、そのまま GitHub Secrets に登録する。チャット・コミット・ログに貼らない

## GitHub Secrets — 未実施(次のPR)

`Settings → Secrets and variables → Actions` に次の4つを登録する(名前は次のPRのコードが参照する予定):

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`(値: `ebook-maker`)

Secrets が無いフォークのPRでも CI が落ちないよう、次のPRの実装では4つ全部が揃ったときだけR2を使う。
