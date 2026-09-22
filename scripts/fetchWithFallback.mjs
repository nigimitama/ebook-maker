import { verifyHash as defaultVerify } from './modelFiles.mjs'
import { fetchWithTimeout } from './fetchTimeout.mjs'

// sources を先頭から順に試し、取得でき、かつ SHA-256 が合った最初のものを返す。
// 一次(先頭)が落ちていても、改ざん・更新でハッシュがずれていても次のソースへ回す。
// 全ソース失敗時は各ソースの失敗理由を列挙した Error を投げる。
export async function fetchVerified(sources, sha256, deps = {}) {
  const doFetch = deps.fetch ?? fetch
  const verify = deps.verifyHash ?? defaultVerify
  const failures = []
  for (const url of sources) {
    try {
      const res = await fetchWithTimeout(doFetch, url, {}, deps.timeoutMs)
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
