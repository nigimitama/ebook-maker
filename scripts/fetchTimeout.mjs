export const DEFAULT_FETCH_TIMEOUT_MS = 120_000 // モデルは最大 42MB。CIの回線速度を前提に2分を既定値とする。

/** doFetch を AbortSignal 付きで呼び、timeoutMs で打ち切る。タイムアウト時は分かりやすい Error を投げる(呼び出し側で URL を付与する想定なので、ここではURLを含めない)。 */
export async function fetchWithTimeout(doFetch, url, init = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await doFetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`タイムアウト(${timeoutMs}ms)`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}
