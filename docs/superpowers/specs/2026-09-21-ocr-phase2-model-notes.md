# OCR Phase2 モデル調査結果 (2026-09-21)

出典: yuta1984/ndlocrlite-web (commit 50216cc) のソースと、実モデルを onnxruntime-node で検査した結果。食い違いは実測を正とした。

## 結論 (食い違いの解消)
- DEIM 入力: **800x800** (ファイル名は 1024x1024 だが実体は 800)。`im_shape` 相当は `[800,800]` int64。
- PARSeq 入力高さ: リポジトリ同梱(public/models)の旧モデルは **16**、R2 配布の 202604 版は **24**。上流の実運用は 202604 版(24)。ocr.worker.ts の 16 は旧コメントの残り。**採用は 24 版**。
- カスケード: **あり**。DEIM の `char_count` 出力で 3 モデルを使い分ける。

## レイアウトモデル deim-s-1024x1024.onnx (40,256,763 B)
- inputs: `images` float32 [N,3,800,800] / `orig_target_sizes` int64 [N,2] (上流は [[800,800]] を渡す。出力 bbox は 800 空間)
- outputs: `labels` int64 (class id, **1 始まり**) / `boxes` float32 [1,N,4] (x1,y1,x2,y2) / `scores` float32 [1,N] / `char_count` int64 (実測は int64。上流コードは Float32Array として読むが値は 1/2/3)
- 前処理: 長辺 maxWH の正方形に**左上寄せ**で黒(0,0,0)パディングし 800x800 にリサイズ(scale=800/maxWH)。NCHW、RGB、ImageNet 正規化 mean=[123.675,116.28,103.53] std=[58.395,57.12,57.375] (0-255 値に対し (v-mean)/std)。
- 後処理: score >= 0.3。class = label-1。座標は x maxWH/800 倍で元画像へ。行クラス(0始まり) {1,2,3,4,5,16}=line_main/caption/ad/note/note_tochu/title、0=text_block(段境界)。行bboxは上下 2% 拡張、幅/高さ 10px 未満は捨てる。行に対し IoU 0.5 の NMS。
- **文字数カテゴリ**: 出力4本目 `char_count`(1/2/3)。3 -> ≤30文字モデル、2 -> ≤50文字モデル、それ以外(1、欠落時100) -> ≤100文字モデル。

## PARSeq (採用: 202604 版, 24px)
| 用途 | ファイル名 | サイズ | input `images` | output |
|---|---|---|---|---|
| char_count=3 (≤30) | parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx | 36,457,393 B | [1,3,24,256] | `13470` [1,31,7142] |
| char_count=2 (≤50) | parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx | 37,808,553 B | [1,3,24,384] | `21190` [1,51,7142] |
| char_count=1 (≤100) | parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx | 42,588,187 B | [1,3,24,768] | `40489` [1,101,7142] |

(旧16px版が上流 public/models に同梱: parseq-ndl-30/50/100.onnx = 35,848,117 / 36,920,058 / 40,984,184 B、shape は高さ16、出力名 13469/21189/40488。使わない。)
- 出力名は数値でビルド依存のため `session.outputNames[0]` で取ること。
- 前処理: 縦長(h>w)は反時計回り 90 度回転。(W,H)へ単純リサイズ(アスペクト無視)。NCHW RGB、v/255 して `2*(v-0.5)` ([-1,1])。
- デコード: logits [1,seq,7142] を位置ごとに argmax。id0=EOS で終了、id 1-3 (<s>,</s>,<pad>) はスキップ、それ以外は charList[id-1]。連続重複は除去(上流の挙動)。語彙 7142 = 特殊4 + 文字7141 の想定(上流実装は id<4 を全てスキップし id-1 で引く。charList[0..2] は到達不能になる点は上流と同じ挙動として踏襲)。
- 特殊トークンID: EOS=0, BOS=1, ... (上流の判定は `0` で終了、`<4` スキップ)。

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
    file: 'deim-s-1024x1024.onnx',
    inputSize: 800,
    mean: [123.675, 116.28, 103.53], std: [58.395, 57.12, 57.375],
    scoreThreshold: 0.3, nmsIou: 0.5, lineBoxPadRatio: 0.02, minBoxPx: 10,
    lineClassIds: [1, 2, 3, 4, 5, 16], blockClassId: 0, // label-1 後
    imageInput: 'images', sizeInput: 'orig_target_sizes',
    outputs: { labels: 'labels', boxes: 'boxes', scores: 'scores', charCount: 'char_count' },
  },
  recognizers: [ // charCount -> model
    { charCount: 3, maxChars: 30,  width: 256, height: 24, file: 'parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx' },
    { charCount: 2, maxChars: 50,  width: 384, height: 24, file: 'parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx' },
    { charCount: 1, maxChars: 100, width: 768, height: 24, file: 'parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx' }, // フォールバック
  ],
  vocabSize: 7142, eosId: 0, specialTokenMax: 3, // id<4 はスキップ、charList[id-1]
  charsetKey: 'model.charset_train', charsetFile: 'NDLmoji.yaml', // 7141 文字
} as const
```

## ライセンス・配布
- NDLOCR-Lite 本体 (ndl-lab/ndlocr-lite): README「国立国会図書館が CC BY 4.0 ライセンスで公開」、LICENCE は CC BY 4.0 全文。DEIM モデル・文字セット(NDLmoji.yaml)は NDL 帰属。
- ndlocrlite-web (yuta1984) LICENSE: CC BY 4.0 (Copyright 2025 Yuta Hashimoto)。同 README で PARSeq 202604 版は「NDL のモデルを入力高さ24px・tegaki3 データで再学習した改良版」と明記し、NDLOCR-Lite 帰属を表示。
- CC BY 4.0 は再配布・改変・商用利用を許諾(帰属表示・ライセンスへのリンク・改変の明示が条件)。**再配布禁止でもライセンス不明でもない -> BLOCKED ではない**。
- 留意: 202604 版 PARSeq の R2 上の個別ライセンス表記は無く、親リポジトリの CC BY 4.0 と README の派生関係の記載に依拠する(NDL 派生物としても CC BY 4.0)。再学習に使った tegaki3 等データの権利は上流未記載。
- 配布元URL: DEIM は上流 https://github.com/yuta1984/ndlocrlite-web/raw/main/public/models/deim-s-1024x1024.onnx (Git 通常ファイル、LFS ではない)。PARSeq 202604 は https://pub-9cac8877191a4c3697edb59fd982130f.r2.dev/<ファイル名> (個人 R2。恒久性の保証なし)。
- 推奨: 自サイトの静的ホスティングに**同梱(自前ホスト)**し、実行時にキャッシュ(IndexedDB/Cache API)。R2 直リンクは依存しない。
- 帰属表示文言案: 「本機能は国立国会図書館 NDLOCR-Lite (https://github.com/ndl-lab/ndlocr-lite, CC BY 4.0) のレイアウト検出・文字認識モデルおよび文字セットを利用し、ndlocrlite-web (Yuta Hashimoto, CC BY 4.0) の再学習済み文字認識モデルを、ONNX 形式のまま自サイトから配信しています。」
