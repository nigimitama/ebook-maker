import type { ExportRequest } from '../workers/exportCore'

type WorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string }

export function runExportInWorker(
  request: ExportRequest,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/exportWorker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const data = event.data
      if ('type' in data) {
        onProgress?.(data.done, data.total)
        return
      }
      worker.terminate()
      if (data.ok) {
        const mimeType = request.format === 'pdf' ? 'application/pdf' : 'application/epub+zip'
        resolve(new Blob([new Uint8Array(data.bytes)], { type: mimeType }))
      } else {
        reject(new Error(data.error))
      }
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    worker.postMessage(request)
  })
}
