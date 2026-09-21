import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ImageStore } from '../lib/imageStore'
import type { Chapter } from '../types'
import { useChapters } from './useChapters'

const ch = (id: string, pageId: string, level = 1): Chapter => ({ id, title: id, pageId, level })

describe('useChapters', () => {
  let store: ImageStore
  const getStore = async () => store

  function setup(ids?: string[]) {
    return renderHook((props: { ids?: string[] }) => useChapters(getStore, { pageIds: props.ids }), {
      initialProps: { ids },
    })
  }

  beforeEach(async () => {
    store = await ImageStore.open(`chapters-test-${Math.random()}`)
  })

  it('loads saved chapters', async () => {
    await store.putChapters([ch('c1', 'a')])
    const { result } = setup(['a', 'b'])
    await waitFor(() => expect(result.current.chapters).toEqual([ch('c1', 'a')]))
  })

  it('setChapters updates state immediately, saves, and clamps levels to 1 or 2', async () => {
    const { result } = setup(['a'])
    await act(async () => {
      await result.current.setChapters([ch('c1', 'a', 5), ch('c2', 'a', 0)])
    })
    expect(result.current.chapters.map((c) => c.level)).toEqual([2, 1])
    expect((await store.listChapters()).map((c) => c.level)).toEqual([2, 1])
  })

  it('moves a chapter to the next page when its page is deleted', async () => {
    await store.putChapters([ch('c1', 'b')])
    const { result, rerender } = setup(['a', 'b', 'c'])
    await waitFor(() => expect(result.current.chapters).toHaveLength(1))
    rerender({ ids: ['a', 'c'] })
    await waitFor(() => expect(result.current.chapters[0].pageId).toBe('c'))
    expect((await store.listChapters())[0].pageId).toBe('c')
  })

  it('does not drop chapters while the page list is still empty on first load', async () => {
    await store.putChapters([ch('c1', 'a')])
    const { result, rerender } = setup([])
    rerender({ ids: ['a', 'b'] })
    await waitFor(() => expect(result.current.chapters).toEqual([ch('c1', 'a')]))
    expect(await store.listChapters()).toEqual([ch('c1', 'a')])
  })

  it('drops all chapters when the last page is deleted', async () => {
    await store.putChapters([ch('c1', 'a')])
    const { result, rerender } = setup(['a'])
    await waitFor(() => expect(result.current.chapters).toHaveLength(1))
    rerender({ ids: [] })
    await waitFor(() => expect(result.current.chapters).toEqual([]))
  })

  it('keeps an edit made just before a page deletion, and still remaps the chapter', async () => {
    await store.putChapters([ch('c1', 'b')])
    const { result, rerender } = setup(['a', 'b', 'c'])
    await waitFor(() => expect(result.current.chapters).toHaveLength(1))
    let pending: Promise<void>
    act(() => {
      pending = result.current.setChapters([{ ...ch('c1', 'b'), title: '編集後' }])
    })
    rerender({ ids: ['a', 'c'] })
    await act(async () => {
      await pending
    })
    await waitFor(() => expect(result.current.chapters[0]).toMatchObject({ title: '編集後', pageId: 'c' }))
    expect((await store.listChapters())[0]).toMatchObject({ title: '編集後', pageId: 'c' })
  })
})
