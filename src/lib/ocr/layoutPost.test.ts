import { describe, it, expect } from 'vitest'
import { decodeDetections, nms } from './layoutPost'
import type { Detection } from './types'

const det = (x: number, y: number, w: number, h: number, score: number): Detection => ({
  x,
  y,
  w,
  h,
  score,
  classId: 1,
})

describe('nms', () => {
  it('IoUが閾値を超える低スコアの箱は落ちる', () => {
    const hi = det(0, 0, 100, 100, 0.9)
    const lo = det(5, 5, 100, 100, 0.5)
    expect(nms([lo, hi], 0.5)).toEqual([hi])
  })
  it('離れた2箱は両方残る', () => {
    const a = det(0, 0, 50, 50, 0.9)
    const b = det(200, 200, 50, 50, 0.8)
    expect(nms([a, b], 0.5)).toHaveLength(2)
  })
})

describe('decodeDetections', () => {
  // ラベルは1始まり。label-1 の class が lineClassIds(1,2,3,4,5,16) なら行、0はtext_block。
  const base = (over: Partial<Parameters<typeof decodeDetections>[0]> = {}) => ({
    boxes: new Float32Array([0, 0, 100, 40]),
    scores: new Float32Array([0.9]),
    classIds: new BigInt64Array([2n]), // class 1 = line_main
    ...over,
  })

  it('スコアが閾値(0.3)未満の検出は除外する', () => {
    const raw = base({
      boxes: new Float32Array([0, 0, 100, 40, 0, 100, 100, 140]),
      scores: new Float32Array([0.2, 0.9]),
      classIds: new BigInt64Array([2n, 2n]),
    })
    const out = decodeDetections(raw, 1, 1000, 1000)
    expect(out.lines).toHaveLength(1)
    expect(out.lines[0].score).toBeCloseTo(0.9)
  })
  it('scaleで割って原本座標へ戻す', () => {
    const raw = base({ boxes: new Float32Array([0, 200, 200, 400]) })
    const [o] = decodeDetections(raw, 0.5, 1000, 1000).lines
    expect(o.x).toBeCloseTo(0)
    expect(o.w).toBeCloseTo(400)
    // 高さ400に対し上下2%(8px)拡張
    expect(o.y).toBeCloseTo(400 - 8)
    expect(o.h).toBeCloseTo(400 + 16)
  })
  it('画像外にはみ出た箱を画像内に丸める', () => {
    const raw = base({ boxes: new Float32Array([-30, -30, 5000, 5000]) })
    const [o] = decodeDetections(raw, 1, 300, 200).lines
    expect(o).toMatchObject({ x: 0, y: 0, w: 300, h: 200 })
  })
  it('行クラスはclassIdをlabel-1で持ち、ブロックはlinesに入らない', () => {
    const raw = base({
      boxes: new Float32Array([0, 0, 100, 40, 0, 100, 100, 140]),
      scores: new Float32Array([0.9, 0.9]),
      classIds: new BigInt64Array([1n, 17n]), // class 0=text_block, class 16=title(行)
    })
    const out = decodeDetections(raw, 1, 1000, 1000)
    expect(out.lines).toHaveLength(1)
    expect(out.lines[0].classId).toBe(16)
  })
  it('Int32Arrayのclass idも受け付ける', () => {
    const out = decodeDetections(base({ classIds: new Int32Array([2]) }), 1, 1000, 1000)
    expect(out.lines).toHaveLength(1)
  })
  it('10px未満の箱は捨てる', () => {
    const raw = base({ boxes: new Float32Array([0, 0, 5, 5]) })
    expect(decodeDetections(raw, 1, 1000, 1000).lines).toEqual([])
  })
  it('char_count(int64)をnumberのcharCountとして付ける', () => {
    const out = decodeDetections(base({ charCounts: new BigInt64Array([3n]) }), 1, 1000, 1000)
    expect(out.lines[0].charCount).toBe(3)
    expect(typeof out.lines[0].charCount).toBe('number')
  })
  it('char_countが無ければcharCountはundefined', () => {
    const [o] = decodeDetections(base(), 1, 1000, 1000).lines
    expect(o.charCount).toBeUndefined()
  })

  it('text_block(classId 0)はblocksに入り、パディング拡張されない', () => {
    const raw = base({
      boxes: new Float32Array([0, 200, 200, 400]), // label1 -> classId0 = text_block
      scores: new Float32Array([0.9]),
      classIds: new BigInt64Array([1n]),
    })
    const out = decodeDetections(raw, 0.5, 1000, 1000)
    expect(out.lines).toEqual([])
    expect(out.blocks).toEqual([{ x: 0, y: 400, w: 400, h: 400 }])
  })
  it('10px未満のブロックは捨てる', () => {
    const raw = base({
      boxes: new Float32Array([0, 0, 5, 5]),
      classIds: new BigInt64Array([1n]),
    })
    expect(decodeDetections(raw, 1, 1000, 1000).blocks).toEqual([])
  })
  it('ブロックにはNMSをかけない(重なっていても両方残る)', () => {
    const raw = base({
      boxes: new Float32Array([0, 0, 100, 100, 5, 5, 105, 105]),
      scores: new Float32Array([0.9, 0.8]),
      classIds: new BigInt64Array([1n, 1n]),
    })
    expect(decodeDetections(raw, 1, 1000, 1000).blocks).toHaveLength(2)
  })
})
