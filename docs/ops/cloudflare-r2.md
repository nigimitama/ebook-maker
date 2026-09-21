# Cloudflare R2 運用手順(骨格。本文は Task 3 で記入)

## 前提

認証情報(APIトークン・アカウントID等)は絶対にリポジトリへコミットしない。

## バケット作成(所有者操作)

所有者がダッシュボード/CLIで作成する。

## APIトークン(読み取り専用)

必要最小限の権限のトークンを作成する。

## ミラー実行

`R2_BUCKET=<name> npm run mirror-models`(既定 dry-run、`-- --execute` で実行)。

## GitHub Secrets

CI で使う値を Secrets に登録する。

## 確認

ミラーされたオブジェクトのハッシュを確認する。
