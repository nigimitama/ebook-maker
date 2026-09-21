# OCR Phase2 モデル調査結果 (2026-09-21)

出典: yuta1984/ndlocrlite-web を commit 50216cc に固定(以降 `upstream@50216cc`。上流参照は全てこの版) のソースと、実モデルを onnxruntime-node で検査した結果。食い違いは実測を正とした。

## 結論 (食い違いの解消)
- DEIM 入力: **800x800** (ファイル名は 1024x1024 だが実体は 800)。`im_shape` 相当は `[800,800]` int64。
- PARSeq 入力高さ: リポジトリ同梱(public/models)の旧モデルは **16**、R2 配布の 202604 版は **24**。上流の実運用は 202604 版(24)。ocr.worker.ts の 16 は旧コメントの残り。**採用は 24 版**。
- カスケード: **あり**。DEIM の `char_count` 出力で 3 モデルを使い分ける。

## レイアウトモデル deim-s-1024x1024.onnx (40,256,763 B)
- inputs: `images` float32 [N,3,800,800] / `orig_target_sizes` int64 [N,2] (上流は [[800,800]] を渡す。出力 bbox は 800 空間)
- outputs: `labels` int64 (class id, **1 始まり**) / `boxes` float32 [1,N,4] (x1,y1,x2,y2) / `scores` float32 [1,N] / `char_count` int64 (実測は int64。上流コードは Float32Array として読むが値は 1/2/3)
- 前処理: 長辺 maxWH の正方形に**左上寄せ**で黒(0,0,0)パディングし 800x800 にリサイズ(scale=800/maxWH)。NCHW、RGB、ImageNet 正規化 mean=[123.675,116.28,103.53] std=[58.395,57.12,57.375] (0-255 値に対し (v-mean)/std)。
- 後処理: score >= 0.3。class = label-1。座標は x maxWH/800 倍で元画像へ。行クラス(0始まり) {1,2,3,4,5,16}=line_main/caption/ad/note/note_tochu/title、0=text_block(段境界)。行bboxは上下 2% 拡張、幅/高さ 10px 未満は捨てる。行に対し IoU 0.5 の NMS。
- **文字数カテゴリ**: 出力4本目 `char_count`(1/2/3)。**dtype は int64 なので `BigInt64Array` として読み `Number()` で変換する(Float32Array で読んではならない。上流コードは Float32Array で読んでいるが実モデルの型と不整合)**。3 -> ≤30文字モデル、2 -> ≤50文字モデル、それ以外(1、欠落時100) -> ≤100文字モデル。

## PARSeq (採用: 202604 版, 24px)
| 用途 | ファイル名 | サイズ | input `images` | output |
|---|---|---|---|---|
| char_count=3 (≤30) | parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx | 36,457,393 B | [1,3,24,256] | `13470` [1,31,7142] |
| char_count=2 (≤50) | parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx | 37,808,553 B | [1,3,24,384] | `21190` [1,51,7142] |
| char_count=1 (≤100) | parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx | 42,588,187 B | [1,3,24,768] | `40489` [1,101,7142] |

