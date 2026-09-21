import { describe, expect, it } from 'vitest'
// @ts-expect-error mjs without types
import { mirrorKey, buildMirrorPlan, validateBucket, wranglerCommand } from './mirrorPlan.mjs'
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
    expect(buildMirrorPlan([f, { ...f, dest: 'public/config/b.yaml', sha256: null }], 'bkt')).toHaveLength(1)
  })
  it('ハッシュ記録済みの MODEL_FILES の数だけ計画が作られ、キーは一意', () => {
    const files = MODEL_FILES as { sha256: string | null }[]
    const plan = buildMirrorPlan(files, 'bkt')
    expect(plan).toHaveLength(files.filter((x) => x.sha256).length)
    expect(new Set(plan.map((p: { key: string }) => p.key)).size).toBe(plan.length)
  })
})

describe('mirrorKey 追加', () => {
  it('サブディレクトリ付き dest でもキーは basename のみ', () => {
    expect(mirrorKey({ ...f, dest: 'public/config/sub/n.yaml' })).toBe(`models/${'ab'.repeat(32)}/n.yaml`)
  })
  it('sha256 が64桁hexでなければ拒否', () => {
    expect(() => mirrorKey({ ...f, sha256: 'xyz' })).toThrow(/sha256/)
  })
})

describe('validateBucket', () => {
  it.each(['ebook-maker-models', 'abc', 'a1-b2', 'a'.repeat(63)])('有効: %s', (b) => {
    expect(validateBucket(b)).toBe(b)
  })
  it.each(['Ebook', 'a b', 'x & calc', 'ab', 'a'.repeat(64), '-abc', 'abc-', '', 'a;b', 'a"b'])('無効: %s', (b) => {
    expect(() => validateBucket(b)).toThrow(/R2_BUCKET/)
  })
  it('buildMirrorPlan も不正なバケットを拒否する', () => {
    expect(() => buildMirrorPlan([f], 'x & calc')).toThrow(/R2_BUCKET/)
  })
})

describe('引数の構造', () => {
  it('cache-control の値は配列の1要素のまま', () => {
    const [p] = buildMirrorPlan([f], 'bucket')
    const i = p.wranglerArgs.indexOf('--cache-control')
    expect(p.wranglerArgs[i + 1]).toBe('public, max-age=31536000, immutable')
  })
})

describe('wranglerCommand', () => {
  it('win32 はシェルなしで node + npx-cli.js、メジャー固定', () => {
    const c = wranglerCommand(['r2'], 'win32', 'C:\\node\\node.exe')
    expect(c.command).toBe('C:\\node\\node.exe')
    expect(c.args[0]).toBe('C:\\node\\node_modules\\npm\\bin\\npx-cli.js')
    expect(c.args.slice(1)).toEqual(['--yes', 'wrangler@4', 'r2'])
  })
  it('その他は npx wrangler@4', () => {
    expect(wranglerCommand(['r2'], 'linux')).toEqual({ command: 'npx', args: ['--yes', 'wrangler@4', 'r2'] })
  })
})
