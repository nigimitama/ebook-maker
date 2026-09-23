# OCRの並列実行(同時処理数の設定)設計

日付: 2026-09-23
関連: `src/hooks/useOcr.ts`、`src/lib/ocr/ocrRunner.ts`、`src/workers/ocrWorker.ts`、`src/components/OcrReview.tsx`、`src/lib/automationApi.ts`、`public/llms.txt`

## 目的
全ページOCRを複数コアで並列に走らせて高速化する。全コアを使うとUIが重くなるため、同時処理数をユーザーが選べるようにする。

## 前提と制約
- 現状はOCR Worker 1つでページを直列に処理している(`createOcrRunner` の直列キュー)。
- onnxruntime-web のwasmマルチスレッド(`numThreads > 1`)は SharedArrayBuffer を使うため、ページが COOP/COEP ヘッダで cross-origin isolated である必要がある。デプロイ先の GitHub Pages ではヘッダを付けられない。
- したがって並列化は「**Workerを複数立て、ページ単位で並列に処理する**」方式で行う。`numThreads = 1` は変えない。
- 各Workerはモデル一式(レイアウト+認識モデル最大3つ)を個別に持つので、メモリは同時処理数に比例して増える。

## 検討した案
| 案 | 概要 | 評価 |
|---|---|---|
| A. レーン方式 | `OcrRunner`(Worker 1つ)は現状のまま、`useOcr` が同時処理数ぶんのRunner(レーン)を持ち、共有の対象リストからページを取り合う | **採用**。テスト済みの `ocrRunner.ts` をほぼ変えずに済む。失敗時はそのレーンのWorkerだけを捨てられる |
| B. Runnerプール | `createOcrRunner` 内部をN Workerのプールにする | 不採用。現状の「失敗時にRunnerごと破棄」が並行中の他ページを巻き込む。回避にはWorker単位の破棄をプール内に作り込む必要があり複雑 |
| C. coi-serviceworker + `numThreads` | Service Workerでヘッダを偽装しwasmマルチスレッドを使う | 却下。外部リソースやキャッシュへの影響が大きく、リスクに見合わない |

## 設定値
新規 `src/lib/ocr/ocrSettings.ts`(純関数+保存):
- `maxOcrConcurrency(cores: number | undefined): number` … `max(1, cores - 1)`。`cores` が未定義・非数・1未満のときは `cores = 2` として扱う(結果は1)。
- `clampOcrConcurrency(n: number, max: number): number` … 1〜max の整数に丸める(小数は切り捨て、非数は既定値)。
- `defaultOcrConcurrency(max) = min(2, max)`。
- 保存先は `localStorage` のキー `ebook-maker:ocr-concurrency`。読み書きは try/catch で包み、失敗・未保存・不正値なら既定値。読み込み時にも clamp する(コア数の多いPCで保存した値を少ない端末で開いた場合に備える)。

状態は `useOcr` が持ち、`UseOcrResult` に `concurrency: number`、`maxConcurrency: number`、`setConcurrency(n): number`(丸めた値を返す)を追加する。`setConcurrency` は実行中でも値の保存はできるが、反映は次の `runAll` から。

## 並列実行(`useOcr.runAll`)
- 対象ページの選定(`skipDone` / 編集済みの見送り)は現状のまま。
- `runAll` 開始時の `concurrency` を固定値として使い、レーン数 = `min(concurrency, 対象ページ数)`。
- Runnerは `runnersRef: (OcrRunner | null)[]` でレーンごとに持ち、足りない分だけ `createRunner()` で作る。
- 現状のループ本体(Blob取得 → 認識 → 削除済みか確認 → 編集済みか確認 → 保存)を `processPage(lane, page)` として切り出す。各レーンは共有インデックスから次のページを取り、`processPage` を順に実行する。
- **初回のモデル取得の重複防止**: レーン0が最初のページで `'detecting'` 段階に入る(=モデルと文字セットの読み込みが終わる)か、そのページが終わる(成功・失敗問わず)まで、レーン1以降は開始を待つ。レーン0の読み込みで Cache API に保存されるので、他レーンはキャッシュから読む。
- **失敗時**: 失敗したページを `failed` に積み、`console.error` に原因を出し、**そのレーンのRunnerだけ**破棄する(次のページで作り直す)。他レーンは続行する。
- **キャンセル**: `cancelRef` を各レーンがページ取得前に確認する。処理中の最大N枚は最後まで処理して保存し、残りは飛ばす。
- **終了後**: レーン0以外のRunnerを破棄してメモリを解放する。レーン0は次回の実行(1ページ再実行など)用に残す。アンマウント時は全Runnerを破棄する。
- 結果の反映は `setResults({ ...resultsRef.current, [id]: result })` のまま(レーン間で `resultsRef` を共有するので上書き競合しない)。
- 同時処理数1のときは現状と同じ挙動になる。

### 進捗
- `progress = { done, total, stage?, concurrency? }`。`done` は完了ページ数。
- `stage`: いずれかのレーンが `'loading-models'` なら `'loading-models'`。レーン数1なら現状どおりそのレーンの段階。レーン数2以上では `'detecting'` / `'recognizing'` を区別せず、表示は「文字認識中(N並列)」とする。

## UI
`OcrReview` の上部に「OCRの設定」セクションを追加する:
- ラベル「同時に処理するページ数」、`<input type="number" min={1} max={maxConcurrency}>`。
- 補足文:「この端末の上限: N(論理コア数−1)。増やすと速くなりますが、1つ増やすごとにメモリを多く使い、PCが重くなることがあります」。1 Workerあたりのメモリ量は実装時に実測でき次第、数値(約◯MB)で書き足す。
- 入力中は自由に編集でき、確定(blur / Enter)時に `setConcurrency` で丸め、表示も丸めた値に戻す。
- OCR実行中は入力欄を `disabled` にする。

## 自動操作API
CLAUDE.md の方針に従い `window.EbookMaker` と同期する:
- `getOcrConcurrency(): { value: number; max: number }`
- `setOcrConcurrency(n: number): number` … 丸めた値を返す。
- `getState().ocr` に `concurrency` と `maxConcurrency` を追加する。
- `describe()` の説明と `public/llms.txt` に追記する。

## テスト
- `src/lib/ocr/ocrSettings.test.ts`: 上限(コア数 1 / 2 / 16 / 未定義 / NaN)、clamp(0、負数、小数、上限超え、NaN)、`localStorage` の読み書きが例外を投げるとき・不正値のときに既定値。
- `useOcr` のテスト(偽Runnerを注入):
  - 同時に処理中のページ数が常に `concurrency` 以下で、実際にN並列になる。
  - レーン0が `'detecting'` を通知するまで他レーンの `recognizePage` が呼ばれない。
  - 1レーンの失敗で他レーンのページは成功し、失敗したレーンのRunnerだけ `dispose` される。
  - キャンセルで処理中のページだけ保存され、残りは処理されない。
  - 終了後にレーン0以外のRunnerが `dispose` される。
  - `concurrency = 1` で既存テストがそのまま通る。
- `OcrReview` のテスト: 入力欄の表示、上限/下限での丸め、実行中は無効。
- `automationApi` のテスト: `getOcrConcurrency` / `setOcrConcurrency`。
- 仕上げに `npm run typecheck`、`npm test`、`npm run lint` を通し、devサーバーで2並列にして全ページOCRが速くなることを確認する。

## 対象外
- wasmマルチスレッド(COOP/COEP)対応。
- WebGPU実行プロバイダ。
- 同時処理数の自動調整(メモリ量やコア数からの推定)。
