import { createHash } from 'node:crypto'

// 一次ソース: NDL公式 ndl-lab/ndlocr-lite の固定コミット(CC BY 4.0)。
// docs/superpowers/specs/2026-09-21-model-hosting-decision.md 参照。
const OFFICIAL_SHA = 'd25e0d415b607ad44459ca6b95c7512a54363935'
const OFFICIAL_MODEL = `https://raw.githubusercontent.com/ndl-lab/ndlocr-lite/${OFFICIAL_SHA}/src/model`
const OFFICIAL_CONFIG = `https://raw.githubusercontent.com/ndl-lab/ndlocr-lite/${OFFICIAL_SHA}/src/config`
// 二次ソース(ミラー): ndlocrlite-web の固定コミット。公式とバイト同一のものに限る。
const NDLOCRLITE_WEB = 'https://raw.githubusercontent.com/yuta1984/ndlocrlite-web/50216cc/public'

/** 1ファイル = 複数ソース。sources は先頭が一次。 */
export const MODEL_FILES = [
  {
    dest: 'public/models/deim-s-1024x1024.onnx',
    sources: [`${OFFICIAL_MODEL}/deim-s-1024x1024.onnx`, `${NDLOCRLITE_WEB}/models/deim-s-1024x1024.onnx`],
    sha256: 'c156ce0c4e704bc3bf7e4016d0a87b949cffa8b3724f4b4cc696b8284c3c7373',
  },
  {
    dest: 'public/models/parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx',
    sources: [`${OFFICIAL_MODEL}/parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx`],
    sha256: '9e651bae4c1a4d5254da1127e86e82e21ef62d5339b37e62d4a3d3d30831772d',
  },
  {
    dest: 'public/models/parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx',
    sources: [`${OFFICIAL_MODEL}/parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx`],
    sha256: '49cea9db4552f19eb05c8ee202fcf74714977749b2f4c9376b127fde41b07a99',
  },
  {
    dest: 'public/models/parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx',
    sources: [`${OFFICIAL_MODEL}/parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx`],
    sha256: '06462b0dbd5b0b8508545c8c3d485cf20dbf4ffa652fe145e69c9e7457080602',
  },
  {
    // 公式版。現行(ndlocrlite-web)版とは4文字だけ違い、実機スモークで出力が一致することを確認して採用した。
    // docs/superpowers/specs/2026-09-21-ocr-phase2-model-notes.md の「NDLmoji.yaml: 公式版と現行版の差」参照。
    dest: 'public/config/NDLmoji.yaml',
    sources: [`${OFFICIAL_CONFIG}/NDLmoji.yaml`],
    sha256: 'f6ad5a2de444b495155866af811cf1a98309dcae3225db802767ea531a2dc529',
  },
]

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** expected が null のときは検証しない(常に true)。 */
export function verifyHash(buf, expected) {
  return expected == null || sha256Hex(buf) === expected
}
