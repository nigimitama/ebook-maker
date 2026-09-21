// モデルを R2 へミラーする。既定は dry-run(計画表示のみ)。--execute のときだけ wrangler を実行する。
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { MODEL_FILES, verifyHash } from './modelFiles.mjs'
import { buildMirrorPlan, validateBucket, wranglerCommand } from './mirrorPlan.mjs'

const execute = process.argv.includes('--execute')
const bucket = process.env.R2_BUCKET
if (!bucket) {
  console.error('R2_BUCKET 環境変数が未設定です')
  process.exit(1)
}

try {
  validateBucket(bucket)
} catch (e) {
  console.error(e.message)
  process.exit(1)
}

const plan = buildMirrorPlan(MODEL_FILES, bucket)
console.log(`${execute ? 'EXECUTE' : 'dry-run'}: ${plan.length} ファイル → ${bucket}`)
for (const p of plan) console.log(`  ${p.localPath} -> ${bucket}/${p.key}`)

if (!execute) {
  console.log('dry-run のため何も実行していません(--execute で実行)')
  process.exit(0)
}

// アップロード前に全ファイルのSHA-256を再検証(1つでも不一致・欠損なら中止)
for (const p of plan) {
  let buf
  try {
    buf = await readFile(p.localPath)
  } catch {
    console.error(`中止: ファイルがありません: ${p.localPath}(npm run fetch-models を先に実行)`)
    process.exit(1)
  }
  if (!verifyHash(buf, p.sha256)) {
    console.error(`中止: SHA-256 が一致しません: ${p.localPath}`)
    process.exit(1)
  }
}

for (const p of plan) {
  console.log(`put ${p.key}`)
  // シェルは使わない(引数の分割・コマンド注入を避ける)
  const { command, args } = wranglerCommand(p.wranglerArgs)
  const r = spawnSync(command, args, { stdio: 'inherit' })
  if (r.error) console.error(r.error)
  if (r.status !== 0) {
    console.error(`中止: wrangler が失敗しました(${p.key})`)
    process.exit(r.status ?? 1)
  }
}
console.log('done')
