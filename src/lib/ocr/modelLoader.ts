// Cache API に置くモデルの保管庫名。モデルを差し替えるときは URL を変えるか
// この名前を変える(ファイル名にエポック数等が入るので実質URLが変わる)。
export const MODEL_CACHE_NAME = 'ebook-maker-ocr-models'

// OCR_CONFIG の URL はサイト相対なので、アプリのベースパス(Viteの base)を
// 付けて絶対URLにする。Worker 内でも self.location が使えるので同じ式で動く。
export function resolveModelUrl(siteRelativeUrl: string): string {
  return new URL(import.meta.env.BASE_URL + siteRelativeUrl, self.location.origin).href
}

async function openCache(): Promise<Cache | undefined> {
  // Worker でも caches は使えるが、非セキュアコンテキストやテスト環境では無い。
  if (typeof caches === 'undefined') return undefined
  try {
    return await caches.open(MODEL_CACHE_NAME)
  } catch {
    return undefined
  }
}

// モデル本体を取得する。Cache API に入っていればネットワークを使わない。
// onProgress は受信済みバイト数と Content-Length を渡す(Content-Length が
// 無ければ total は 0 になる)。キャッシュ命中時は完了として1回だけ呼ぶ。
export async function loadModelBytes(
  url: string,
  onProgress?: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const cache = await openCache()
  const cached = await cache?.match(url)
  if (cached) {
    const bytes = await cached.arrayBuffer()
    onProgress?.(bytes.byteLength, bytes.byteLength)
    return bytes
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`モデルの取得に失敗しました (${res.status}): ${url}`)
  const total = Number(res.headers.get('Content-Length') ?? 0)

  let bytes: ArrayBuffer
  if (res.body) {
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      onProgress?.(received, total)
    }
    const merged = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    bytes = merged.buffer
  } else {
    bytes = await res.arrayBuffer()
    onProgress?.(bytes.byteLength, total || bytes.byteLength)
  }

  // 保存に失敗(容量不足など)しても推論は続けられるので無視する。
  try {
    await cache?.put(
      url,
      new Response(bytes.slice(0), { headers: { 'Content-Length': String(bytes.byteLength) } }),
    )
  } catch {
    /* 無視 */
  }
  return bytes
}
