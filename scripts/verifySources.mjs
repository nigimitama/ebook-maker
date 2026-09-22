// 各モデルファイルについて、公式ソースと(Secrets があれば)R2 ミラーを実際に取得して
// SHA-256 を照合し、ソース単位で生死を表示する。
//
// 警報の設計: R2 ミラーが生きていると「取得はできる」状態が続くため、公式ソースが消えても
// 総合的には緑になってしまう。それでは「一次ソースが死んだことの早期警告」という
// 本来の目的を、まさに必要なときに失う。そこで公式の生死と R2 の生死を別々に数え、
//   - 公式が全滅したファイルがある        → 非0終了 + ::error::(R2 が代替していても鳴らす)
//   - さらに R2 も駄目で生存0本           → 非0終了 + ::error::(より重い文面)
//   - 公式は生きていて R2 だけ駄目        → 終了コード0 + ::warning::(ミラー再実行を促す)
//   - R2 の Secrets が無い(フォーク等)  → 注釈なし。公式ソースの検査だけ行う
// とする。
import { MODEL_FILES, sha256Hex } from './modelFiles.mjs'
import { fetchFromR2 as defaultFetchFromR2, r2FallbackEnabled } from './r2Source.mjs'

/** 取得して期待ハッシュと突き合わせる。例外は投げず結果に畳み込む。 */
async function checkUrl(url, expected, doFetch) {
  try {
    const res = await doFetch(url)
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    return checkBuffer(Buffer.from(await res.arrayBuffer()), expected)
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

function checkBuffer(buf, expected) {
  const actual = sha256Hex(buf)
  if (expected != null && actual !== expected) {
    return { ok: false, detail: `SHA-256 不一致 (actual=${actual})` }
  }
  return { ok: true, detail: `${buf.length} bytes` }
}

async function checkR2(file, env, doFetchFromR2) {
  try {
    return checkBuffer(await doFetchFromR2(file, env), file.sha256)
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * @returns {{officialDead: string[], fullyDead: string[], r2Dead: string[]}}
 *   officialDead: 公式ソースが全滅したファイル / fullyDead: 公式もR2も駄目なファイル /
 *   r2Dead: R2 ミラーだけ駄目なファイル(Secrets がある場合のみ判定)
 */
export async function verifyAll(files, env, deps = {}) {
  const doFetch = deps.fetch ?? fetch
  const doFetchFromR2 = deps.fetchFromR2 ?? defaultFetchFromR2
  const log = deps.log ?? console.log

  const r2 = r2FallbackEnabled(env)
  log(r2 ? 'R2 ミラー: Secrets あり → 検査対象に含めます' : 'R2 ミラー: Secrets なし → 公式ソースのみ検査します')

  const officialDead = []
  const fullyDead = []
  const r2Dead = []

  for (const f of files) {
    log(`\n=== ${f.dest} (sha256=${f.sha256 ?? '未記録'})`)
    let officialAlive = 0
    for (const url of f.sources) {
      const r = await checkUrl(url, f.sha256, doFetch)
      if (r.ok) officialAlive += 1
      log(`  ${r.ok ? 'OK  ' : 'FAIL'} 公式 ${url} — ${r.detail}`)
    }

    let r2Alive = null
    if (r2 && f.sha256) {
      const r = await checkR2(f, env, doFetchFromR2)
      r2Alive = r.ok
      if (!r.ok) r2Dead.push(f.dest)
      log(`  ${r.ok ? 'OK  ' : 'FAIL'} R2 ミラー — ${r.detail}`)
    }

    if (officialAlive === 0) officialDead.push(f.dest)
    if (officialAlive === 0 && r2Alive !== true) fullyDead.push(f.dest)
    log(`  → 公式で生きているソース: ${officialAlive}${r2Alive === null ? '' : ` / R2: ${r2Alive ? 'OK' : 'NG'}`}`)
  }

  log('')
  for (const dest of fullyDead) {
    log(`::error::生きている取得元がありません: ${dest}(公式もR2ミラーも取得できません。配信が止まります)`)
  }
  for (const dest of officialDead.filter((d) => !fullyDead.includes(d))) {
    log(`::error::公式ソースが全滅しました: ${dest}(R2ミラーで代替できていますが、一次ソースの復旧・差し替えが必要です)`)
  }
  for (const dest of r2Dead.filter((d) => !fullyDead.includes(d))) {
    log(`::warning::R2ミラーが取得できません: ${dest}(mirror-models の再実行が必要かもしれません)`)
  }
  if (officialDead.length === 0 && r2Dead.length === 0) {
    log('全ファイルについて公式ソース' + (r2 ? 'とR2ミラー' : '') + 'が健全です')
  }

  return { officialDead, fullyDead, r2Dead }
}

/** 公式ソースが全滅したファイルが1つでもあれば非0。R2 だけの不調は終了コードに影響させない。 */
export function exitCodeFor({ officialDead }) {
  return officialDead.length > 0 ? 1 : 0
}

// エントリポイントとして起動されたときだけ実行する(テストからの import では走らせない)。
if (process.argv[1]?.endsWith('verifySources.mjs')) {
  const result = await verifyAll(MODEL_FILES, process.env)
  process.exit(exitCodeFor(result))
}
