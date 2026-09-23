// OCRの同時処理数(=同時に動かすOCR Workerの数)の設定。
export const OCR_CONCURRENCY_STORAGE_KEY = 'ebook-maker:ocr-concurrency'

export type OcrSettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

const FALLBACK_CORES = 2
const PREFERRED_DEFAULT = 2

// UI操作用にメインスレッドへ1コア残す。
export function maxOcrConcurrency(cores: number | undefined): number {
  const n = typeof cores === 'number' && Number.isFinite(cores) && cores >= 1 ? Math.floor(cores) : FALLBACK_CORES
  return Math.max(1, n - 1)
}

export function defaultOcrConcurrency(max: number): number {
  return Math.min(PREFERRED_DEFAULT, max)
}

export function clampOcrConcurrency(n: number, max: number): number {
  if (!Number.isFinite(n)) return defaultOcrConcurrency(max)
  return Math.min(max, Math.max(1, Math.floor(n)))
}

export function loadOcrConcurrency(max: number, storage: OcrSettingsStorage | undefined): number {
  try {
    const raw = storage?.getItem(OCR_CONCURRENCY_STORAGE_KEY)
    if (raw == null || raw.trim() === '') return defaultOcrConcurrency(max)
    return clampOcrConcurrency(Number(raw), max)
  } catch {
    return defaultOcrConcurrency(max)
  }
}

export function saveOcrConcurrency(n: number, storage: OcrSettingsStorage | undefined): void {
  try {
    storage?.setItem(OCR_CONCURRENCY_STORAGE_KEY, String(n))
  } catch {
    /* 保存できなくても今回の実行には影響しない */
  }
}

// プライベートモード等では localStorage へのアクセス自体が例外になりうる。
export function browserStorage(): OcrSettingsStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}
