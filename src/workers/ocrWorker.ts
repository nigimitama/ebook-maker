// 型チェックは tsconfig.worker.json が担当し、DOMの代わりにWebWorkerのlibを
// 与える(ここに `/// <reference lib="webworker" />` を書くと、このファイルの
// importを共有するappプロジェクト側にWorkerのグローバルが漏れてしまう)。
//
// onnxruntime-web は WebGPU/JSEP を含まない wasm ビルドだけを使う。
// wasm本体はCDNではなくViteの `?url` で自サイトから配信する。
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import type { RawImage } from '../types'
import { evictModel, loadModelBytes, resolveModelUrl } from '../lib/ocr/modelLoader'
import type { OcrWorkerRequest, OcrWorkerResponse } from '../lib/ocr/ocrMessages'
import { OCR_CONFIG, type RecognizerKey } from '../lib/ocr/ocrConfig'
import { runOcr, type OcrSessions } from '../lib/ocr/ocrPipeline'
import { parseCharset } from '../lib/ocr/recognizePost'

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
ort.env.wasm.numThreads = 1 // マルチスレッドはCOOP/COEPが必要なので使わない
ort.env.wasm.proxy = false // 既にWorker内なのでプロキシWorkerは不要
ort.env.logLevel = 'warning'

const SESSION_OPTIONS: ort.InferenceSession.SessionOptions = {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'basic',
  enableCpuMemArena: false,
  enableMemPattern: false,
  logSeverityLevel: 4,
}

function post(message: OcrWorkerResponse): void {
  ;(self as unknown as Worker).postMessage(message)
}

// src/workers/exportWorker.ts と同じ手順。createImageBitmap と
// OffscreenCanvas はどちらも Worker 内で使える。
async function decodeBlobViaCanvas(blob: Blob): Promise<RawImage> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    return { data: imageData.data, width: imageData.width, height: imageData.height }
  } finally {
    bitmap.close()
  }
}

// セッションと文字セットはページをまたいで使い回す(読み込みが重いため)。
// Promise を保持するので、同時に呼ばれても読み込みは1回で済む。
let charsetPromise: Promise<string[]> | undefined
let layoutPromise: Promise<ort.InferenceSession> | undefined
const recognizerPromises = new Map<RecognizerKey, Promise<ort.InferenceSession>>()

// 失敗した Promise を握り続けると再試行できなくなるので、失敗時は忘れる。
function forgetOnFailure<T>(promise: Promise<T>, forget: () => void): Promise<T> {
  promise.catch(forget)
  return promise
}

function loadCharset(): Promise<string[]> {
  charsetPromise ??= forgetOnFailure(
    (async () => {
      const res = await fetch(resolveModelUrl(OCR_CONFIG.charsetUrl))
      if (!res.ok) throw new Error(`文字セットの取得に失敗しました (${res.status})`)
      return parseCharset(await res.text())
    })(),
    () => {
      charsetPromise = undefined
    },
  )
  return charsetPromise
}

async function createSession(siteRelativeUrl: string): Promise<ort.InferenceSession> {
  const url = resolveModelUrl(siteRelativeUrl)
  const bytes = await loadModelBytes(url)
  try {
    return await ort.InferenceSession.create(bytes, SESSION_OPTIONS)
  } catch (error) {
    // 保存していたバイト列が壊れていた可能性があるので捨てる。
    // これをしないと壊れたキャッシュを永久に読み続けてしまう。
    await evictModel(url)
    throw error
  }
}

function loadLayout(): Promise<ort.InferenceSession> {
  layoutPromise ??= forgetOnFailure(createSession(OCR_CONFIG.layout.url), () => {
    layoutPromise = undefined
  })
  return layoutPromise
}

function loadRecognizer(key: RecognizerKey): Promise<ort.InferenceSession> {
  let promise = recognizerPromises.get(key)
  if (!promise) {
    promise = forgetOnFailure(createSession(OCR_CONFIG.recognizers[key].url), () => {
      recognizerPromises.delete(key)
    })
    recognizerPromises.set(key, promise)
  }
  return promise
}

// 要求ごとに作る(応答に載せる id と、'recognizing' を1回だけ流すための
// フラグを閉じ込めるため)。セッション自体は上のモジュール変数で使い回す。
function createSessions(requestId: number): OcrSessions {
  let recognizeAnnounced = false
  return {
    async detect(tensor, size) {
      const session = await loadLayout()
      // DEIM は images [1,3,size,size] と orig_target_sizes int64 [1,2] を取る。
      const out = await session.run({
        [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, size, size]),
        [session.inputNames[1]]: new ort.Tensor(
          'int64',
          BigInt64Array.from([BigInt(size), BigInt(size)]),
          [1, 2],
        ),
      })
      // 出力順は labels(int64, 1始まり) / boxes(float32) / scores / char_count(int64)。
      const [labels, boxes, scores, charCount] = session.outputNames
      return {
        classIds: out[labels].data as BigInt64Array,
        boxes: out[boxes].data as Float32Array,
        scores: out[scores].data as Float32Array,
        charCounts: charCount ? (out[charCount].data as BigInt64Array) : undefined,
      }
    },
    async recognize(key, tensor) {
      const spec = OCR_CONFIG.recognizers[key]
      const session = await loadRecognizer(key)
      if (!recognizeAnnounced) {
        recognizeAnnounced = true
        post({ type: 'stage', id: requestId, stage: 'recognizing' })
      }
      const out = await session.run({
        [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, spec.height, spec.width]),
      })
      // 出力名はビルド依存の数値なので outputNames[0] で引く。
      const logits = out[session.outputNames[0]]
      const [, seqLen, vocab] = logits.dims
      return { logits: logits.data as Float32Array, seqLen, vocab }
    },
  }
}

self.onmessage = async (event: MessageEvent<OcrWorkerRequest>) => {
  // id は応答にそのまま載せ返す(メインスレッドが古い応答を捨てられるように)。
  const { id, blob } = event.data
  try {
    post({ type: 'stage', id, stage: 'loading-models' })
    const [charset] = await Promise.all([loadCharset(), loadLayout()])
    post({ type: 'stage', id, stage: 'detecting' })
    const image = await decodeBlobViaCanvas(blob)
    const { lines } = await runOcr(image, createSessions(id), charset)
    post({ type: 'done', id, ok: true, lines })
  } catch (error) {
    post({
      type: 'done',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
