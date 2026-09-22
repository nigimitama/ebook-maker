# OCR段落結合(ブロックbbox活用) 設計

## 目的

DEIMのレイアウト検出は、行(line_main等)のbboxとは別に、段落・カラム境界を表す`text_block`(classId 0)のbboxも出力しているが、現在のコードは行クラスだけを使い、`text_block`を捨てている。このため、同じ段落の文章が複数のOCR行に分かれたまま保存され、テキスト書き出し時に段落の途中で改行が入り、読みにくい(「テキストが途中で途切れる」)。`text_block`を活用して、行を段落単位でグループ化し、書き出し・プレビューで段落として連結する。

出典: `ndlocrlite-web`(Yuta Hashimoto, CC BY 4.0, コミット`50216cc`固定)の`src/worker/layout-detector.ts`・`reading-order.ts`を実装の下敷きにする(既存の`docs/superpowers/specs/2026-09-21-ocr-phase2-model-notes.md`と同じ出典)。

## データモデル

`OcrLine`(`src/lib/ocr/types.ts`)に`blockId?: string`を追加する(任意項目、既存の`resizeMode`等と同じ後方互換パターン。IndexedDBのバージョン変更は不要)。

- OCR実行時に一度だけ付与する。以後の行編集(修正・削除・並べ替え)では変更しない。
- 「枠を追加」で手動追加した行(`useOcr.addLine`)は`blockId`なし。
- 段落テキスト自体は保存しない。`OcrLine[]`から必要な場所でその都度導出する(`buildParagraphs`、後述)。

## レイアウト検出: ブロックを捨てない

`src/lib/ocr/layoutPost.ts`の`decodeDetections`の戻り値を`Detection[]`から`{ lines: Detection[]; blocks: Box[] }`に変える。

- ブロック(`classId === OCR_CONFIG.layout.blockClassId`、既存定数)は上下パディング拡張をせず、`minBoxPx`未満は捨てる(行の拡張・NMSは既存のまま、行だけに適用)。
- ブロックにはNMSをかけない(上流もかけていない)。

## 読み順アルゴリズムの置き換え(XY-Cut)

`src/lib/ocr/readingOrder.ts`の現在の単純クラスタリングを、上流の**XY-Cut**(ページを2Dグリッドに投影し、x/yヒストグラムの最大ゼロ区間=空白帯で再帰的に分割する)に置き換える。

- `src/lib/ocr/xyCut.ts`(新規): `rankByXYCut(boxes: Box[]): number[]`。bbox配列から読み順の順位配列を返す純関数(値が小さいほど先)。ブロック間の順序・ブロック内の順序・ブロック不使用時の全行順序の3箇所で共通に使う。
- `readingOrder.ts`: `sortReadingOrder(dets: Detection[], blocks: Box[] = []): { detection: Detection; blockId: string | null }[]`
  - 各行の中心点が収まる`blocks[i]`へ割り当てる(複数に収まる場合は`findIndex`で最初に見つかったもの)。
  - 割り当てられた行の割合が70%未満(または`blocks`が空)なら、ブロックを使わず全行に`rankByXYCut`をそのままかけて返す(`blockId: null`)。
  - 70%以上なら、ブロックごとに所属行の外接矩形を計算し、そのブロックbbox集合に`rankByXYCut`をかけてブロックの並び順を決め、各ブロック内の行にも`rankByXYCut`をかけて並べる。未割当の行は1行だけの独立ブロックとして扱う。`blockId`は`block-0`, `block-1`...のページ内連番。

この閾値(70%)・不使用時のフォールバックは上流と同じ方針。

## 段落結合(純関数)

`src/lib/ocr/paragraphs.ts`(新規): `buildParagraphs(lines: OcrLine[]): { id: string; text: string; lines: OcrLine[] }[]`

- `blockId ?? line.id`でグループ化する。未割当行は単独の段落になる。
- 段落の並び順は、各グループの最初の行が`lines`配列中に現れる位置で決める(編集で行が動いても、`lines`配列の現在の並びが常に読み順を表すため)。
- グループ内テキストは**空文字連結**(日本語の行送りは語間スペースが不要なため)。英語混じりの行送りで単語がくっつく可能性があるが、対応しない(YAGNI)。
- ユーザーが行を並べ替えて、同じ`blockId`を持つ行が配列内で連続しなくなった場合でも、`blockId`が同じ行はグループとして結合する(その段落の並び位置は先頭行の位置、段落内の行順は配列の現在順)。

## 書き出し・UI

- `src/lib/ocrText.ts`の`buildPlainText`: ページごとに`buildParagraphs(r.lines)`の各段落テキストを(空でないものだけ)`\n`で連結する(段落内に改行は入らない)。ページ間は空行。既存の「未OCR・空ページは飛ばす」挙動は変えない。
- `src/components/OcrParagraphList.tsx`(新規): 読み取り専用の段落プレビュー。`buildParagraphs`の結果を`<p>`ごとに表示する。
- `src/components/OcrReview.tsx`: 行一覧パネル(`.ocr-review__lines`)に「行ごと/段落プレビュー」のトグルボタンを追加し、`OcrLineList`(既存、編集用)と`OcrParagraphList`(新規、読み取り専用)を切り替える。`OcrLineList`自体は変更しない。
- 目次の作成ステップ(`ChaptersStep`)の拡大モーダルのOCRパネルは対象外(目次ページは行単位の候補抽出が主目的のため)。

## 対象外(YAGNI)

- 段落bboxの画像オーバーレイ表示(行のオーバーレイのみ existing のまま)。
- 段落単位の編集(修正は引き続き行単位)。
- 英語混じりテキストでの語間スペース補完。
- `window.EbookMaker`への段落API追加(既存の`useBook`レベル操作の追加ではないため)。

## テスト

- `xyCut.test.ts`(新規): 決定的な小さいbbox集合での順位検証(横書き2行、縦書き2列、1個・0個)。
- `layoutPost.test.ts`: 戻り値が`{lines, blocks}`になったことに合わせて既存ケースを更新し、ブロック抽出(パディングなし・NMSなし・10px未満除外)のケースを追加。
- `readingOrder.test.ts`: ブロック割当・70%未満のフォールバック・ブロック内外の順序を検証。既存5ケースの結果(縦書き/横書きの単純な2〜3箱)がXY-Cutでも一致することを確認する。
- `ocrPipeline.test.ts`: 行に`blockId`が付与されること。
- `paragraphs.test.ts`(新規): グループ化・連結・並び順・未割当行・配列内で分断されたグループの挙動。
- `ocrText.test.ts`: 段落結合後の書き出し文字列(既存ケースは無変更のまま通ることを確認しつつ、ブロックを共有する行の結合ケースを追加)。
- `OcrParagraphList.test.tsx`(新規)・`OcrReview.test.tsx`: トグルUIと表示内容。
