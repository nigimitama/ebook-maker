import type { RecognizerKey } from './ocrConfig'
import type { Box } from './types'

// layout モデルの char_count(3->30文字, 2->50文字, それ以外->100文字)で
// 認識モデルを選ぶ。char_count が無いときは最大の100にフォールバックする
// (どの長さでも入るので安全側)。box は将来の補助判定用で現状は使わない。
export function pickRecognizer(charCount: number | undefined, _box: Box): RecognizerKey {
  if (charCount === 3) return 30
  if (charCount === 2) return 50
  return 100
}

// logits [seqLen, vocab] を位置ごとにargmaxして文字列にする。
// id0=EOSで終了、id1〜3(特殊トークン)は飛ばし、文字は charset[id-1]。
// id-1 の写像には先頭3文字が出力不能になる既知の限界がある
// (docs/superpowers/specs/2026-09-21-ocr-phase2-model-notes.md の KNOWN LIMITATION 参照)。
// PARSeqはCTCではないので、連続する同一文字は除去しない。
export function decodeSequence(logits: Float32Array, seqLen: number, vocab: number, charset: string[]): string {
  let text = ''
  for (let p = 0; p < seqLen; p += 1) {
    let best = 0
    let bestVal = -Infinity
    for (let v = 0; v < vocab; v += 1) {
      const val = logits[p * vocab + v]
      if (val > bestVal) {
        bestVal = val
        best = v
      }
    }
    if (best === 0) break
    if (best < 4) continue
    const ch = charset[best - 1]
    if (ch !== undefined) text += ch
  }
  return text
}

// NDLmoji.yaml の model.charset_train(二重引用符スカラー)を1文字ずつの配列にする。
// 二重引用符のエスケープ(\" と \)はJSONと同じなのでJSON.parseで読める。
export function parseCharset(yamlText: string): string[] {
  const m = yamlText.match(/^\s*charset_train:\s*("(?:[^"\\\n]|\\.)*")\s*$/m)
  if (!m) throw new Error('charset_train が見つかりません')
  return Array.from(JSON.parse(m[1]) as string)
}
