import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { OcrReview } from './OcrReview'
import type { UseOcrResult } from '../hooks/useOcr'
import type { OcrResult } from '../lib/ocr/types'
import type { PageEntry } from '../types'

function page(id: string, order: number): PageEntry {
  return {
    id,
    order,
    blobId: `blob-${id}`,
    fileName: `p${order}.png`,
    width: 1000,
    height: 2000,
    adjustment: { brightness: 0, contrast: 0 },
  }
}
// jsdom には PointerEvent が無く clientX/Y が落ちるため、MouseEvent ベースで補う。
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
}

const pages = [page('a', 0), page('b', 1), page('c', 2)]
const thumbnails = { a: 'blob:a', b: 'blob:b', c: 'blob:c' }

const resultA: OcrResult = {
  pageId: 'a',
  modelVersion: 'v',
  updatedAt: 1,
  lines: [
    { id: 'l1', x: 10, y: 20, w: 100, h: 50, text: '一行目', edited: false },
    { id: 'l2', x: 10, y: 100, w: 100, h: 50, text: '二行目', edited: true },
    { id: 'l3', x: 10, y: 200, w: 100, h: 50, text: '三行目', edited: false },
  ],
}

function makeOcr(over: Partial<UseOcrResult> = {}): UseOcrResult {
  return {
    results: {},
    progress: null,
    running: false,
    error: null,
    clearError: vi.fn(),
    runOne: vi.fn().mockResolvedValue({ skippedEdited: [] }),
    runAll: vi.fn().mockResolvedValue({ skippedEdited: [] }),
    cancel: vi.fn(),
    updateLine: vi.fn().mockResolvedValue(undefined),
    deleteLine: vi.fn().mockResolvedValue(undefined),
    addLine: vi.fn().mockResolvedValue(undefined),
    moveLine: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

function setup(ocr: UseOcrResult, selectedPageId = 'a') {
  const onSelect = vi.fn()
  const ui = (o: UseOcrResult) => (
    <OcrReview
      pages={pages}
      thumbnails={thumbnails}
      selectedPageId={selectedPageId}
      selectedImage={{ data: new Uint8ClampedArray(4 * 10 * 20), width: 10, height: 20 }}
      onSelect={onSelect}
      ocr={o}
      title="我輩は猫"
    />
  )
  const { rerender } = render(ui(ocr))
  return { onSelect, update: (o: UseOcrResult) => rerender(ui(o)) }
}

describe('OcrReview', () => {
  it('結果が無いページでは「このページをOCR」で runOne を呼ぶ', () => {
    const ocr = makeOcr()
    setup(ocr)
    fireEvent.click(screen.getByRole('button', { name: 'このページをOCR' }))
    expect(ocr.runOne).toHaveBeenCalledWith('a')
  })

  it('行が読み順に並び、編集してblurすると updateLine を呼ぶ(変更なしなら呼ばない)', () => {
    const ocr = makeOcr({ results: { a: resultA } })
    setup(ocr)
    const areas = screen.getAllByRole('textbox')
    expect(areas.map((t) => (t as HTMLTextAreaElement).value)).toEqual(['一行目', '二行目', '三行目'])
    fireEvent.blur(areas[0])
    expect(ocr.updateLine).not.toHaveBeenCalled()
    fireEvent.change(areas[0], { target: { value: '修正' } })
    fireEvent.blur(areas[0])
    expect(ocr.updateLine).toHaveBeenCalledWith('a', 'l1', '修正')
  })

  it('枠クリックで行が選択(aria-current)され、行フォーカスで枠も選択される', () => {
    setup(makeOcr({ results: { a: resultA } }))
    fireEvent.click(screen.getByTestId('ocr-box-l2'))
    expect(screen.getByTestId('ocr-line-l2')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('ocr-line-l1')).not.toHaveAttribute('aria-current')
    fireEvent.focus(within(screen.getByTestId('ocr-line-l3')).getByRole('textbox'))
    expect(screen.getByTestId('ocr-line-l3')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('ocr-box-l3')).toHaveAttribute('aria-current', 'true')
  })

  it('削除・上下移動ボタン(端では無効)', () => {
    const ocr = makeOcr({ results: { a: resultA } })
    setup(ocr)
    const row2 = screen.getByTestId('ocr-line-l2')
    fireEvent.click(within(row2).getByRole('button', { name: '行を削除' }))
    expect(ocr.deleteLine).toHaveBeenCalledWith('a', 'l2')
    fireEvent.click(within(row2).getByRole('button', { name: '上へ移動' }))
    expect(ocr.moveLine).toHaveBeenCalledWith('a', 'l2', 0)
    fireEvent.click(within(row2).getByRole('button', { name: '下へ移動' }))
    expect(ocr.moveLine).toHaveBeenCalledWith('a', 'l2', 2)
    const row1 = screen.getByTestId('ocr-line-l1')
    expect(within(row1).getByRole('button', { name: '上へ移動' })).toBeDisabled()
    const row3 = screen.getByTestId('ocr-line-l3')
    expect(within(row3).getByRole('button', { name: '下へ移動' })).toBeDisabled()
  })

  it('実行中は進捗と中止が出る', () => {
    const ocr = makeOcr({ running: true, progress: { done: 1, total: 3, stage: 'detecting' } })
    setup(ocr)
    expect(screen.getByTestId('ocr-progress')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '中止' }))
    expect(ocr.cancel).toHaveBeenCalled()
  })

  it('モデル読み込み中は初回ダウンロードの案内を出す', () => {
    setup(makeOcr({ running: true, progress: { done: 0, total: 1, stage: 'loading-models' } }))
    expect(screen.getByText(/モデルを読み込み中\(初回のみ約157MBをダウンロードします\)/)).toBeInTheDocument()
  })

  it('修正済み行に印が付く', () => {
    setup(makeOcr({ results: { a: resultA } }))
    expect(within(screen.getByTestId('ocr-line-l2')).getByText('修正済み')).toBeInTheDocument()
    expect(within(screen.getByTestId('ocr-line-l1')).queryByText('修正済み')).toBeNull()
  })

  it('ページ一覧にOCR状態バッジ(未/済/修正あり)が出る', () => {
    const doneB: OcrResult = { ...resultA, pageId: 'b', lines: [{ ...resultA.lines[0] }] }
    setup(makeOcr({ results: { a: resultA, b: doneB } }))
    expect(screen.getByTestId('ocr-status-a')).toHaveTextContent('修正あり')
    expect(screen.getByTestId('ocr-status-b')).toHaveTextContent('済')
    expect(screen.getByTestId('ocr-status-c')).toHaveTextContent('未')
  })

  it('ページ一覧の行クリックで onSelect', () => {
    const { onSelect } = setup(makeOcr())
    fireEvent.click(screen.getByTestId('ocr-page-b'))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('修正済みで見送られたら上書き再実行ボタンが出て、押すと overwriteEdited で呼ぶ', async () => {
    const ocr = makeOcr({
      results: { a: resultA },
      runOne: vi.fn().mockResolvedValue({ skippedEdited: ['a'] }),
    })
    setup(ocr)
    fireEvent.click(screen.getByRole('button', { name: 'このページをOCR' }))
    const btn = await screen.findByRole('button', { name: '修正済みの行があります。上書きして再実行' })
    fireEvent.click(btn)
    expect(ocr.runOne).toHaveBeenLastCalledWith('a', { overwriteEdited: true })
  })

  it('全ページOCRでも同様に上書き確認が出る', async () => {
    const ocr = makeOcr({ runAll: vi.fn().mockResolvedValue({ skippedEdited: ['b'] }) })
    setup(ocr)
    fireEvent.click(screen.getByRole('button', { name: '全ページをOCR' }))
    expect(ocr.runAll).toHaveBeenCalledWith(['a', 'b', 'c'], { skipDone: true })
    fireEvent.click(await screen.findByRole('button', { name: '修正済みの行があります。上書きして再実行' }))
    expect(ocr.runAll).toHaveBeenLastCalledWith(['a', 'b', 'c'], { skipDone: true, overwriteEdited: true })
  })

  it('エラーバナーと閉じるボタン', () => {
    const ocr = makeOcr({ error: '文字認識に失敗しました: x' })
    setup(ocr)
    expect(screen.getByRole('alert')).toHaveTextContent('文字認識に失敗しました: x')
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(ocr.clearError).toHaveBeenCalled()
  })

  it('出典表記がある', () => {
    setup(makeOcr())
    expect(screen.getByText(/NDLOCR-Lite/)).toHaveTextContent(/NDLOCR-Lite \(\s*CC BY 4\.0\s*\)/)
    expect(screen.getByText(/NDLOCR-Lite/)).toHaveTextContent(/\) のモデルを ONNX 形式のまま配信/)
    expect(screen.getByText(/NDLOCR-Lite/)).not.toHaveTextContent(/ndlocrlite-web/)
    const link = screen.getByRole('link', { name: /CC BY 4\.0/ })
    expect(link).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/deed.ja')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('枠追加モード: ドラッグで原本px の枠を addLine する(小さいドラッグは無視)', async () => {
    const ocr = makeOcr({ results: { a: resultA } })
    setup(ocr)
    fireEvent.focus(within(screen.getByTestId('ocr-line-l2')).getByRole('textbox'))
    fireEvent.click(screen.getByRole('button', { name: '枠を追加' }))
    const area = screen.getByTestId('ocr-draw-area')
    // 表示 200x400 → 原本 1000x2000 (倍率5)
    area.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400, x: 0, y: 0 }) as DOMRect
    fireEvent.pointerDown(area, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(area, { clientX: 13, clientY: 13, pointerId: 1 })
    expect(ocr.addLine).not.toHaveBeenCalled()
    fireEvent.pointerDown(area, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(area, { clientX: 50, clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(area, { clientX: 50, clientY: 60, pointerId: 1 })
    await waitFor(() =>
      expect(ocr.addLine).toHaveBeenCalledWith('a', { x: 50, y: 50, w: 200, h: 250 }, 'l2'),
    )
  })

  it('編集中の下書きは、同じ行のテキストが外から変わっても上書きされない', () => {
    const ocr = makeOcr({ results: { a: resultA } })
    const { update } = setup(ocr)
    const area = () => within(screen.getByTestId('ocr-line-l1')).getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(area(), { target: { value: '入力中' } })
    const changed = { ...resultA, lines: resultA.lines.map((l) => (l.id === 'l1' ? { ...l, text: '新結果' } : l)) }
    update({ ...ocr, results: { a: changed } })
    expect(area().value).toBe('入力中')
  })

  it('編集していない行は外からの更新に追従する', () => {
    const ocr = makeOcr({ results: { a: resultA } })
    const { update } = setup(ocr)
    const changed = { ...resultA, lines: resultA.lines.map((l) => (l.id === 'l1' ? { ...l, text: '新結果' } : l)) }
    update({ ...ocr, results: { a: changed } })
    expect((within(screen.getByTestId('ocr-line-l1')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('新結果')
  })

  it('編集直後に↑を押すと、編集の保存が先に呼ばれてから moveLine が呼ばれる', () => {
    const ocr = makeOcr({ results: { a: resultA } })
    setup(ocr)
    const row = screen.getByTestId('ocr-line-l2')
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: '直した' } })
    fireEvent.blur(within(row).getByRole('textbox'))
    fireEvent.click(within(row).getByRole('button', { name: '上へ移動' }))
    const upd = (ocr.updateLine as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const mv = (ocr.moveLine as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    expect(upd).toBeLessThan(mv)
  })

  it('別ページの結果で行IDが変わると古い下書きは破棄される', () => {
    const ocr = makeOcr({ results: { a: resultA } })
    const { update } = setup(ocr)
    fireEvent.change(within(screen.getByTestId('ocr-line-l1')).getByRole('textbox'), { target: { value: '古い' } })
    const fresh: OcrResult = { ...resultA, lines: [{ id: 'n1', x: 1, y: 1, w: 50, h: 50, text: '再実行', edited: false }] }
    update({ ...ocr, results: { a: fresh } })
    expect((within(screen.getByTestId('ocr-line-n1')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('再実行')
    expect(screen.queryByTestId('ocr-line-l1')).toBeNull()
  })

  function startAdd() {
    const ocr = makeOcr({ results: { a: resultA } })
    setup(ocr)
    fireEvent.click(screen.getByRole('button', { name: '枠を追加' }))
    const area = screen.getByTestId('ocr-draw-area')
    area.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400, x: 0, y: 0 }) as DOMRect
    return { ocr, area }
  }

  it('Escapeでドラッグを取り消し、枠は追加されない', () => {
    const { ocr, area } = startAdd()
    fireEvent.pointerDown(area, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(area, { clientX: 50, clientY: 60, pointerId: 1 })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.pointerUp(area, { clientX: 50, clientY: 60, pointerId: 1 })
    expect(ocr.addLine).not.toHaveBeenCalled()
  })

  it('pointercancelでドラッグを取り消す', () => {
    const { ocr, area } = startAdd()
    fireEvent.pointerDown(area, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent(area, new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }))
    fireEvent.pointerUp(area, { clientX: 50, clientY: 60, pointerId: 1 })
    expect(ocr.addLine).not.toHaveBeenCalled()
  })

  it('逆方向(右下から左上)のドラッグでも枠を追加できる', async () => {
    const { ocr, area } = startAdd()
    fireEvent.pointerDown(area, { clientX: 50, clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(area, { clientX: 10, clientY: 10, pointerId: 1 })
    await waitFor(() => expect(ocr.addLine).toHaveBeenCalledWith('a', { x: 50, y: 50, w: 200, h: 250 }, undefined))
  })

  it('再実行の確認は、そのページの結果が変わると消える', async () => {
    const ocr = makeOcr({
      results: { a: resultA },
      runOne: vi.fn().mockResolvedValue({ skippedEdited: ['a'] }),
    })
    const { update } = setup(ocr)
    fireEvent.click(screen.getByRole('button', { name: 'このページをOCR' }))
    await screen.findByRole('button', { name: '修正済みの行があります。上書きして再実行' })
    update({ ...ocr, results: { a: { ...resultA, updatedAt: 2 } } })
    expect(screen.queryByRole('button', { name: '修正済みの行があります。上書きして再実行' })).toBeNull()
  })

  it('ページ一覧の行はキーボード(Enter)で選択できる', () => {
    const { onSelect } = setup(makeOcr())
    fireEvent.keyDown(screen.getByTestId('ocr-page-c'), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('c')
  })

  it('runOneが結果を差し替えてから skippedEdited を返しても確認が出て、上書き後の結果変化で消える', async () => {
    const holder: { update?: (o: UseOcrResult) => void; ocr?: UseOcrResult } = {}
    const swapped: OcrResult = { ...resultA, updatedAt: 5 }
    const runOne = vi
      .fn()
      .mockImplementationOnce(async () => {
        holder.update?.({ ...holder.ocr!, results: { a: swapped } })
        return { skippedEdited: ['a'] }
      })
      .mockImplementationOnce(async () => {
        holder.update?.({ ...holder.ocr!, results: { a: { ...swapped, updatedAt: 6 } } })
        return { skippedEdited: [] }
      })
    const ocr = makeOcr({ results: { a: resultA }, runOne })
    holder.ocr = ocr
    holder.update = setup(ocr).update
    fireEvent.click(screen.getByRole('button', { name: 'このページをOCR' }))
    const btn = await screen.findByRole('button', { name: '修正済みの行があります。上書きして再実行' })
    fireEvent.click(btn)
    expect(runOne).toHaveBeenLastCalledWith('a', { overwriteEdited: true })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '修正済みの行があります。上書きして再実行' })).toBeNull(),
    )
  })

  it('全ページOCRでも結果が差し替わってから skippedEdited を返して確認が出る', async () => {
    const holder: { update?: (o: UseOcrResult) => void; ocr?: UseOcrResult } = {}
    const runAll = vi.fn().mockImplementationOnce(async () => {
      holder.update?.({ ...holder.ocr!, results: { a: { ...resultA, updatedAt: 9 } } })
      return { skippedEdited: ['a'] }
    })
    const ocr = makeOcr({ results: { a: resultA }, runAll })
    holder.ocr = ocr
    holder.update = setup(ocr).update
    fireEvent.click(screen.getByRole('button', { name: '全ページをOCR' }))
    expect(await screen.findByRole('button', { name: '修正済みの行があります。上書きして再実行' })).toBeInTheDocument()
  })

  describe('テキスト保存', () => {
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    afterEach(() => {
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
      vi.restoreAllMocks()
    })

    it('結果が無い、または全行が空なら無効', () => {
      setup(makeOcr())
      expect(screen.getByRole('button', { name: 'テキストを保存(.txt)' })).toBeDisabled()
    })

    it('全行が空の結果だけでも無効', () => {
      const empty: OcrResult = {
        ...resultA,
        lines: resultA.lines.map((l) => ({ ...l, text: '' })),
      }
      setup(makeOcr({ results: { a: empty } }))
      expect(screen.getByRole('button', { name: 'テキストを保存(.txt)' })).toBeDisabled()
    })

    it('クリックでtext/plainのBlobを作り、タイトル名でダウンロードしてURLを解放する', async () => {
      const create = vi.fn().mockReturnValue('blob:txt')
      const revoke = vi.fn()
      URL.createObjectURL = create
      URL.revokeObjectURL = revoke
      const clicked: string[] = []
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download)
      })
      setup(makeOcr({ results: { a: resultA } }))
      const btn = screen.getByRole('button', { name: 'テキストを保存(.txt)' })
      expect(btn).toBeEnabled()
      fireEvent.click(btn)
      expect(create).toHaveBeenCalledTimes(1)
      const blob = create.mock.calls[0][0] as Blob
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('text/plain;charset=utf-8')
      expect(await blob.text()).toBe('一行目\n二行目\n三行目')
      expect(clicked).toEqual(['我輩は猫.txt'])
      expect(revoke).toHaveBeenCalledWith('blob:txt')
    })
  })
})
