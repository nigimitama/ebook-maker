import { describe, it, expect } from 'vitest'
import { pickRecognizer, decodeSequence, parseCharset } from './recognizePost'

const box = { x: 0, y: 0, w: 100, h: 20 }

describe('pickRecognizer', () => {
  it('char_count 3 -> 30, 2 -> 50, それ以外 -> 100', () => {
    expect(pickRecognizer(3, box)).toBe(30)
    expect(pickRecognizer(2, box)).toBe(50)
    expect(pickRecognizer(1, box)).toBe(100)
    expect(pickRecognizer(0, box)).toBe(100)
  })
  it('char_countが無いときは100(最大)にフォールバックする', () => {
    expect(pickRecognizer(undefined, box)).toBe(100)
  })
})

describe('decodeSequence', () => {
  const vocab = 6
  // 各位置でargmaxがidになるlogitsを作る
  const logitsFor = (ids: number[]) => {
    const l = new Float32Array(ids.length * vocab)
    ids.forEach((id, p) => {
      l[p * vocab + id] = 5
    })
    return l
  }
  // charList[id-1]: id4 -> 'c', id5 -> 'd'
  const charset = ['x', 'y', 'z', 'c', 'd']

  it('id-1でcharsetを引く', () => {
    expect(decodeSequence(logitsFor([4, 5]), 2, vocab, charset)).toBe('cd')
  })
  it('id0(EOS)で打ち切る', () => {
    expect(decodeSequence(logitsFor([4, 0, 5]), 3, vocab, charset)).toBe('c')
  })
  it('id1〜3(特殊トークン)は飛ばす', () => {
    expect(decodeSequence(logitsFor([1, 4, 2, 3, 5]), 5, vocab, charset)).toBe('cd')
  })
  it('連続する同一文字は除去しない(PARSeqはCTCではない)', () => {
    expect(decodeSequence(logitsFor([4, 4, 5, 5]), 4, vocab, charset)).toBe('ccdd')
    const kana = ['あ', 'い', 'う', 'え']
    expect(decodeSequence(logitsFor([4, 4]), 2, vocab, kana)).toBe('ええ')
  })
  it('charsetの範囲外idは無視する', () => {
    const l = new Float32Array(2 * 8)
    l[7] = 5
    l[1 * 8 + 4] = 5
    expect(decodeSequence(l, 2, 8, charset)).toBe('c')
  })
})

describe('parseCharset', () => {
  it('model.charset_train の二重引用符スカラーを1文字ずつの配列にする', () => {
    const yaml = [
      '# @package _global_',
      'model:',
      '  charset_test: " !\\"#"',
      '  charset_train: " !\\"#[\\\\]あ𠮷"',
      '  other: 1',
    ].join('\n')
    expect(parseCharset(yaml)).toEqual([' ', '!', '"', '#', '[', '\\', ']', 'あ', '𠮷'])
  })
  it('charset_trainが無ければ例外を投げる', () => {
    expect(() => parseCharset('model:\n  x: 1\n')).toThrow()
  })
})
