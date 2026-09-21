import type { OcrLine } from './types'

// Worker とメインスレッドの間で交わすメッセージ。
// ここを ocrWorker.ts / ocrRunner.ts のどちらにも置かないのは、
// 型を取り込む側のtsconfigプロジェクト(DOM lib と WebWorker lib)に
// 相手側のグローバル前提を持ち込まないため。
export type OcrStage = 'loading-models' | 'detecting' | 'recognizing'

export interface OcrWorkerRequest {
  type: 'recognize'
  // 要求の識別子。Workerは応答にそのまま載せ返す。破棄済み要求への
  // 遅れた応答を取り違えないため(Workerを使い回すので必要)。
  id: number
  blob: Blob
}

export type OcrWorkerResponse =
  | { type: 'stage'; id: number; stage: OcrStage }
  | { type: 'done'; id: number; ok: true; lines: OcrLine[] }
  | { type: 'done'; id: number; ok: false; error: string }
