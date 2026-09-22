import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MODEL_FILES, verifyHash } from './modelFiles.mjs'
import { fetchWithR2Fallback } from './r2Source.mjs'

async function readIfExists(path) {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

for (const f of MODEL_FILES) {
  const existing = await readIfExists(f.dest)
  // ハッシュ未記録のファイルは存在すればスキップ
  if (existing && verifyHash(existing, f.sha256)) {
    console.log(`skip  ${f.dest}`)
    continue
  }
  console.log(`fetch ${f.dest}`)
  // sources は先頭が一次(公式)。取得失敗・ハッシュ不一致なら次のソースへ回り、
  // 公式が全滅したときだけ(R2 の Secrets があれば)ミラーへフォールバックする。
  const buf = await fetchWithR2Fallback(f, process.env)
  await mkdir(dirname(f.dest), { recursive: true })
  await writeFile(f.dest, buf)
  console.log(`ok    ${f.dest}`)
}
