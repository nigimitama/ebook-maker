import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MODEL_FILES, verifyHash } from './modelFiles.mjs'
import { fetchVerified } from './fetchWithFallback.mjs'

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
  // sources は先頭が一次(公式)。取得失敗・ハッシュ不一致なら次のソースへ回る。
  const buf = await fetchVerified(f.sources, f.sha256)
  await mkdir(dirname(f.dest), { recursive: true })
  await writeFile(f.dest, buf)
  console.log(`ok    ${f.dest}`)
}
