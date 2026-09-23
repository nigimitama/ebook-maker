import { describe, it, expect } from 'vitest'
import { rankByXYCut } from './xyCut'
import type { Box } from './types'

const b = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })

describe('rankByXYCut', () => {
  it('空配列は空配列を返す', () => {
    expect(rankByXYCut([])).toEqual([])
  })

  it('1個は0を返す', () => {
    expect(rankByXYCut([b(0, 0, 10, 10)])).toEqual([0])
  })

  it('横書き2行(上下に離れている)は上が先', () => {
    const top = b(0, 10, 300, 20)
    const bottom = b(0, 100, 300, 20)
    const ranks = rankByXYCut([bottom, top])
    // bottomが先頭に渡っているが、rankはtop<bottomになるはず
    expect(ranks[1]).toBeLessThan(ranks[0])
  })

  it('縦書き2列(左右に離れている、縦長の箱)は右の列が先', () => {
    const left = b(10, 0, 20, 300)
    const right = b(100, 0, 20, 300)
    const ranks = rankByXYCut([left, right])
    // 縦長の箱が過半数 -> 縦書き扱い。x分割ノードは右→左の順に並ぶ。
    expect(ranks[1]).toBeLessThan(ranks[0])
  })

  it('4箱(2行×2列)には重複のない順位が付く', () => {
    // このケースは分割順(先にX軸で割るかY軸で割るか)によって具体的な順序が
    // 変わりうる(どちらで割っても「読み順として妥当」ではあるが、一意に
    // 決め打てない)。ここでは「境界の妥当性」(0..3の順位が重複なく付くこと)
    // だけを確認する。読み順の具体的な正しさは横書き2行・縦書き2列の
    // 単純ケース(このファイルの他のテスト)で担保する。
    const boxes = [
      b(200, 100, 100, 20),
      b(0, 0, 100, 20),
      b(0, 100, 100, 20),
      b(200, 0, 100, 20),
    ]
    const ranks = rankByXYCut(boxes)
    expect(new Set(ranks).size).toBe(4)
    expect([...ranks].sort((a, c) => a - c)).toEqual([0, 1, 2, 3])
  })
})
