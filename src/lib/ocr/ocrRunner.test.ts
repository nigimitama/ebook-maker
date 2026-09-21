import { describe, it, expect } from 'vitest'
import { createOcrRunner } from './ocrRunner'
import type { OcrWorkerRequest, OcrWorkerResponse } from './ocrMessages'
import type { OcrLine } from './types'

const line = (text: string): OcrLine => ({ id: 'l1', x: 0, y: 0, w: 10, h: 10, text, edited: false })

// Worker の偽物。postMessage された要求を受け取り、テスト側から
// 任意のタイミングで応答・error・messageerror を起こせるようにする。
class FakeWorker extends EventTarget {
  requests: OcrWorkerRequest[] = []
  terminated = 0

  postMessage(request: OcrWorkerRequest): void {
    this.requests.push(request)
  }
  terminate(): void {
    this.terminated += 1
  }
  reply(response: OcrWorkerResponse): void {
    this.dispatchEvent(new MessageEvent('message', { data: response }))
  }
  // 直近の要求に対して成功応答を返す
  replyOk(texts: string[]): void {
    const id = this.requests[this.requests.length - 1].id
    this.reply({ type: 'done', id, ok: true, lines: texts.map(line) })
  }
  failScript(message: string): void {
    this.dispatchEvent(new ErrorEvent('error', { message }))
  }
  failMessage(): void {
    this.dispatchEvent(new MessageEvent('messageerror', { data: null }))
  }
}

function setup() {
  const workers: FakeWorker[] = []
  const runner = createOcrRunner(() => {
    const w = new FakeWorker()
    workers.push(w)
    return w as unknown as Worker
  })
  return { runner, workers }
}

const blob = new Blob(['x'])

describe('createOcrRunner', () => {
  it('Workerの応答を行として返し、stageを転送する', async () => {
    const { runner, workers } = setup()
    const stages: string[] = []
    const promise = runner.recognizePage(blob, (s) => stages.push(s))
    await Promise.resolve()

    const w = workers[0]
    expect(w.requests).toHaveLength(1)
    const id = w.requests[0].id
    w.reply({ type: 'stage', id, stage: 'detecting' })
    w.replyOk(['あ', 'い'])

    await expect(promise).resolves.toEqual([line('あ'), line('い')])
    expect(stages).toEqual(['detecting'])
    runner.dispose()
  })

  it('複数ページでもWorkerは1つを使い回す', async () => {
    const { runner, workers } = setup()
    const first = runner.recognizePage(blob)
    await Promise.resolve()
    workers[0].replyOk(['1'])
    await first

    const second = runner.recognizePage(blob)
    await Promise.resolve()
    await Promise.resolve()
    workers[0].replyOk(['2'])
    await expect(second).resolves.toEqual([line('2')])
    expect(workers).toHaveLength(1)
    expect(workers[0].requests).toHaveLength(2)
    runner.dispose()
  })

  it('要求中に dispose すると待っているPromiseが拒否される', async () => {
    const { runner, workers } = setup()
    const promise = runner.recognizePage(blob)
    await Promise.resolve()
    expect(workers[0].requests).toHaveLength(1)

    runner.dispose()

    await expect(promise).rejects.toThrow(/破棄されました/)
    expect(workers[0].terminated).toBe(1)
  })

  it('dispose 後の recognizePage は拒否され、Workerも作られない', async () => {
    const { runner, workers } = setup()
    runner.dispose()
    await expect(runner.recognizePage(blob)).rejects.toThrow(/破棄されました/)
    expect(workers).toHaveLength(0)
  })

  it('dispose はキューで待っている要求も拒否する', async () => {
    const { runner, workers } = setup()
    const first = runner.recognizePage(blob)
    const second = runner.recognizePage(blob)
    await Promise.resolve()
    expect(workers[0].requests).toHaveLength(1) // 直列なので2件目はまだ送っていない

    runner.dispose()

    await expect(first).rejects.toThrow(/破棄されました/)
    await expect(second).rejects.toThrow(/破棄されました/)
  })

  it('error イベントでWorkerを捨て、次の要求で作り直す', async () => {
    const { runner, workers } = setup()
    const first = runner.recognizePage(blob)
    await Promise.resolve()
    workers[0].failScript('Failed to load worker script')

    await expect(first).rejects.toThrow(/Failed to load worker script/)
    expect(workers[0].terminated).toBe(1)

    const second = runner.recognizePage(blob)
    await Promise.resolve()
    await Promise.resolve()
    expect(workers).toHaveLength(2)
    workers[1].replyOk(['再試行'])
    await expect(second).resolves.toEqual([line('再試行')])
    runner.dispose()
  })

  it('messageerror でもWorkerを捨てて拒否する', async () => {
    const { runner, workers } = setup()
    const promise = runner.recognizePage(blob)
    await Promise.resolve()
    workers[0].failMessage()

    await expect(promise).rejects.toThrow()
    expect(workers[0].terminated).toBe(1)
    runner.dispose()
  })

  it('古いidの応答は無視する', async () => {
    const { runner, workers } = setup()
    const promise = runner.recognizePage(blob)
    await Promise.resolve()
    const w = workers[0]
    const id = w.requests[0].id

    // 存在しないidの応答は何も起こさない
    w.reply({ type: 'done', id: id + 999, ok: true, lines: [line('別の要求')] })
    w.reply({ type: 'done', id, ok: true, lines: [line('正しい応答')] })

    await expect(promise).resolves.toEqual([line('正しい応答')])
    runner.dispose()
  })

  it('Workerがエラーを返せば例外にする', async () => {
    const { runner, workers } = setup()
    const promise = runner.recognizePage(blob)
    await Promise.resolve()
    const id = workers[0].requests[0].id
    workers[0].reply({ type: 'done', id, ok: false, error: 'モデルの取得に失敗しました' })
    await expect(promise).rejects.toThrow(/モデルの取得に失敗しました/)
    // 応答としてのエラーはWorkerを壊さないので使い回す
    expect(workers[0].terminated).toBe(0)
    runner.dispose()
  })
})
