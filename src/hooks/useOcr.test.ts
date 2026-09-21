import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { Blob as NodeBlob } from 'node:buffer'
import { ImageStore } from '../lib/imageStore'
import type { OcrRunner } from '../lib/ocr/ocrRunner'
import type { OcrLine } from '../lib/ocr/types'
import type { PageEntry } from '../types'
import { useOcr } from './useOcr'

function blob(byte: number): Blob {
  return new NodeBlob([new Uint8Array([byte])], { type: 'image/png' }) as unknown as Blob
}

function line(id: string, text: string): OcrLine {
  return { id, x: 0, y: 0, w: 10, h: 10, text, edited: false }
}

describe('useOcr', () => {
  let store: ImageStore
  let pages: PageEntry[]
  let calls: number[]
  let failOn: Set<number>
  let onCall: (() => void | Promise<void>) | undefined
  let runner: OcrRunner
  let createRunner: ReturnType<typeof vi.fn<() => OcrRunner>>

  const getStore = async () => store

  function setup(pageIds?: string[]) {
    return renderHook((props: { ids?: string[] }) => useOcr(getStore, { createRunner, pageIds: props.ids }), {
      initialProps: { ids: pageIds },
    })
  }

  beforeEach(async () => {
    store = await ImageStore.open(`ocr-test-${Math.random()}`)
    pages = []
    for (let i = 1; i <= 3; i += 1) pages.push(await store.addPage(blob(i), 5, 5, undefined, `p${i}.png`))
    calls = []
    failOn = new Set()
    onCall = undefined
    runner = {
      recognizePage: vi.fn(async (b: Blob, onStage?: (s: never) => void) => {
        const byte = new Uint8Array(await b.arrayBuffer())[0]
        calls.push(byte)
        onStage?.('layout' as never)
        await new Promise((r) => setTimeout(r, 5))
        await onCall?.()
        if (failOn.has(byte)) throw new Error('boom')
        return [line(`l${byte}a`, `t${byte}a`), line(`l${byte}b`, `t${byte}b`)]
      }),
      dispose: vi.fn(),
    }
    createRunner = vi.fn<() => OcrRunner>(() => runner)
  })

  it('runAll processes pages sequentially with original blobs and reports progress', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.runAll(pages.map((p) => p.id))
    })
    expect(calls).toEqual([1, 2, 3])
    expect(result.current.running).toBe(false)
    expect(result.current.progress).toBeNull()
    expect(Object.keys(result.current.results)).toHaveLength(3)
    expect(result.current.results[pages[0].id].lines[0].text).toBe('t1a')
    expect((await store.getOcr(pages[1].id))?.lines).toHaveLength(2)
    expect(result.current.error).toBeNull()
  })

  it('cancel skips remaining pages', async () => {
    const { result } = setup()
    onCall = () => result.current.cancel()
    await act(async () => {
      await result.current.runAll(pages.map((p) => p.id))
    })
    expect(calls).toEqual([1])
    expect(await store.listOcr()).toHaveLength(1)
  })

  it('skipDone skips pages that already have results', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.runOne(pages[0].id)
    })
    calls.length = 0
    await act(async () => {
      await result.current.runAll(pages.map((p) => p.id), { skipDone: true })
    })
    expect(calls).toEqual([2, 3])
  })

  it('a failing page does not stop the batch and errors are aggregated', async () => {
    failOn.add(2)
    const { result } = setup()
    await act(async () => {
      await result.current.runAll(pages.map((p) => p.id))
    })
    expect(calls).toEqual([1, 2, 3])
    expect(Object.keys(result.current.results).sort()).toEqual([pages[0].id, pages[2].id].sort())
    expect(result.current.error).toBe('文字認識に失敗しました: p2.png')
    act(() => result.current.clearError())
    expect(result.current.error).toBeNull()
  })

  it('reports stage in progress', async () => {
    const seen: (string | undefined)[] = []
    const { result } = renderHook(() => {
      const r = useOcr(getStore, { createRunner })
      seen.push(r.progress?.stage)
      return r
    })
    const run = result.current.runAll([pages[0].id])
    await waitFor(() => expect(seen).toContain('layout'))
    await act(async () => {
      await run
    })
  })

  it('edits lines: updateLine sets edited, addLine/moveLine/deleteLine keep order and persist', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.runOne(pages[0].id)
    })
    const id = pages[0].id
    await act(async () => {
      await result.current.updateLine(id, 'l1a', 'X')
    })
    expect(result.current.results[id].lines[0]).toMatchObject({ text: 'X', edited: true })
    await act(async () => {
      await result.current.addLine(id, { x: 1, y: 2, w: 3, h: 4 }, 'l1a')
    })
    let lines = result.current.results[id].lines
    expect(lines).toHaveLength(3)
    expect(lines[1]).toMatchObject({ text: '', edited: true, x: 1 })
    const newId = lines[1].id
    await act(async () => {
      await result.current.moveLine(id, newId, 2)
    })
    lines = result.current.results[id].lines
    expect(lines.map((l) => l.id)).toEqual(['l1a', 'l1b', newId])
    await act(async () => {
      await result.current.deleteLine(id, 'l1b')
    })
    expect(result.current.results[id].lines.map((l) => l.id)).toEqual(['l1a', newId])
    const persisted = await store.getOcr(id)
    expect(persisted?.lines.map((l) => l.id)).toEqual(['l1a', newId])
  })

  it('reloads results when pageIds change (delete/undo/merge staleness)', async () => {
    const ids = pages.map((p) => p.id)
    await store.putOcr({ pageId: ids[0], lines: [], modelVersion: 'x', updatedAt: 1 })
    const { result, rerender } = setup(ids)
    await waitFor(() => expect(Object.keys(result.current.results)).toEqual([ids[0]]))
    await store.deletePage(ids[0])
    rerender({ ids: [ids[1], ids[2]] })
    await waitFor(() => expect(result.current.results).toEqual({}))
  })

  it('recreates the runner lazily after an error and disposes on unmount', async () => {
    failOn.add(1)
    const { result, unmount } = setup()
    await act(async () => {
      await result.current.runOne(pages[0].id)
    })
    expect(result.current.error).not.toBeNull()
    failOn.clear()
    await act(async () => {
      await result.current.runOne(pages[0].id)
    })
    expect(result.current.results[pages[0].id]).toBeDefined()
    expect(createRunner).toHaveBeenCalledTimes(2)
    unmount()
    expect(runner.dispose).toHaveBeenCalled()
  })
  it('unmount during a run creates no further runner and disposes the runner', async () => {
    const { result, unmount } = setup()
    onCall = () => unmount()
    await act(async () => {
      await result.current.runAll(pages.map((p) => p.id))
    })
    expect(calls).toEqual([1])
    expect(createRunner).toHaveBeenCalledTimes(1)
    expect(runner.dispose).toHaveBeenCalled()
  })

  it('a double start runs only once', async () => {
    const { result } = setup()
    await act(async () => {
      await Promise.all([
        result.current.runAll(pages.map((p) => p.id)),
        result.current.runAll(pages.map((p) => p.id)),
      ])
    })
    expect(calls).toEqual([1, 2, 3])
  })

  it('re-run skips pages with edited lines unless overwriteEdited is set', async () => {
    const { result } = setup()
    const id = pages[0].id
    await act(async () => {
      await result.current.runOne(id)
      await result.current.updateLine(id, 'l1a', 'mine')
    })
    calls.length = 0
    let summary: { skippedEdited: string[] } | undefined
    await act(async () => {
      summary = await result.current.runAll(pages.map((p) => p.id))
    })
    expect(summary?.skippedEdited).toEqual([id])
    expect(calls).toEqual([2, 3])
    expect(result.current.results[id].lines[0].text).toBe('mine')
    await act(async () => {
      summary = await result.current.runOne(id, { overwriteEdited: true })
    })
    expect(summary?.skippedEdited).toEqual([])
    expect(result.current.results[id].lines[0]).toMatchObject({ text: 't1a', edited: false })
  })

  it('an edit made while the page is recognizing is not overwritten', async () => {
    const { result } = setup()
    const id = pages[0].id
    await act(async () => {
      await result.current.runOne(id)
    })
    onCall = async () => {
      onCall = undefined
      await result.current.updateLine(id, 'l1a', 'during')
    }
    await act(async () => {
      await result.current.runOne(id)
    })
    expect((await store.getOcr(id))?.lines[0]).toMatchObject({ text: 'during', edited: true })
    expect(result.current.results[id].lines[0].text).toBe('during')
  })

  it('does not leave OCR behind for a page deleted mid-run', async () => {
    const { result } = setup()
    onCall = async () => {
      if (calls[calls.length - 1] === 2) await store.deletePage(pages[1].id)
    }
    await act(async () => {
      await result.current.runAll(pages.map((p) => p.id))
    })
    expect((await store.listOcr()).map((o) => o.pageId).sort()).toEqual(
      [pages[0].id, pages[2].id].sort(),
    )
    expect(result.current.error).toBeNull()
  })

  it('serializes concurrent edits on one page without losing any', async () => {
    const { result } = setup()
    const id = pages[0].id
    await act(async () => {
      await result.current.runOne(id)
    })
    await act(async () => {
      await Promise.all([
        result.current.updateLine(id, 'l1a', 'A'),
        result.current.updateLine(id, 'l1b', 'B'),
      ])
    })
    expect(result.current.results[id].lines.map((l) => l.text)).toEqual(['A', 'B'])
  })
})
