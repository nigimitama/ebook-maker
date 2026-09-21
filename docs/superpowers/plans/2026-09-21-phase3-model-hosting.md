# フェーズ3: OCRモデルの自前調達・配布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 進捗

- 完了: Task 0(公式ソース実測)・Task 1(取得元の公式固定コミット化、複数ソース対応)・Task 2(R2ミラーツール)。コミット: 3b5f5a1(ADRと実測)、f7b62b0(取得元切替)、fb38c38・53d19dc(ミラーツールと修正)。
- 次のPRへ持ち越し: Task 3(Cloudflareアカウント/R2バケット/APIトークン/GitHub Secrets、オーナー作業)、Task 4(R2ミラーのフォールバック利用、週次の死活確認ワークフロー)。
- Task 5(ドキュメント更新)は本PRで一部完了(出典・残作業の記載)。Task 3/4完了後に最終更新する。

**Goal:** OCRモデルの入手元を「上流作者の個人R2バケット」から自分で管理できるものに置き換え、配布経路の選択(R2が最適か)を根拠付きで決め、必要ならCloudflare R2ミラーまで用意する。

**Architecture:** モデルはビルド時(`npm run fetch-models`)に取得して同一オリジン(GitHub Pages)から配信する現行方式を維持し、実行時のOCRコードは変えない。変えるのは「取得元の一覧(`scripts/modelFiles.mjs`)」だけで、①NDL公式リポジトリの固定コミットを一次ソースに、②自前R2ミラーをフォールバックにする。SHA-256の固定は現行どおり必須。

**Tech Stack:** Node ESM scripts (fetch-models), Vitest, GitHub Actions, Cloudflare R2 + wrangler (ミラーのみ)

**Spec:** `docs/superpowers/specs/2026-09-21-ocr-phase2-design.md`(§残タスク)、`docs/superpowers/specs/2026-09-21-ocr-phase2-model-notes.md`。本計画の調査結果は下の「調査で分かったこと」。

**ベースブランチ:** フェーズ2のPR #19(`feat/ocr-phase2`)が未マージのため、本ブランチ `feat/phase3-model-hosting` は `feat/ocr-phase2` から切ってある。PR は #19 のマージ後に main 向けへ付け替える(または #19 を base にして出す)。

## 調査で分かったこと(この計画の前提。2026-09-21 に実測)

1. **必要な4モデルは NDL公式リポジトリ `ndl-lab/ndlocr-lite` の `src/model/` にそのまま入っている**(DEIM 40,256,763 B と PARSeq 202604版3本、サイズが現在使っているものと一致)。公式の固定コミット `d25e0d415b607ad44459ca6b95c7512a54363935` から `parseq-ndl-24x256-30-…202604.onnx` を取得して **SHA-256 が現行の `9e651bae…772d` と完全一致**することを確認済み(他の3本は Task 0 で確認する)。つまり「個人バケット依存」は、取得元を公式リポジトリに変えるだけで解消できる。`raw.githubusercontent.com` は通常ファイル(LFSではない)で、`Access-Control-Allow-Origin: *`。
2. **注意点(要調査): 公式の `src/config/NDLmoji.yaml` は 42,434 B、現在使っている上流(ndlocrlite-web)版は 42,430 B で内容が違う。** `charset_train` の文字数が公式 7145 文字、現行 7141 文字と食い違って見える(後に訂正: 両方 7141 コードポイント、現行は 42,426 B。詳細は model-notes 参照)(単純な正規表現での計測。先頭から7081文字目付近で差異)。モデルの語彙サイズは 7142。どちらがモデルと整合するかは Task 1 で実機スモーク(`kumonoito.png`)で確定する。**確定するまで現行の yaml は変えない。**
3. **Cloudflare Pages は1ファイル 25 MiB まで**(公式ドキュメント)。モデルは 36〜42 MB なので Pages/Workers静的アセットにモデルは置けない。置くなら R2。
4. **R2**: 無料枠は保存 10 GB-month・Class A 100万/月・Class B 1000万/月、**転送(egress)は無料**。`r2.dev` の公開URLは「レート制限があり開発用」とされ本番向きではない。本番の公開配信は**Cloudflareに登録したドメイン(カスタムドメイン)が必要**。CORSは `wrangler r2 bucket cors set` で設定でき、カスタムドメイン/公開バケットに適用される。
5. **GitHub Pages(現行のホスト先)は COOP/COEP ヘッダを付けられない**ため WASM は単一スレッド(1ページ約14秒)。ヘッダを付けられるホスティング(Cloudflare Pages の `_headers` 等)に移すと SharedArrayBuffer が使えるようになり高速化の余地があるが、その場合は別オリジンのモデル配信に CORP/CORS が要る。**本計画のスコープ外**(§スコープ外)。