(旧16px版が上流 public/models に同梱: parseq-ndl-30/50/100.onnx = 35,848,117 / 36,920,058 / 40,984,184 B、shape は高さ16、出力名 13469/21189/40488。使わない。)
- 出力名は数値でビルド依存のため `session.outputNames[0]` で取ること。
- 前処理: 縦長(h>w)は反時計回り 90 度回転。(W,H)へ単純リサイズ(アスペクト無視)。NCHW RGB、v/255 して `2*(v-0.5)` ([-1,1])。
- デコード: logits [1,seq,7142] を位置ごとに argmax。id0=EOS で終了、id1〜3 はスキップ、それ以外は `charList[id-1]`。
- 特殊トークンID: **EOS=0(出現したら打ち切り)、id1〜3(上流コメントでは <s>=1, </s>=2, <pad>=3)は一括スキップ**。上流は 0 を EOS としつつ 2 も </s> とコメントしており個別割当が不整合なので、実装は「0で終了、1〜3スキップ」とだけ定義し個別割当に依存しない。
- **写像は `charList[id-1]` で確定(Task 3 で実機検証済み)**: upstream@50216cc の `public/kumonoito.png`(芥川「蜘蛛の糸」の縦書き活字ページ)を onnxruntime-node と実ブラウザの両方で通し、`id-1` は「或日のことでございます。お釋迦様は極樂の蓮池のふちを、獨りでぶらぶらお歩きになつ / ていらつしやいました。」と画像どおりの日本語になり、`id-4` は「我旡にぐづつけこぁほざ…」と無意味な文字列になった。よって `id-1` が正しい。
- KNOWN LIMITATION(残存): `charList[id-1]` の写像では文字リスト先頭3文字(半角スペース、`!`、`"`)は id1〜3 がスキップされるため出力不能(charList[0..2] は到達不能)。写像自体は上記で確定しているので、これはモデル側の語彙の割り当て(7142=文字7141+EOS1 で、id1〜3 が本来 charList[0..2] を指す)と特殊トークンスキップが競合する構造上の制約であり、実害は半角スペース等の3文字が出ないことに留まる。
- **連続重複の除去は行わない(決定。Task 3 で実機検証済み)**: PARSeq は CTC ではなく、同一文字の連続は正当な出力。canvas で描いた横書き画像「三行目、ややや、ああ、続く。」をブラウザ実機で認識させたところ、そのまま「三行目、ややや、ああ、続く。」と出た(上流と同じ連続重複除去を掛けると「三行目、や、あ、続く。」に潰れてしまう)。上流の挙動から意図的に逸脱する。

## 前処理の比較
| モデル | リサイズ | 色/正規化 |
|---|---|---|
| DEIM | 長辺に合わせ左上寄せ黒パディングで 800x800 (アスペクト維持) | RGB, (v-mean)/std, mean=[123.675,116.28,103.53] std=[58.395,57.12,57.375] |
| PARSeq | 縦長は反時計回り90度回転後、(W,H)へ単純リサイズ (アスペクト無視) | RGB, 2*(v/255-0.5) で [-1,1] |

