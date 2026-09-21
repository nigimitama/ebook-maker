import { basename } from 'node:path'

/** 内容アドレスのキー(ハッシュ入り)。不変・長期キャッシュ可能。 */
export function mirrorKey(file) {
  if (!file.sha256) throw new Error(`sha256 が未記録のファイルはミラーできません: ${file.dest}`)
  return `models/${file.sha256}/${basename(file.dest)}`
}

/** sha256 未記録のエントリは対象外。実行はせず引数を組み立てるだけ。 */
export function buildMirrorPlan(files, bucket) {
  return files
    .filter((f) => f.sha256)
    .map((f) => ({
      key: mirrorKey(f),
      localPath: f.dest,
      sha256: f.sha256,
      wranglerArgs: [
        'r2', 'object', 'put', `${bucket}/${mirrorKey(f)}`,
        '--file', f.dest, '--remote',
        '--content-type', 'application/octet-stream',
        '--cache-control', 'public, max-age=31536000, immutable',
      ],
    }))
}