## R2は最適か(判断)

| 案 | 実行時の別オリジン取得 | 必要なもの | 評価 |
|---|---|---|---|
| A. **公式リポジトリの固定コミットからビルド時取得**(現行の同一オリジン配信) | なし | 何も要らない | **一次ソースとして採用**。バイト同一と実測済み。GitHub が消えない限り維持され、ライセンス上も出所が明確 |
| B. **R2 非公開バケット + ビルド時にAPI取得** | なし | Cloudflareアカウント、API トークン(GitHub Secrets) | **フォールバックのミラーとして採用**。ドメイン不要・r2.dev不要・CORS不要。上流が消えたときの保険 |
| C. R2 公開(カスタムドメイン)で実行時に直接取得 | あり(CORS要) | 自前ドメイン(Cloudflareゾーン)、CORS設定 | 今は不要。Pagesのデプロイ容量を減らしたい/自前学習モデルを頻繁に差し替えたい時に検討 |
| D. R2 の `r2.dev` 公開URL | あり | 何も要らない | **不採用**(開発用・レート制限) |
| E. Cloudflare Pages / Workers 静的アセットにモデルを置く | — | — | **不可**(1ファイル 25 MiB 上限) |
| F. Hugging Face Hub | あり | HFアカウント | 未検証のため判断保留(CORS/帯域方針は未確認)。B で足りるので調査しない |

**結論:** R2が「最適」なのは*ミラー(B)としてであり*、一次ソースは公式リポジトリ(A)。R2を実行時配信に使う(C)のは、ドメインを持ち、Pagesのサイズ/モデル差し替え頻度に困った時点でよい(YAGNI)。「自分でモデルを用意する」は、当面は「公式から固定コミットで取得+自前ミラーで冗長化」で満たせる。自前で再学習したモデルを配る需要が出たら C を別計画にする。

## Global Constraints

- 実行時のOCRコード(`src/`)は変更しない。モデルのファイル名・`OCR_CONFIG`・配信パス(`models/…`, `config/…`)は現行のまま。
- 取得したファイルは必ず SHA-256 で検証し、不一致は失敗させる(現行の `fetch-models` の挙動を維持)。モデルはgitにコミットしない(`public/models/`, `public/config/` は gitignore のまま)。
- 認証情報(Cloudflare APIトークン、R2アクセスキー)はコード・ドキュメント・コミットに含めない。GitHub Secrets と手元の環境変数のみ。
- **Cloudflareアカウントの作成、課金情報の登録、バケット作成、APIトークン発行、GitHub Secrets の登録は所有者(あなた)が行う/明示承認したうえで実行する外向きの操作**。エージェントは Task 3 のコマンドを勝手に実行しない。
- ライセンス: NDLOCR-Lite(CC BY 4.0)の帰属表示を維持。配布元表記は実態(公式リポジトリ)に合わせて更新する。
- コミットメッセージ・コード内コメント・ドキュメントは日本語(既存に合わせる)。`npm test && npm run typecheck && npm run lint && npm run build` を各タスクの完了条件にする。

## ファイル構成

- `scripts/modelFiles.mjs` — 取得元の一覧。1ファイルにつき複数ソース(`sources`)とSHA-256を持つ(責務: 何をどこから取るか)
- `scripts/fetchWithFallback.mjs` — 純粋なフォールバック取得ロジック(fetch注入可能でテストできる)
- `scripts/fetch-models.mjs` — 上記を使ってディスクへ書く薄いCLI(既存を修正)
- `scripts/mirror-models.mjs` — 公式→R2 へのミラー用CLI(wrangler呼び出し)
- `scripts/verifySources.mjs` — 各ソースが生きていてハッシュが合うか確認するCLI(定期CI用)
- `docs/ops/cloudflare-r2.md` — 所有者向けの手順書(アカウント〜バケット〜Secrets)
- `docs/superpowers/specs/2026-09-21-model-hosting-decision.md` — 上の判断表を正式に残すADR
- `.github/workflows/verify-models.yml` — 週次でソース死活を確認

