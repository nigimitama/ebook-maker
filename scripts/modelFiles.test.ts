import { describe, expect, it } from 'vitest'
// @ts-expect-error mjs without types
import { MODEL_FILES, sha256Hex, verifyHash } from './modelFiles.mjs'

describe('verifyHash', () => {
  const buf = Buffer.from('abc')
  const h = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  it('一致すれば true', () => {
    expect(sha256Hex(buf)).toBe(h)
    expect(verifyHash(buf, h)).toBe(true)
  })
  it('不一致なら false', () => {
    expect(verifyHash(buf, '0'.repeat(64))).toBe(false)
  })
  it('期待値 null は検証しない', () => {
    expect(verifyHash(buf, null)).toBe(true)
  })
  it('MODEL_FILES は 5 件', () => {
    expect(MODEL_FILES).toHaveLength(5)
  })
})
