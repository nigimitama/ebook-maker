import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MODEL_FILES, sha256Hex, verifyHash } from './modelFiles.mjs'

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
  console.log(`fetch ${f.url}`)
  const res = await fetch(f.url)
  if (!res.ok) throw new Error(`download failed: ${res.status} ${f.url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (!verifyHash(buf, f.sha256)) {
    throw new Error(`SHA-256 mismatch for ${f.dest}: expected ${f.sha256}, got ${sha256Hex(buf)}`)
  }
  await mkdir(dirname(f.dest), { recursive: true })
  await writeFile(f.dest, buf)
  console.log(`ok    ${f.dest}`)
}