---

### Task 0: 公式ソースの実証とライセンス確認(調査タスク)

**Files:**
- Create: `docs/superpowers/specs/2026-09-21-model-hosting-decision.md`
- Modify: `docs/superpowers/specs/2026-09-21-ocr-phase2-model-notes.md`(公式ソースの表を追記)

**Interfaces:**
- Produces: 公式リポジトリ固定コミットでの4モデルとyamlの URL・サイズ・SHA-256表。Task 1 が `modelFiles.mjs` に転記する。ライセンスの結論(再配布可否)。

- [ ] **Step 1: 公式4モデルのSHA-256を実測する**

```bash
SHA=d25e0d415b607ad44459ca6b95c7512a54363935
B=https://raw.githubusercontent.com/ndl-lab/ndlocr-lite/$SHA/src/model
cd "$SCRATCHPAD"   # セッションのscratchpadディレクトリ(コミットしない一時領域)へ移動してから実行
for f in deim-s-1024x1024.onnx \
  parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx \
  parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx \
  parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx; do
  curl -sfL -o "$f" "$B/$f" && sha256sum "$f"
done
```

Expected: 4行のハッシュが `docs/superpowers/specs/2026-09-21-ocr-phase2-model-notes.md` の表(`c156ce0c…7373` / `9e651bae…772d` / `49cea9db…7a99` / `06462b0d…0602`)と**すべて一致**。1つでも違えば止めて内容を報告(別バージョンなので Task 1 以降を見直す)。

- [ ] **Step 2: ライセンスを一次資料で確認する**

公式 README・`LICENCE`(または `LICENSE` に相当するファイル名。ファイル名は実物で確認)・`train/README.md` を読み、①モデル(ONNX)が CC BY 4.0 の対象に含まれるか、②再配布・自サイトでの配信・ミラー保管が許されるか、③帰属表示の要件を、**引用付きで**ADRに書く。`train/README.md` に「公式ONNXモデルは再配布可能として列挙されていない」旨の記述があるように読める(要約段階の読み)ので、**原文を確認**し、公式リポジトリの `src/model/` に含まれるONNXがCC BY 4.0の対象かを断定できなければ、結論を「要確認」として止め、所有者に報告する(推測で進めない)。

- [ ] **Step 3: ADR を書く**

`2026-09-21-model-hosting-decision.md` に本計画の「R2は最適か」の表と結論、Step 1 のハッシュ、Step 2 のライセンス結論を書く。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/
git commit -m "docs: モデル配布元の判断(ADR)と公式ソースの実測結果を追加する"
```

---

### Task 1: 取得元を公式リポジトリ(一次)+複数ソース対応にする

**Files:**
- Modify: `scripts/modelFiles.mjs`, `scripts/fetch-models.mjs`, `scripts/modelFiles.test.ts`
- Create: `scripts/fetchWithFallback.mjs`, `scripts/fetchWithFallback.test.ts`

**Interfaces:**
- Consumes: Task 0 の URL とハッシュ表。
- Produces:
```js
// modelFiles.mjs — 1ファイル = 複数ソース。urlsは先頭が一次。
export const MODEL_FILES /* : { dest: string; sha256: string | null; sources: string[] }[] */
// fetchWithFallback.mjs
export async function fetchVerified(sources, sha256, deps = { fetch, verifyHash }) // → Buffer (最初に取得できて検証も通ったもの)
// 全ソース失敗時は各ソースの失敗理由を列挙した Error を投げる
```

- [ ] **Step 1: 失敗するテストを書く(`scripts/fetchWithFallback.test.ts`)**

```ts
import { describe, expect, it } from 'vitest'
// @ts-expect-error mjs without types
import { fetchVerified } from './fetchWithFallback.mjs'

const ok = (body: string) => new Response(body, { status: 200 })
const verifyHash = (buf: Buffer, expected: string | null) => expected == null || buf.toString() === expected

