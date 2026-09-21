import { describe, expect, it } from 'vitest'
// @ts-expect-error mjs without types
import { mirrorKey, buildMirrorPlan } from './mirrorPlan.mjs'
// @ts-expect-error mjs without types
import { MODEL_FILES } from './modelFiles.mjs'

const f = { dest: 'public/models/a.onnx', sha256: 'ab'.repeat(32), sources: ['x'] }

describe('mirrorKey', () => {
  it('ハッシュを含む不変キーになる', () => {
    expect(mirrorKey(f)).toBe(`models/${'ab'.repeat(32)}/a.onnx`)
  })
  it('sha256 が null のファイルはミラー不可', () => {
    expect(() => mirrorKey({ ...f, sha256: null })).toThrow(/sha256/)
  })
})

describe('buildMirrorPlan', () => {
  it('wrangler r2 object put の引数を組み立てる(実行はしない)', () => {
    const [p] = buildMirrorPlan([f], 'ebook-maker-models')
    expect(p.wranglerArgs).toEqual([
      'r2', 'object', 'put', `ebook-maker-models/models/${'ab'.repeat(32)}/a.onnx`,
      '--file', 'public/models/a.onnx', '--remote',
      '--content-type', 'application/octet-stream',
      '--cache-control', 'public, max-age=31536000, immutable',
    ])
  })
  it('sha256 が null のエントリはスキップする', () => {
    expect(buildMirrorPlan([f, { ...f, dest: 'public/config/b.yaml', sha256: null }], 'b')).toHaveLength(1)
  })
  it('ハッシュ記録済みの MODEL_FILES につき、ちょうど1件の計画になる', () => {
    const files = MODEL_FILES as { sha256: string | null }[]
    const plan = buildMirrorPlan(files, 'b')
    expect(plan).toHaveLength(files.filter((x) => x.sha256).length)
    expect(new Set(plan.map((p: { key: string }) => p.key)).size).toBe(plan.length)
  })
})
