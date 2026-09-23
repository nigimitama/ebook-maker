import { describe, it, expect } from 'vitest'
import { sortReadingOrder } from './readingOrder'

const d = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, score: 1, classId: 1 })

describe('sortReadingOrder without blocks', () => {
  it('縦書き(細長い行)は右の行から左へ、同じ列なら上から', () => {
    const left = d(10, 0, 20, 300)
    const right = d(100, 0, 20, 300)
    expect(sortReadingOrder([left, right]).map((o) => o.detection)).toEqual([right, left])
  })
  it('横書き(平たい行)は上の行から下へ、同じ行なら左から', () => {
    const top = d(0, 10, 300, 20)
    const bottom = d(0, 100, 300, 20)
    expect(sortReadingOrder([bottom, top]).map((o) => o.detection)).toEqual([top, bottom])
  })
  it('空配列は空配列を返す', () => {
    expect(sortReadingOrder([])).toEqual([])
  })
  it('blocksを渡さない/空なら全行のblockIdはnull', () => {
    const top = d(0, 10, 300, 20)
    const bottom = d(0, 100, 300, 20)
    const result = sortReadingOrder([top, bottom])
    expect(result.every((o) => o.blockId === null)).toBe(true)
  })
})

describe('sortReadingOrder with blocks', () => {
  it('2カラムを別ブロックとして割り当て、ブロックごとに読み順をまとめる', () => {
    // 左カラム: 上下2行(小さい間隔)。右カラム: 上下2行。列間は大きく離す。
    // グループ(ブロック)のbboxが横長(w>h)になるようにする
    // (縦長だとXY-Cutが縦書きと誤判定し、列の順序が右→左に反転してしまうため)。
    const leftTop = d(0, 0, 100, 20)
    const leftBottom = d(0, 30, 100, 20)
    const rightTop = d(300, 0, 100, 20)
    const rightBottom = d(300, 30, 100, 20)
    const leftBlock = { x: 0, y: 0, w: 100, h: 50 }
    const rightBlock = { x: 300, y: 0, w: 100, h: 50 }
    const result = sortReadingOrder(
      [rightBottom, leftBottom, rightTop, leftTop],
      [leftBlock, rightBlock],
    )
    // 同じブロックの行は同じblockId、異なるブロックは異なるblockId(順序は問わない)。
    const leftIds = new Set(
      result.filter((o) => o.detection === leftTop || o.detection === leftBottom).map((o) => o.blockId),
    )
    const rightIds = new Set(
      result.filter((o) => o.detection === rightTop || o.detection === rightBottom).map((o) => o.blockId),
    )
    expect(leftIds.size).toBe(1)
    expect(rightIds.size).toBe(1)
    expect([...leftIds][0]).not.toBeNull()
    expect([...leftIds][0]).not.toBe([...rightIds][0])
    // 列内は上→下、列間は左→右(このジオメトリでは一意に決まるはずだが、
    // XY-Cutのグリッド量子化の具合で列の順序が変わったら、このtoEqualだけ
    // 実際の出力に合わせて直してよい。blockIdの分離・非nullは必ず保つこと)。
    expect(result.map((o) => o.detection)).toEqual([leftTop, leftBottom, rightTop, rightBottom])
  })

  it('どのブロックにも中心が収まらない行は独立した1行ブロックになる(割当率70%以上を維持)', () => {
    // 4行中3行がブロックに収まる(75% >= 70%)。1行だけだと閾値を割ってフォールバックしてしまう。
    const in1 = d(0, 0, 100, 20)
    const in2 = d(0, 30, 100, 20)
    const in3 = d(0, 60, 100, 20)
    const outside = d(500, 500, 100, 20)
    const block = { x: 0, y: 0, w: 100, h: 80 }
    const result = sortReadingOrder([outside, in3, in2, in1], [block])
    const outsideEntry = result.find((o) => o.detection === outside)!
    const insideEntries = result.filter((o) => o.detection !== outside)
    expect(insideEntries).toHaveLength(3)
    expect(new Set(insideEntries.map((o) => o.blockId)).size).toBe(1)
    expect(insideEntries[0].blockId).not.toBeNull()
    expect(outsideEntry.blockId).toBeNull()
  })

  it('割当率が70%未満ならブロックを使わずフォールバックする(全行blockId: null)', () => {
    // 3行のうち1行しかブロックに収まらない(33% < 70%)。
    const a = d(0, 0, 100, 20)
    const b = d(0, 100, 100, 20)
    const c = d(0, 200, 100, 20)
    const onlyCoversA = { x: 0, y: 0, w: 100, h: 20 }
    const result = sortReadingOrder([a, b, c], [onlyCoversA])
    expect(result.every((o) => o.blockId === null)).toBe(true)
    expect(result.map((o) => o.detection)).toEqual([a, b, c])
  })
})
