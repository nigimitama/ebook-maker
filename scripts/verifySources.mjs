// 各モデルファイルについて、全ソース(公式 + Secrets があれば R2 ミラー)を実際に取得して
// SHA-256 を照合し、ソース単位で生死を表示する。
// 1ファイルでも生きているソースが0本になったら非0終了 → GitHub の通常のワークフロー失敗通知に任せる。
import { MODEL_FILES, sha256Hex } from './modelFiles.mjs'
import { fetchFromR2, r2FallbackEnabled } from './r2Source.mjs'

/** 取得して期待ハッシュと突き合わせる。例外は投げず結果に畳み込む。 */
async function checkUrl(url, expected) {
  try {
    const res = await fetch(url)
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    const buf = Buffer.from(await res.arrayBuffer())
    const actual = sha256Hex(buf)
    if (expected != null && actual !== expected) {
      return { ok: false, detail: `SHA-256 不一致 (actual=${actual})` }
    }
    return { ok: true, detail: `${buf.length} bytes` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

async function checkR2(file, env) {
  try {
    const buf = await fetchFromR2(file, env)
    const actual = sha256Hex(buf)
    if (file.sha256 != null && actual !== file.sha256) {
      return { ok: false, detail: `SHA-256 不一致 (actual=${actual})` }
    }
    return { ok: true, detail: `${buf.length} bytes` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

export async function verifyAll(files, env, log = console.log) {
  const r2 = r2FallbackEnabled(env)
  log(r2 ? 'R2 ミラー: Secrets あり → 検査対象に含めます' : 'R2 ミラー: Secrets なし → 公式ソースのみ検査します')

  const dead = []
  for (const f of files) {
    log(`\n=== ${f.dest} (sha256=${f.sha256 ?? '未記録'})`)
    let alive = 0
    for (const url of f.sources) {
      const r = await checkUrl(url, f.sha256)
      if (r.ok) alive += 1
      log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${url} — ${r.detail}`)
    }
    if (r2 && f.sha256) {
      const r = await checkR2(f, env)
      if (r.ok) alive += 1
      log(`  ${r.ok ? 'OK  ' : 'FAIL'} R2 ミラー — ${r.detail}`)
    }
    if (alive === 0) dead.push(f.dest)
    log(`  → 生きているソース: ${alive}`)
  }

  if (dead.length > 0) {
    log(`\n生きているソースが0本のファイルがあります:\n  ${dead.join('\n  ')}`)
  } else {
    log('\n全ファイルに生きているソースがあります')
  }
  return dead
}

// エントリポイントとして起動されたときだけ実行する(テストからの import では走らせない)。
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('verifySources.mjs')) {
  const dead = await verifyAll(MODEL_FILES, process.env)
  process.exit(dead.length > 0 ? 1 : 0)
}