describe('fetchVerified', () => {
  it('一次ソースが成功すれば二次を呼ばない', async () => {
    const calls: string[] = []
    const fetch = async (u: string) => (calls.push(u), ok('A'))
    const buf = await fetchVerified(['p', 's'], 'A', { fetch, verifyHash })
    expect(buf.toString()).toBe('A')
    expect(calls).toEqual(['p'])
  })
  it('一次が404なら二次を試す', async () => {
    const fetch = async (u: string) => (u === 'p' ? new Response('', { status: 404 }) : ok('A'))
    expect((await fetchVerified(['p', 's'], 'A', { fetch, verifyHash })).toString()).toBe('A')
  })
  it('一次のハッシュ不一致でも二次を試す(改ざん/更新の検出)', async () => {
    const fetch = async (u: string) => ok(u === 'p' ? 'BAD' : 'A')
    expect((await fetchVerified(['p', 's'], 'A', { fetch, verifyHash })).toString()).toBe('A')
  })
  it('全滅なら各ソースの理由を含むエラー', async () => {
    const fetch = async () => new Response('', { status: 500 })
    await expect(fetchVerified(['p', 's'], 'A', { fetch, verifyHash })).rejects.toThrow(/p.*500[\s\S]*s.*500/)
  })
  it('ネットワーク例外も次のソースへ回す', async () => {
    const fetch = async (u: string) => { if (u === 'p') throw new Error('ECONNRESET'); return ok('A') }
    expect((await fetchVerified(['p', 's'], 'A', { fetch, verifyHash })).toString()).toBe('A')
  })
})
```

- [ ] **Step 2:** `npx vitest run scripts/fetchWithFallback.test.ts` → FAIL(モジュールなし)
- [ ] **Step 3: 実装(`scripts/fetchWithFallback.mjs`)**

```js
import { verifyHash as defaultVerify } from './modelFiles.mjs'

