import type { OcrStage, OcrWorkerRequest, OcrWorkerResponse } from './ocrMessages'
import type { OcrLine } from './types'

export interface OcrRunner {
  recognizePage(blob: Blob, onStage?: (stage: OcrStage) => void): Promise<OcrLine[]>
  dispose(): void
}

const DISPOSED_MESSAGE = 'OcrRunner は破棄されました'

// 既定のWorker生成。`new URL(..., import.meta.url)` はViteがWorkerチャンクに
// 変換するため、関数の中に置いても静的に解析される。
function spawnOcrWorker(): Worker {
  return new Worker(new URL('../../workers/ocrWorker.ts', import.meta.url), { type: 'module' })
}

interface Pending {
  reject: (error: Error) => void
  cleanup: () => void
}

// Worker はページをまたいで使い回す(モデル読み込みが重いため)。
// 1つのWorkerを直列に使うので、要求はキューで順番待ちにする。
// createWorker はテストで偽のWorkerを差し込むための注入口。
export function createOcrRunner(createWorker: () => Worker = spawnOcrWorker): OcrRunner {
  let worker: Worker | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false
  let nextId = 0
  const pendings = new Set<Pending>()

  // Workerが壊れた可能性があるときは捨てる。次の要求で作り直される。
  function discardWorker(): void {
    worker?.terminate()
    worker = undefined
  }

  function rejectAll(message: string): void {
    const current = [...pendings]
    pendings.clear()
    for (const pending of current) {
      pending.cleanup()
      pending.reject(new Error(message))
    }
  }

  function send(blob: Blob, onStage?: (stage: OcrStage) => void): Promise<OcrLine[]> {
    return new Promise<OcrLine[]>((resolve, reject) => {
      worker ??= createWorker()
      const target = worker
      const id = (nextId += 1)

      const cleanup = () => {
        target.removeEventListener('message', onMessage)
        target.removeEventListener('error', onFailure)
        target.removeEventListener('messageerror', onFailure)
      }
      const pending: Pending = { reject, cleanup }
      const settle = () => {
        pendings.delete(pending)
        cleanup()
      }

      const onMessage = (event: MessageEvent<OcrWorkerResponse>) => {
        const data = event.data
        // 破棄した要求への遅れた応答(Workerを使い回すので起こりうる)は捨てる。
        if (data.id !== id) return
        if (data.type === 'stage') {
          onStage?.(data.stage)
          return
        }
        settle()
        if (data.ok) resolve(data.lines)
        else reject(new Error(data.error))
      }
      // error(スクリプト読み込み失敗など)と messageerror(構造化複製の失敗)は
      // Worker自体が信用できない状態なので、捨ててから拒否する。
      const onFailure = (event: Event) => {
        settle()
        discardWorker()
        const message =
          event instanceof ErrorEvent && event.message
            ? event.message
            : 'OCR Worker との通信に失敗しました'
        reject(new Error(message))
      }

      pendings.add(pending)
      target.addEventListener('message', onMessage)
      target.addEventListener('error', onFailure)
      target.addEventListener('messageerror', onFailure)
      const request: OcrWorkerRequest = { type: 'recognize', id, blob }
      target.postMessage(request)
    })
  }

  return {
    recognizePage(blob, onStage) {
      if (disposed) return Promise.reject(new Error(DISPOSED_MESSAGE))
      const run = () =>
        disposed ? Promise.reject(new Error(DISPOSED_MESSAGE)) : send(blob, onStage)
      // 直前の要求が失敗しても次を走らせる
      const result = queue.then(run, run)
      queue = result.catch(() => undefined)
      return result
    },
    dispose() {
      disposed = true
      discardWorker()
      // terminate は message も error も起こさないので、待っているPromiseは
      // ここで自分で拒否しないと永久に決まらない。
      rejectAll(DISPOSED_MESSAGE)
      queue = Promise.resolve()
    },
  }
}
