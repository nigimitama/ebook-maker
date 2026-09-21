// Cache API に置くモデルの保管庫名。モデルを差し替えるときは URL を変えるか
// この名前を変える(ファイル名にエポック数等が入るので実質URLが変わる)。
export const MODEL_CACHE_NAME = 'ebook-maker-ocr-models'

// 正しいモデルの最小サイズ。実際は最小でも約36MB(notes参照)なので
// 1MiB は十分に緩い下限。Vite の dev/preview はモデルが無いとき
// index.html を 200 で返すので、それをモデルとして保存しないための番犬。
export const MIN_MODEL_BYTES = 1024 * 1024

// OCR_CONFIG の URL はサイト相対なので、アプリのベースパス(Viteの base)を
// 付けて絶対URLにする。Worker 内でも self.location が使えるので同じ式で動く。
export function resolveModelUrl(siteRelativeUrl: string): string {
  return new URL(import.meta.env.BASE_URL + siteRelativeUrl, self.location.origin).href
}

// 応答がモデルとして妥当かを調べ、妥当でなければ理由を返す。
// ONNX は protobuf なので先頭バイトは 0x08 (field 1 = ir_version) だが、
// ここで見るのは「明らかにモデルでないもの」だけで、正しさは証明しない。
function findProblem(bytes: ArrayBuffer, contentType: string): string | undefined {
  if (contentType.includes('text/html')) return 'モデルではなくHTMLが返りました'
  // '<' 始まりは HTML/XML。Content-Type が正しくても中身で弾く。
  if (bytes.byteLength > 0 && new Uint8Array(bytes, 0, 1)[0] === 0x3c) {
    return 'モデルではなくHTMLが返りました'
  }
  if (bytes.byteLength < MIN_MODEL_BYTES) {
    return `モデルとしては小さすぎます (${bytes.byteLength} バイト)`
  }
  return undefined
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

// 保存済みのモデルを捨てる。InferenceSession.create が失敗したとき
// (= 保存したバイト列が壊れていたとき)に呼び、次回の再取得に繋げる。
export async function evictModel(url: string): Promise<void> {
  const cache = await openCache()
  try {
    await cache?.delete(url)
  } catch {
    /* 消せなくても致命的ではない */
  }
}

// モデル本体を取得する。Cache API に入っていればネットワークを使わない。
// onProgress は受信済みバイト数と Content-Length を渡す。Content-Length が
// 無いときは total が 0 になる(全体量が不明なので、受け手は進捗不定として
// 扱うこと。0 で割らないよう注意)。キャッシュ命中時は完了として1回だけ呼ぶ。
export async function loadModelBytes(
  url: string,
  onProgress?: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const cache = await openCache()
  const cached = await cache?.match(url)
  if (cached) {
    const bytes = await cached.arrayBuffer()
    const problem = findProblem(bytes, cached.headers.get('Content-Type') ?? '')
    if (!problem) {
      onProgress?.(bytes.byteLength, bytes.byteLength)
      return bytes
    }
    // 壊れたものを握り続けると永久に直らないので、捨てて取り直す。
    await evictModel(url)
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`モデルの取得に失敗しました (${res.status}): ${url}`)
  const total = Number(res.headers.get('Content-Length') ?? 0)
  const contentType = res.headers.get('Content-Type') ?? ''

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

  // 妥当でないものは保存しない(保存すると次回も壊れたまま返ってしまう)。
  const problem = findProblem(bytes, contentType)
  if (problem) throw new Error(`${problem}: ${url}`)

  // 保存に失敗(容量不足など)しても推論は続けられるので無視する。
  try {
    await cache?.put(
      url,
      new Response(bytes.slice(0), {
        headers: {
          'Content-Length': String(bytes.byteLength),
          'Content-Type': 'application/octet-stream',
        },
      }),
    )
  } catch {
    /* 無視 */
  }
  return bytes
}
