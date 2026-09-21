# ADR: OCRモデルの配布元(2026-09-21)

Status: 採用(実装済み。ライセンスは解釈であり、ONNXを名指しする文はない旨を残存リスクとして維持。下記「ライセンス」)
関連: `2026-09-21-ocr-phase2-model-notes.md`、`docs/superpowers/plans/2026-09-21-phase3-model-hosting.md`

## 背景
フェーズ2のPARSeq 202604版3本は上流作者(yuta1984)の個人 R2 バケット(`pub-9cac…r2.dev`)にのみ依存していた。その依存を解消し、配布経路を根拠付きで決める。

## 実測した事実
1. 必要な4モデルは NDL公式 `ndl-lab/ndlocr-lite` の `src/model/` に通常ファイルとして存在する(GitHub Contents API・raw.githubusercontent.com。LFSではない)。固定コミット `d25e0d415b607ad44459ca6b95c7512a54363935` で4本すべて取得し、SHA-256・サイズが現行の値と完全一致した(表は `ocr-phase2-model-notes.md` の「公式ソース」節)。よって取得元を公式に変えるだけで個人バケット依存は消える。
2. Cloudflare Pages は1ファイル 25 MiB まで。モデルは 36〜42 MB のため Pages/Workers 静的アセットには置けない。
3. R2: 無料枠(保存10GB-month等)、egress無料、`r2.dev` 公開URLは開発用(レート制限)、本番公開にはカスタムドメインが必要。(2〜3は計画作成時の公式ドキュメント調査に基づく。本タスクでは再検証していない。)
4. GitHub Pages は COOP/COEP を付けられずWASMは単一スレッド。ホスト移行は本件のスコープ外。

## 判断(R2は最適か)
| 案 | 実行時の別オリジン取得 | 必要なもの | 評価 |
|---|---|---|---|
| A. 公式リポジトリの固定コミットからビルド時取得(同一オリジン配信) | なし | 何も要らない | **一次ソースとして採用**。バイト同一と実測済み |
| B. R2 非公開バケット + ビルド時にAPI取得 | なし | Cloudflareアカウント、APIトークン | **フォールバックのミラーとして採用**。ドメイン/r2.dev/CORS不要 |
| C. R2 公開(カスタムドメイン)で実行時取得 | あり(CORS要) | 自前ドメイン、CORS設定 | 今は不要(YAGNI) |
| D. R2 の `r2.dev` 公開URL | あり | なし | 不採用(開発用・レート制限) |
| E. Cloudflare Pages/Workers 静的アセット | — | — | 不可(25 MiB上限) |
| F. Hugging Face Hub | あり | HFアカウント | 判断保留(未検証。Bで足りる) |

結論: R2が最適なのはミラー(B)としてであり、一次ソースは公式リポジトリ(A)。R2の実行時配信(C)は必要が生じてから別計画にする。

## ライセンス(一次資料の確認)
確認対象(固定コミット): ルート直下の一覧は `.github .gitignore LICENCE LICENCE_DEPENDENCEIES README.md dummy.dat evaluation_jptype.csv ndlocr-lite-gui pyproject.toml requirements.txt resource src train`。ライセンスファイル名は綴りが **`LICENCE`**(`LICENSE` ではない)。依存物は `LICENCE_DEPENDENCEIES`(綴りは実物のまま)。

- `LICENCE` 冒頭: 「Attribution 4.0 International」(CC BY 4.0 全文、18,653 B)。§2(a)(1): 「the Licensor hereby grants You a worldwide, royalty-free, non-sublicensable, non-exclusive, irrevocable license to exercise the Licensed Rights in the Licensed Material to: a. reproduce and Share the Licensed Material, in whole or in part; and b. produce, reproduce, and Share Adapted Material.」
- `README.md`: 「本プログラムは、国立国会図書館がCC BY 4.0ライセンスで公開するものです。詳細については[LICENCE](./LICENCE)をご覧ください。」また「レイアウト認識及び文字列認識の機械学習モデルは、いずれもpytorchをフレームワークとした学習を行った後にONNX形式に変換して利用しています。」
- `src/model/` に上記4つの ONNX が同リポジトリ内で置かれ、リポジトリ内にモデルを除外する/別ライセンスとする記述は見つからなかった(README・train/README.md・LICENCE を「licen」「ライセンス」「再配布」「配布」等で検索)。
- `train/README.md` にはライセンス・再配布に関する語が一切ない。該当するのは節「pytorchチェックポイントファイルの提供(ファインチューニング用途を想定)」のみで、内容は `.pth`/`.ckpt`(学習済みチェックポイント)のダウンロードURL一覧(ver1.0/1.1のDEIMv2・PARSeq、ver1.2のPARSeq 202604版3本)。これは「ファインチューニング用にPyTorchチェックポイントも提供している」という記述であり、**ONNXが再配布不可とは述べていない**。「公式ONNXが再配布可能として列挙されていない」という要約は、この節がONNXに触れていないことの読みで、制限の記述ではない。
- `LICENCE_DEPENDENCEIES`: 依存物としてPARSeq・DEIMv2 の Apache License 2.0 を同梱(「DEIM is licensed under the Apache License.」)。モデルはこれらの手法から学習したもの。

結論と解釈:
- ①ONNXがCC BY 4.0の対象か: リポジトリ全体に対する `LICENCE`(CC BY 4.0)が置かれ、READMEが「本プログラム」を CC BY 4.0 で公開するとしており、モデルの除外記載は無い。よって `src/model/` のONNXもCC BY 4.0で頒布されていると読むのが妥当。ただし**ONNXファイルを名指しでCC BY 4.0と述べる文はどの資料にも無い**(リポジトリ全体のライセンスからの解釈)。
- ②再配布・自サイト配信・ミラー保管: CC BY 4.0 §2(a)(1) が「reproduce and Share ... in whole or in part」を許諾するので、条件(下記)を守る限り可。
- ③帰属表示(§3(a)(1)): 作成者の表示、ライセンス通知への言及、ライセンスへのURI、免責への言及、改変した場合はその表示。URIやハイパーリンクによる充足が認められる(§3(a)(2))。ONNXはPyTorchモデルからの変換物なので、配布時は「NDLラボが公開するモデルのONNX形式(変換は公式によるもの)」と出所を明記する。202604版PARSeqは公式リポジトリの ver1.2 モデルであり、これまで懸念していた「個人R2上の個別ライセンス表記なし」は公式ソースを使えば解消する(公式のverと表記が一致: `ver1.2_models/parseq-ndl-24x…-202604.ckpt`)。
- 留意(DONE_WITH_CONCERNS): 上記のとおり明示文言はない。所有者がより確実にしたい場合は NDLラボへ「src/model の ONNX も CC BY 4.0 で再配布・ミラー可か」を確認できる。学習データ(tegaki3等)の権利は公式にも記載がない。

## 帰属表示の方針
配布元表記を実態(公式リポジトリ `ndl-lab/ndlocr-lite`、CC BY 4.0、固定コミット)に更新する。ndlocrlite-web への依存表記は、同リポジトリのコードや yaml を使っている範囲に限定する(Task 1 以降で反映)。

## 影響
Task 1 で `modelFiles.mjs` の一次ソースを公式固定コミットにし、複数ソース+SHA-256検証を導入する。NDLmoji.yaml は公式と現行で4文字差(`ocr-phase2-model-notes.md` 参照)があり、Task 1 で実機スモークにより確定する。R2ミラーは所有者の承認後(Task 3)。
