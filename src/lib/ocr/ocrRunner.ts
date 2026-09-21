import type { OcrStage, OcrWorkerRequest, OcrWorkerResponse } from './ocrMessages'
import type { OcrLine } from './types'

export interface OcrRunner {
  recognizePage(blob: Blob, onStage?: (stage: OcrStage) => void): Promise<OcrLine[]>
  dispose(): void
}

// Worker はページをまたいで使い回す(モデル読み込みが重いため)。
// 1つのWorkerを直列に使うので、要求はキューで順番待ちにする。
export function createOcrRunner(): OcrRunner {
  let worker: Worker | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false

  function ensureWorker(): Worker {
    worker ??= new Worker(new URL('../../workers/ocrWorker.ts', import.meta.url), {
      type: 'module',
    })
    return worker
  }

  function send(blob: Blob, onStage?: (stage: OcrStage) => void): Promise<OcrLine[]> {
    if (disposed) return Promise.reject(new Error('OcrRunner は破棄されています'))
    return new Promise<OcrLine[]>((resolve, reject) => {
      const target = ensureWorker()
      const cleanup = () => {
        target.removeEventListener('message', onMessage)
        target.removeEventListener('error', onError)
      }
      const onMessage = (event: MessageEvent<OcrWorkerResponse>) => {
        const data = event.data
        if ('type' in data) {
          onStage?.(data.stage)
          return
        }
        cleanup()
        if (data.ok) resolve(data.lines)
        else reject(new Error(data.error))
      }
      const onError = (event: ErrorEvent) => {
        cleanup()
        reject(new Error(event.message))
      }
      target.addEventListener('message', onMessage)
      target.addEventListener('error', onError)
      const request: OcrWorkerRequest = { type: 'recognize', blob }
      target.postMessage(request)
    })
  }

  return {
    recognizePage(blob, onStage) {
      const run = () => send(blob, onStage)
      // 直前の要求が失敗しても次を走らせる
      const result = queue.then(run, run)
      queue = result.catch(() => undefined)
      return result
    },
    dispose() {
      disposed = true
      worker?.terminate()
      worker = undefined
    },
  }
}