// sources を先頭から順に試し、取得でき、かつ SHA-256 が合った最初のものを返す。
export async function fetchVerified(sources, sha256, deps = {}) {
  const doFetch = deps.fetch ?? fetch
  const verify = deps.verifyHash ?? defaultVerify
  const failures = []
  for (const url of sources) {
    try {
      const res = await doFetch(url)
      if (!res.ok) {
        failures.push(`${url}: HTTP ${res.status}`)
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (!verify(buf, sha256)) {
        failures.push(`${url}: SHA-256 不一致`)
        continue
      }
      return buf
    } catch (e) {
      failures.push(`${url}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(`全ソースで取得に失敗しました\n${failures.join('\n')}`)
}
```

- [ ] **Step 4:** テスト PASS を確認。
- [ ] **Step 5:** `modelFiles.mjs` を `sources: [公式URL]` 形式に変更(URLとSHA-256は Task 0 の表から転記。R2の個人バケットは**削除**)。`fetch-models.mjs` は `fetchVerified(f.sources, f.sha256)` を使うよう書き換え、スキップ判定(既存ファイルのハッシュ一致)は維持。`modelFiles.test.ts` の「5件」テストは件数固定をやめ、「全エントリが `sources` を1つ以上持ち、モデル4本は64桁hexの sha256 を持つ」に変える。
- [ ] **Step 6: NDLmoji.yaml の食い違いを解消する(要判断)**

公式 `src/config/NDLmoji.yaml`(42,434 B、charset 7145文字と見える)と現行(ndlocrlite-web版、42,430 B、7141文字)を、`JSON.parse` した `charset_train` で比較し、差分の文字を列挙する(先頭から7081文字目付近)。その上で実機スモークを両方の yaml で行う:公式 yaml を `public/config/NDLmoji.yaml` に置き、`npm run dev` で `kumonoito.png`(ndlocrlite-web の `public/kumonoito.png`)をOCRし、認識結果が Phase2 のスモーク(「或日のことでございます。お釋迦様は極樂の蓮池のふちを、獨りでぶらぶらお歩きになつ / ていらつしやいました。」)と**一致する**かを見る。一致し、かつ差分が末尾の追加文字などモデルの出力範囲外なら公式 yaml を採用(ハッシュを `modelFiles.mjs` に記録)。**一致しない場合はコミットせず、差分と結果を報告して止まる**(charList の並びずれは静かに誤認識になるため)。語彙サイズ 7142 との整合(`7145` だと `id-1` の写像で範囲外参照が起きないか)も確認して報告に書く。

- [ ] **Step 7:** `npm run fetch-models`(既存ファイルを消してから実行して本当に取得できることを確認)→ `npm test && npm run typecheck && npm run lint && npm run build`
- [ ] **Step 8: Commit** — `git commit -m "feat: モデルの取得元をNDL公式リポジトリの固定コミットにし、複数ソースのフォールバックに対応する"`

---

### Task 2: R2ミラー用ツール(コードのみ。バケット操作はしない)

**Files:**
- Create: `scripts/mirrorPlan.mjs`, `scripts/mirrorPlan.test.ts`, `scripts/mirror-models.mjs`, `docs/ops/cloudflare-r2.md`(骨格。埋めるのは Task 3)
- Modify: `package.json`(`"mirror-models": "node scripts/mirror-models.mjs"`)

**Interfaces:**
- Consumes: `MODEL_FILES`(Task 1)
- Produces:
```js
// mirrorPlan.mjs — 純粋関数。キーは内容アドレス(ハッシュ入り)にして不変・キャッシュ可能にする
export function mirrorKey(file /* {dest, sha256} */): string   // 例 'models/9e651bae…772d/parseq-….onnx'
export function buildMirrorPlan(files, bucket): { key: string; localPath: string; wranglerArgs: string[] }[]
```

- [ ] **Step 1: 失敗するテスト**

```ts
import { describe, expect, it } from 'vitest'
// @ts-expect-error mjs without types
import { mirrorKey, buildMirrorPlan } from './mirrorPlan.mjs'

const f = { dest: 'public/models/a.onnx', sha256: 'ab'.repeat(32), sources: ['x'] }

describe('mirrorKey', () => {
  it('ハッシュを含む不変キーになる', () => {
    expect(mirrorKey(f)).toBe(`models/${'ab'.repeat(32)}/a.onnx`)
  })
  it('sha256 が null のファイルはミラー不可', () => {
    expect(() => mirrorKey({ ...f, sha256: null })).toThrow(/sha256/)
  })
})

describe('buildMirrorPlan', () => {
  it('wrangler r2 object put の引数を組み立てる(実行はしない)', () => {
    const [p] = buildMirrorPlan([f], 'ebook-maker-models')
    expect(p.wranglerArgs).toEqual([
      'r2', 'object', 'put', `ebook-maker-models/models/${'ab'.repeat(32)}/a.onnx`,
      '--file', 'public/models/a.onnx', '--remote',
      '--content-type', 'application/octet-stream',
      '--cache-control', 'public, max-age=31536000, immutable',
    ])
  })
})
```

- [ ] **Step 2:** FAIL 確認 → **Step 3:** 実装

```js
import { basename } from 'node:path'

export function mirrorKey(file) {
  if (!file.sha256) throw new Error(`sha256 が未記録のファイルはミラーできません: ${file.dest}`)
  return `models/${file.sha256}/${basename(file.dest)}`
}

export function buildMirrorPlan(files, bucket) {
  return files
    .filter((f) => f.sha256)
    .map((f) => ({
      key: mirrorKey(f),
      localPath: f.dest,
      wranglerArgs: [
        'r2', 'object', 'put', `${bucket}/${mirrorKey(f)}`,
        '--file', f.dest, '--remote',
        '--content-type', 'application/octet-stream',
        '--cache-control', 'public, max-age=31536000, immutable',
      ],
    }))
}
```

- [ ] **Step 4:** PASS 確認。
- [ ] **Step 5:** `mirror-models.mjs` を書く。既定は **dry-run**(計画を表示するだけ)で、`--execute` を付けたときだけ `npx wrangler` を `child_process.spawnSync` で実行する。事前に `public/models/` の各ファイルのSHA-256を再検証し、不一致なら中止。バケット名は `R2_BUCKET` 環境変数(未設定ならエラー)。`--execute` 以外で外部へ書き込まないこと。
- [ ] **Step 6:** `docs/ops/cloudflare-r2.md` に見出しだけの骨格(§前提 / §バケット作成 / §APIトークン / §ミラー実行 / §Secrets / §確認)を作る(中身は Task 3 で実際の実行結果と一緒に書く)。
- [ ] **Step 7:** `npm test && npm run typecheck && npm run lint`(dry-run の手動確認: `R2_BUCKET=x npm run mirror-models` が書き込みなしで計画のみ出力すること)
- [ ] **Step 8: Commit** — `git commit -m "feat: モデルをR2へミラーするツール(dry-run既定)を追加する"`

---

### Task 3: Cloudflare アカウント・R2バケットの作成とミラー実行(所有者操作)

> **このタスクは外部サービスの契約・課金・書き込みを伴う。エージェントは各コマンドの実行前に所有者の明示承認を得ること。承認なしに実行しない。** 認証は所有者が `! npx wrangler login`(セッション内実行)で行う。

**Files:**
- Modify: `docs/ops/cloudflare-r2.md`(実行した手順と結果を記録。トークン等は書かない)

- [ ] **Step 1: 所有者が行うこと(エージェントは案内のみ)**
  1. Cloudflare アカウントを作成(https://dash.cloudflare.com/sign-up)。R2 の有効化にはクレジットカード等の支払い方法の登録が求められる場合がある(無料枠内なら課金されない。無料枠は保存 10 GB-month・Class A 100万/月・Class B 1000万/月・egress無料。モデルは合計 157 MB)。
  2. ローカルで `! npx wrangler login`(ブラウザでの認可)。
  3. 「Cloudflare の"プロジェクト"」について確認: **R2バケットに Pages/Workers プロジェクトは不要**。Pages プロジェクトが必要になるのは、アプリ自体をCloudflare Pages へ移す場合(§スコープ外)のみ。今回は作らない。所有者がここで別意図(例: アプリの移行)を持っているならこのタスクで止めて計画を見直す。
- [ ] **Step 2: バケット作成(承認後)**

```bash
npx wrangler r2 bucket create ebook-maker-models
npx wrangler r2 bucket list
```
Expected: 一覧に `ebook-maker-models` が出る。**公開設定(r2.dev有効化・カスタムドメイン)は行わない**(非公開のまま)。

- [ ] **Step 3: ミラー実行(承認後)**

```bash
npm run fetch-models
R2_BUCKET=ebook-maker-models npm run mirror-models             # dry-run で計画確認
R2_BUCKET=ebook-maker-models npm run mirror-models -- --execute
npx wrangler r2 object get ebook-maker-models/models/<sha256>/<file> --file "$SCRATCHPAD/check.onnx" --remote
sha256sum "$SCRATCHPAD/check.onnx"  # 元のハッシュと一致すること
```

- [ ] **Step 4: CI用のAPIトークンを作る(所有者)**

Cloudflare ダッシュボード → R2 → API トークン → 「オブジェクトの読み取り専用」権限を `ebook-maker-models` バケットに限定して発行(書き込み権限は付けない)。アカウントID・アクセスキーID・シークレットをGitHubの `Settings → Secrets and variables → Actions` に `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` として登録。**値をチャットやコミットに貼らない。**

- [ ] **Step 5:** `docs/ops/cloudflare-r2.md` に実行した手順・確認結果(トークン以外)を記録する。
- [ ] **Step 6: Commit** — `git commit -m "docs: Cloudflare R2ミラーの構築手順と結果を記録する"`

---

### Task 4: ミラーをフォールバックに組み込み、CIで死活監視する

**Files:**
- Modify: `scripts/modelFiles.mjs`, `scripts/fetch-models.mjs`, `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`
- Create: `scripts/r2Source.mjs`, `scripts/r2Source.test.ts`, `scripts/verifySources.mjs`, `.github/workflows/verify-models.yml`

**Interfaces:**
- Consumes: `fetchVerified`(Task 1), `mirrorKey`(Task 2)
- Produces:
```js
// r2Source.mjs — Secrets があるときだけ R2 を二次ソースとして取得する関数を返す(認証は S3互換API/署名が必要なので wrangler を使う)
export function r2FallbackEnabled(env): boolean   // R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET が全部あるとき true
export async function fetchFromR2(file, env, run = spawnSync): Promise<Buffer>   // wrangler r2 object get
```

- [ ] **Step 1: 失敗するテスト** — `r2FallbackEnabled` は4変数が揃ったときだけ true(1つ欠けたら false、Secrets のないフォークPRで CI が落ちないことが目的)。`fetchFromR2` は `run` を偽物にして、`wrangler r2 object get <bucket>/<mirrorKey> --file <tmp> --remote` が組み立てられ、失敗時に例外を投げることをテスト。
- [ ] **Step 2:** FAIL → 実装 → PASS。(`wrangler` は `npx wrangler` を使う。devDependency に追加する場合は `package.json` と lock の変更をこのコミットに含める)
- [ ] **Step 3:** `fetch-models.mjs` を「公式 → (Secretsがあれば)R2」の順に試すよう変更。二次に落ちたときは標準出力に `WARN: 公式ソースから取得できなかったため R2 ミラーを使用` と出す。
- [ ] **Step 4:** `scripts/verifySources.mjs` — 各ファイルの**一次ソースを HEAD/GET して存在とハッシュを確認**し、二次(R2)は Secrets があれば確認する。失敗は非0終了。`.github/workflows/verify-models.yml` は `schedule: cron('0 3 * * 1')` と `workflow_dispatch` で実行し、失敗時は GitHub の通常のワークフロー失敗通知に任せる。
- [ ] **Step 5:** `deploy.yml` の fetch ステップに `env:`(R2の4 Secrets)を渡す。キャッシュキーは `hashFiles('scripts/modelFiles.mjs')` のまま(ソース変更で再取得)。`ci.yml` は変更しない(モデルを取得しない)。
- [ ] **Step 6:** 手動確認 — 一次ソースのURLをわざと壊して `npm run fetch-models` を実行し、R2 フォールバックで取得・検証が通ること(所有者のローカル環境変数で。**Secrets はログに出さない**)。
- [ ] **Step 7:** `npm test && npm run typecheck && npm run lint && npm run build`
- [ ] **Step 8: Commit** — `git commit -m "feat: R2ミラーをフォールバック取得に組み込み、ソースの死活監視を追加する"`

---

### Task 5: ドキュメントの更新とPR

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-09-21-ocr-phase2-model-notes.md`, `docs/superpowers/specs/2026-09-21-ocr-phase2-design.md`

- [ ] **Step 1:** README の「OCRモデルの出典」「既知の制限」から「個人バケット依存」の記述と「次フェーズの課題」行を削除し、出典を「NDL公式リポジトリ(固定コミット)/ 自前R2ミラー(フォールバック)」に更新。帰属表示の文言を実態に合わせる(Task 0 のライセンス結論に従う)。`fetch-models` の説明に「取得元は公式→ミラーの順、SHA-256検証」を追記。
- [ ] **Step 2:** model-notes の「Residual risk」を解消済みとして更新し(公式リポジトリでバイト同一と確認)、design の「残タスク」節を完了扱いにする。
- [ ] **Step 3:** `npm test && npm run typecheck && npm run lint && npm run build`
- [ ] **Step 4: Commit** — `git commit -m "docs: モデルの出典と配布方式を更新する"`
- [ ] **Step 5:** PR を作成(ベースは #19 の状態に応じて決める)。本文に判断表(R2は最適か)と、所有者が行った外部操作を記載。

---

## スコープ外(別フェーズ候補)

- **R2 公開(カスタムドメイン)からの実行時取得(案C)**: 自前ドメインがCloudflareにあり、Pagesのサイズ/モデルの頻繁な差し替えが問題になったときに検討。
- **Cloudflare Pages 等へのアプリ移行とマルチスレッドWASM**: COOP/COEP で SharedArrayBuffer が使えるとOCRの高速化が見込めるが、別オリジンのモデルに CORP/CORS が必要になる。実測(スレッド数と速度)を含む別計画にする。
- **自前で再学習/変換したモデルの配布**: `train/` の手順が「準備中」の部分があり、学習データ(Minhon 等)の権利確認が前提。

## Self-Review

- **カバレッジ:** 「モデルを自分で用意」= Task 0-1(公式から固定取得、バイト同一を実証)+ Task 2-4(自前R2ミラーと自動フォールバック)。「R2バケットの登録・Cloudflareのプロジェクト」= Task 3(所有者操作として明示。Pagesプロジェクトは不要と判断し理由を記載)。「R2が最適かの判断」= 冒頭の判断表とTask 0のADR。
- **プレースホルダ:** Task 0 のライセンス確認と Task 1 Step 6 は結果次第で分岐するため、分岐条件と停止条件を明記した(推測で進めない)。`<sha256>/<file>` は Task 3 実行時に `mirrorKey` の出力で埋まる値。
- **型の一貫性:** `MODEL_FILES` は Task 1 で `{dest, sha256, sources}` になり、Task 2 の `mirrorKey/buildMirrorPlan` と Task 4 の `fetchFromR2` が同じ形を使う。`fetchVerified(sources, sha256, deps)` は Task 1 で定義し Task 4 で再利用。
- **未確定(実行前に所有者判断が要る点):** ①公式モデルの再配布可否(Task 0 で原文確認)、②公式yamlとの不整合(Task 1 Step 6)、③Cloudflareの契約・課金情報の登録(Task 3)。