## NDLmoji.yaml
- キー: `model.charset_train` (二重引用符 YAML スカラー、\" と \ のエスケープあり)。`model.charset_test` も同一の 7141 文字。`text_recognition` キーは存在しない(上流の分岐は空振り)。
- 文字数は 7141。JSON.parse で二重引用符部分をそのまま読める。先頭5行:
```
# @package _global_
model:
  charset_test: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~×ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρς...
  charset_train: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~×ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρ...
```
(3,4行は長いため省略。実ファイル 42,430 B)

## 推奨 OCR_CONFIG (Task 1: src/lib/ocr/ocrConfig.ts)
```ts
export const OCR_CONFIG = {
  layout: {
    url: 'models/deim-s-1024x1024.onnx', // サイト相対
    inputSize: 800, // ファイル名は1024だが実体は800
    scoreThreshold: 0.3, nmsIou: 0.5, lineBoxPadRatio: 0.02, minBoxPx: 10,
    mean: [123.675, 116.28, 103.53], std: [58.395, 57.12, 57.375],
    lineClassIds: [1, 2, 3, 4, 5, 16], blockClassId: 0, // label-1 後
  },
  recognizers: { // キー = 最大文字数。char_count 3->30, 2->50, その他->100
    30:  { url: 'models/parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx',  height: 24, width: 256 },
    50:  { url: 'models/parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx',  height: 24, width: 384 },
    100: { url: 'models/parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx', height: 24, width: 768 },
  },
  charsetUrl: 'config/NDLmoji.yaml', // キー model.charset_train, 7141文字
} as const
export type RecognizerKey = keyof typeof OCR_CONFIG.recognizers // 30 | 50 | 100
```
補足(ocrConfig 外の定数): 語彙 7142, EOS=0, スキップ id<4, 文字は charList[id-1](KNOWN LIMITATION 参照)。DEIM の入力名は `session.inputNames` から取る。

## ライセンス・配布
- NDLOCR-Lite 本体 (ndl-lab/ndlocr-lite): README「国立国会図書館が CC BY 4.0 ライセンスで公開」、LICENCE は CC BY 4.0 全文。DEIM モデル・文字セット(NDLmoji.yaml)は NDL 帰属。
- ndlocrlite-web (yuta1984) LICENSE: CC BY 4.0 (Copyright 2025 Yuta Hashimoto)。同 README で PARSeq 202604 版は「NDL のモデルを入力高さ24px・tegaki3 データで再学習した改良版」と明記し、NDLOCR-Lite 帰属を表示。
- CC BY 4.0 は再配布・改変・商用利用を許諾(帰属表示・ライセンスへのリンク・改変の明示が条件)。**再配布禁止でもライセンス不明でもない -> BLOCKED ではない**。
- 留意: 202604 版 PARSeq の R2 上の個別ライセンス表記は無く、親リポジトリの CC BY 4.0 と README の派生関係の記載に依拠する(NDL 派生物としても CC BY 4.0)。再学習に使った tegaki3 等データの権利は上流未記載。
- 推奨: 自サイトの静的ホスティングに**同梱(自前ホスト)**し、実行時にキャッシュ(IndexedDB/Cache API)。R2 直リンクは依存しない。
- 帰属表示文言案: 「本機能は国立国会図書館 NDLOCR-Lite (https://github.com/ndl-lab/ndlocr-lite, CC BY 4.0) のレイアウト検出・文字認識モデルおよび文字セットを利用し、ndlocrlite-web (Yuta Hashimoto, CC BY 4.0) の再学習済み文字認識モデルを、ONNX 形式のまま自サイトから配信しています。」

## 上流ダウンロード元 (fetch-models.mjs 用。OCR_CONFIG の site-relative url とは別物)
| ファイル | ダウンロード元 | SHA-256 |
|---|---|---|
| deim-s-1024x1024.onnx | https://raw.githubusercontent.com/yuta1984/ndlocrlite-web/50216cc/public/models/deim-s-1024x1024.onnx (通常ファイル、LFSではない) | c156ce0c4e704bc3bf7e4016d0a87b949cffa8b3724f4b4cc696b8284c3c7373 |
| parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx | https://pub-9cac8877191a4c3697edb59fd982130f.r2.dev/ + ファイル名 | 9e651bae4c1a4d5254da1127e86e82e21ef62d5339b37e62d4a3d3d30831772d |
| parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx | 同 R2 + ファイル名 | 49cea9db4552f19eb05c8ee202fcf74714977749b2f4c9376b127fde41b07a99 |
| parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx | 同 R2 + ファイル名 | 06462b0dbd5b0b8508545c8c3d485cf20dbf4ffa652fe145e69c9e7457080602 |
| NDLmoji.yaml | https://raw.githubusercontent.com/yuta1984/ndlocrlite-web/50216cc/public/config/NDLmoji.yaml | (未計測) |
| (参考・不使用) 旧16px parseq-ndl-30.onnx | upstream@50216cc public/models | 0bc344b883cfb11f61e15bd02044dcf92997aef1f7dce84419c3aa3c3c677d54 |
| (参考・不使用) 旧16px parseq-ndl-50.onnx | 同上 | 1a60e88c9ffeaefdfe286677146f39fdeb4d0e1acd94ccd974c8943f761d9a08 |
| (参考・不使用) 旧16px parseq-ndl-100.onnx | 同上 | 712c7184a0a80a9048a5aefbfacd63876bacfb1c8d4d2f5c252dc39ad12bc3dd |

## Residual risk
202604 版 PARSeq 3モデルは上流作者の個人 R2 バケットにのみ存在し、ファイル単位のライセンス表記がない(親リポジトリの CC BY 4.0 と README の派生記載に依拠)。再学習に使った tegaki3 データの権利も未記載。R2 が消えても困らないよう自サイト同梱(自前ホスト)を維持し、SHA-256 で同一性を確認すること。

## 公式ソース(フェーズ3 Task 0 で実測、2026-09-21)
固定コミット `d25e0d415b607ad44459ca6b95c7512a54363935` の `ndl-lab/ndlocr-lite`。ベースURL: `https://raw.githubusercontent.com/ndl-lab/ndlocr-lite/d25e0d415b607ad44459ca6b95c7512a54363935`。4モデルとも上表のSHA-256・サイズに**完全一致**(curlで取得しsha256sumで実測。GitHub Contents API の size とも一致)。

| ファイル | URL(ベース + パス) | サイズ (B) | SHA-256 |
|---|---|---|---|
| deim-s-1024x1024.onnx | /src/model/deim-s-1024x1024.onnx | 40,256,763 | c156ce0c4e704bc3bf7e4016d0a87b949cffa8b3724f4b4cc696b8284c3c7373 |
| parseq-ndl-24x256-30-…-202604.onnx | /src/model/parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx | 36,457,393 | 9e651bae4c1a4d5254da1127e86e82e21ef62d5339b37e62d4a3d3d30831772d |
| parseq-ndl-24x384-50-…-202604.onnx | /src/model/parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx | 37,808,553 | 49cea9db4552f19eb05c8ee202fcf74714977749b2f4c9376b127fde41b07a99 |
| parseq-ndl-24x768-100-…-202604.onnx | /src/model/parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx | 42,588,187 | 06462b0dbd5b0b8508545c8c3d485cf20dbf4ffa652fe145e69c9e7457080602 |
| NDLmoji.yaml (公式) | /src/config/NDLmoji.yaml | 42,434 | f6ad5a2de444b495155866af811cf1a98309dcae3225db802767ea531a2dc529 |
| ndl.yaml (公式、クラス名一覧のみ。使用しない) | /src/config/ndl.yaml | 299 | 0c2a6a184dd322375b76f2ce3842f8ac555d53edad0ab63655c013f4c471c5a0 |

### NDLmoji.yaml: 公式版と現行版(ndlocrlite-web@50216cc)の差
- 現行(`https://raw.githubusercontent.com/yuta1984/ndlocrlite-web/50216cc/public/config/NDLmoji.yaml`): 42,426 B、SHA-256 `775eb37e6b09ad0a97b762d48c916c60e7ce8879a4628ddb190ce037d0a15772`。(本ブランチの `public/config/` は gitignore でありワークツリーに実体が無いため、`fetch-models.mjs` が取得するのと同じURLを再取得して計測した。以前の記録の 42,430 B とは一致しない。)
- 両者とも `charset_train` は **Unicodeコードポイントで 7141 文字**(JSON.parse後 `[...s].length`)。以前の「公式7145文字」は UTF-16 コードユニット計測の誤り(公式版は BMP 外の文字を4つ含み 7141+4=7145)。
- 差異は0始まりの文字位置で**4か所のみ**。公式の文字が現行では U+3013(〓、下駄記号)に置き換わっている:

| 位置 | 公式 | 現行 |
|---|---|---|
| 7081 | U+2231E | U+3013 |
| 7111 | U+2437D | U+3013 |
| 7116 | U+26F94 | U+3013 |
| 7127 | U+20BB7 | U+3013 |

  現行版は U+3013 が計4回出現し重複を持つ(公式は重複なし)。文字集合の差は「公式のみ: 上記4文字 / 現行のみ: U+3013」。語彙サイズ 7142 = 7141 + EOS はどちらでも整合する。3・4行目以外(`charset_test` 行を除く他の行)に差は無い。

**決定(フェーズ3 Task 1): 公式版を採用**。両方の yaml で `kumonoito.png` の実機スモーク(Chromium ヘッドレス、実モデル4本)を通し、25行の認識テキストが**完全に一致**した(出力の SHA-256 も一致)。よって取得元を公式に統一し、`modelFiles.mjs` に公式版のハッシュ `f6ad5a2d…` を記録した。現行版は重複トークン(U+3013 が4つ)を持つぶん id が曖昧なので、公式版のほうが素性が良い。
  なお公式版は BMP 外の文字を4つ含むため、`charset` を **UTF-16 コードユニットで数えると 7145** になる(コードポイントでは 7141)。`parseCharset` は `Array.from` でコードポイント配列にしており `decodeSequence` はその配列を `id-1` で引くので id ずれは起きない(`recognizePost.test.ts` に U+2231E の回帰テストを追加済み)。
