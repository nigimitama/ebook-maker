import { describe, it, expect } from 'vitest'
import {
  OCR_CONCURRENCY_STORAGE_KEY,
  clampOcrConcurrency,
  defaultOcrConcurrency,
  loadOcrConcurrency,
  maxOcrConcurrency,
  saveOcrConcurrency,
} from './ocrSettings'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  }
}
const throwing = {
  getItem: () => { throw new Error('denied') },
  setItem: () => { throw new Error('denied') },
}

describe('maxOcrConcurrency', () => {
  it('論理コア数−1、最低1', () => {
    expect(maxOcrConcurrency(16)).toBe(15)
    expect(maxOcrConcurrency(2)).toBe(1)
    expect(maxOcrConcurrency(1)).toBe(1)
  })
  it('取れないときはコア数2とみなす', () => {
    expect(maxOcrConcurrency(undefined)).toBe(1)
    expect(maxOcrConcurrency(Number.NaN)).toBe(1)
    expect(maxOcrConcurrency(0)).toBe(1)
  })
})

describe('defaultOcrConcurrency / clampOcrConcurrency', () => {
  it('既定値は2、上限で頭打ち', () => {
    expect(defaultOcrConcurrency(15)).toBe(2)
    expect(defaultOcrConcurrency(1)).toBe(1)
  })
  it('1〜上限の整数に丸める', () => {
    expect(clampOcrConcurrency(0, 7)).toBe(1)
    expect(clampOcrConcurrency(-3, 7)).toBe(1)
    expect(clampOcrConcurrency(3.9, 7)).toBe(3)
    expect(clampOcrConcurrency(99, 7)).toBe(7)
    expect(clampOcrConcurrency(Number.NaN, 7)).toBe(2)
  })
})

describe('loadOcrConcurrency / saveOcrConcurrency', () => {
  it('未保存なら既定値', () => {
    expect(loadOcrConcurrency(7, memoryStorage())).toBe(2)
    expect(loadOcrConcurrency(7, undefined)).toBe(2)
  })
  it('保存値を上限で丸めて読む', () => {
    expect(loadOcrConcurrency(7, memoryStorage({ [OCR_CONCURRENCY_STORAGE_KEY]: '5' }))).toBe(5)
    expect(loadOcrConcurrency(3, memoryStorage({ [OCR_CONCURRENCY_STORAGE_KEY]: '12' }))).toBe(3)
  })
  it('不正値や例外なら既定値', () => {
    expect(loadOcrConcurrency(7, memoryStorage({ [OCR_CONCURRENCY_STORAGE_KEY]: 'abc' }))).toBe(2)
    expect(loadOcrConcurrency(7, memoryStorage({ [OCR_CONCURRENCY_STORAGE_KEY]: '' }))).toBe(2)
    expect(loadOcrConcurrency(7, throwing)).toBe(2)
  })
  it('保存する(例外は握りつぶす)', () => {
    const s = memoryStorage()
    saveOcrConcurrency(4, s)
    expect(s.data.get(OCR_CONCURRENCY_STORAGE_KEY)).toBe('4')
    expect(() => saveOcrConcurrency(4, throwing)).not.toThrow()
  })
})
