import type { OcrLine } from './types'

// Worker とメインスレッドの間で交わすメッセージ。
// ここを ocrWorker.ts / ocrRunner.ts のどちらにも置かないのは、
// 型を取り込む側のtsconfigプロジェクト(DOM lib と WebWorker lib)に
// 相手側のグローバル前提を持ち込まないため。
export type OcrStage = 'loading-models' | 'detecting' | 'recognizing'

export interface OcrWorkerRequest {
  type: 'recognize'
  blob: Blob
}

export type OcrWorkerResponse =
  | { type: 'stage'; stage: OcrStage }
  | { ok: true; lines: OcrLine[] }
  | { ok: false; error: string }
