# Cloudflare R2 運用手順

OCRモデル(合計約157MB)の**二次ソース(ミラー)**として Cloudflare R2 の非公開バケットを使う。
一次ソースは NDL公式リポジトリの固定コミット。R2 は公式が落ちたときだけ使われる。
判断の経緯は [モデル配布元の判断(ADR)](../superpowers/specs/2026-09-21-model-hosting-decision.md) を参照。

## 前提

認証情報(APIトークン・アカウントID・アクセスキー等)は絶対にリポジトリへコミットしない。
ログにも出さない(`mirror-models.mjs` / `verifySources.mjs` はいずれも資格情報を出力しない)。

## バケット(実施済み)

実際のバケット名は **`ebook-maker`**。

> 注意(名前の食い違い): 計画文書 `docs/superpowers/plans/2026-09-21-phase3-model-hosting.md` や
> テストのフィクスチャには `ebook-maker-models` という名前が出てくるが、これは計画時の**仮の名前**で、
> 実際に作成されたバケットは `ebook-maker`。運用時は必ず `ebook-maker` を使う
> (テスト内の `ebook-maker-models` は単なるダミー値なのでそのままでよい)。

公開設定(カスタムドメイン・`r2.dev`)は**有効にしていない**。取得はすべて S3互換API 経由。

## APIトークン(読み取り専用・実施済み)

CI に渡すトークンは **オブジェクト読み取り専用(Object Read only)** で、
スコープを **バケット `ebook-maker` のみ**に限定して作成する。
書き込み・バケット作成・削除の権限は与えない(CI はミラーを読むだけ)。

トークン作成時に得られる **S3互換API の資格情報**(Access Key ID / Secret Access Key)を使う。
CI から `wrangler` は使えない(`wrangler` は OAuth セッション前提で、この2つの鍵だけでは非対話認証できない)。

## ミラー実行(所有者のローカル操作)

アップロードは `wrangler` 経路。事前に `wrangler login` しておく。

```sh
R2_BUCKET=ebook-maker npm run mirror-models              # dry-run(既定)
R2_BUCKET=ebook-maker npm run mirror-models -- --execute # 実行
```

実施済み: 上記により `MODEL_FILES` のうち SHA-256 記録済みの **5オブジェクト**
(DEIMv2 1本 + PARSeq 3本 + `NDLmoji.yaml`)をアップロード済み。

オブジェクトキーは内容アドレス方式 `models/<sha256>/<basename>`(`scripts/mirrorPlan.mjs` の `mirrorKey`)。
ハッシュがキーに入るので不変で、`Cache-Control: public, max-age=31536000, immutable` を付けている。

### ⚠ モデルを差し替えたときの必須手順

**`scripts/modelFiles.mjs` のSHA-256を変更したら、`R2_BUCKET=ebook-maker npm run mirror-models -- --execute` を
再実行してR2にも反映すること。** 忘れるとR2フォールバックが古いオブジェクトを返すか404する
(キーにハッシュが入るため、新しいハッシュのオブジェクトは存在しない)。

週次の死活監視(下記)は公式が生きていれば `::warning::` でミラーの不在を知らせるだけなので、
気付くまでに最大1週間かかる。差し替えとミラー再実行は同じ作業単位で行うこと。

## GitHub Secrets

以下4つをリポジトリ Secrets に登録する。4つ揃っているときだけ R2 経路が有効になる
(1つでも欠けていれば公式ソースのみで動作するので、フォークのCIは落ちない)。

| Secret | 内容 |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare アカウントID |
| `R2_ACCESS_KEY_ID` | S3互換API のアクセスキーID |
| `R2_SECRET_ACCESS_KEY` | S3互換API のシークレットアクセスキー |
| `R2_BUCKET` | `ebook-maker` |

利用箇所: `.github/workflows/deploy.yml` の `npm run fetch-models` ステップと、
`.github/workflows/verify-models.yml` の `node scripts/verifySources.mjs` ステップ。

## CI からの取得方式(SigV4)

`scripts/r2Source.mjs` が R2 の S3互換エンドポイント
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>/<key>` に対して
**AWS Signature Version 4**(region `auto`、service `s3`)で署名した GET を投げる。
署名は `node:crypto` だけで自前実装しており、npm 依存は追加していない。

`npm run fetch-models` は「公式ソースを順に試す → 全滅したときだけ R2」の順で取得し、
R2 経路でも同じ SHA-256 検証を通す。R2 に落ちたときは
`WARN: 公式ソースから取得できなかったため R2 ミラーを使用` を標準出力に出す。

## 死活監視

`.github/workflows/verify-models.yml` が毎週月曜 03:00 UTC(と手動実行)で
`node scripts/verifySources.mjs` を動かし、全ソースを実際に取得してハッシュを照合する。

| 状態 | 結果 |
| --- | --- |
| 公式が全滅(R2 は生存) | **非0終了 + `::error::`**。R2 が代替していても鳴らす(一次ソース復旧が必要) |
| 公式もR2も全滅 | **非0終了 + `::error::`**(配信が止まる。最も重い) |
| 公式は生存・R2 だけ不調 | 終了コード0 + `::warning::`(ミラー再実行を促す) |
| Secrets 未設定 | 公式ソースのみ検査。注釈なし |

## 確認

```sh
# Secrets を環境変数に入れて、ミラーのハッシュまで含めて検査する
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=ebook-maker \
  node scripts/verifySources.mjs
```

各ファイルに `OK   R2 ミラー — … bytes` が出れば、CI のフォールバック経路が実サーバに受理されている。
