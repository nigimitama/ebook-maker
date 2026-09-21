import { createHash } from 'node:crypto'

const UPSTREAM = 'https://raw.githubusercontent.com/yuta1984/ndlocrlite-web/50216cc/public'
const R2 = 'https://pub-9cac8877191a4c3697edb59fd982130f.r2.dev'

export const MODEL_FILES = [
  { dest: 'public/models/deim-s-1024x1024.onnx', url: `${UPSTREAM}/models/deim-s-1024x1024.onnx`, sha256: 'c156ce0c4e704bc3bf7e4016d0a87b949cffa8b3724f4b4cc696b8284c3c7373' },
  { dest: 'public/models/parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx', url: `${R2}/parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx`, sha256: '9e651bae4c1a4d5254da1127e86e82e21ef62d5339b37e62d4a3d3d30831772d' },
  { dest: 'public/models/parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx', url: `${R2}/parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx`, sha256: '49cea9db4552f19eb05c8ee202fcf74714977749b2f4c9376b127fde41b07a99' },
  { dest: 'public/models/parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx', url: `${R2}/parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx`, sha256: '06462b0dbd5b0b8508545c8c3d485cf20dbf4ffa652fe145e69c9e7457080602' },
  // ハッシュ未計測。固定コミットから取得する
  { dest: 'public/config/NDLmoji.yaml', url: `${UPSTREAM}/config/NDLmoji.yaml`, sha256: null },
]

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** expected が null のときは検証しない(常に true)。 */
export function verifyHash(buf, expected) {
  return expected == null || sha256Hex(buf) === expected
}
