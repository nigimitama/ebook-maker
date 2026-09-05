import type { ExportRequest } from '../workers/exportCore'

export function runExportInWorker(request: ExportRequest): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/exportWorker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (
      event: MessageEvent<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }>,
    ) => {
      worker.terminate()
      if (event.data.ok) {
        const mimeType = request.format === 'pdf' ? 'application/pdf' : 'application/epub+zip'
        resolve(new Blob([new Uint8Array(event.data.bytes)], { type: mimeType }))
      } else {
        reject(new Error(event.data.error))
      }
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    worker.postMessage(request)
  })
}
