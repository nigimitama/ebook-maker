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
})

describe('MODEL_FILES', () => {
  type Entry = { dest: string; sha256: string | null; sources: string[] }
  const entries = MODEL_FILES as Entry[]

  it('全エントリが sources を1つ以上持つ', () => {
    expect(entries.length).toBeGreaterThan(0)
    for (const f of entries) {
      expect(f.sources.length, f.dest).toBeGreaterThanOrEqual(1)
      for (const url of f.sources) expect(url, f.dest).toMatch(/^https:\/\//)
    }
  })
  it('モデル(.onnx)4本は64桁hexの sha256 を持つ', () => {
    const models = entries.filter((f) => f.dest.endsWith('.onnx'))
    expect(models).toHaveLength(4)
    for (const f of models) expect(f.sha256, f.dest).toMatch(/^[0-9a-f]{64}$/)
  })
  it('NDLmoji.yaml も64桁hexの sha256 を記録している(公式版を採用)', () => {
    const yaml = entries.find((f) => f.dest.endsWith('NDLmoji.yaml'))
    expect(yaml?.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
  it('個人R2バケットを参照しない', () => {
    for (const f of entries) for (const url of f.sources) expect(url).not.toContain('r2.dev')
  })
})
