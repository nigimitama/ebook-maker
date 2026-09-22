import { describe, it, expect } from 'vitest'
import type { RawImage } from '../../types'
import { OCR_CONFIG, type RecognizerKey } from './ocrConfig'
import { runOcr, type OcrSessions } from './ocrPipeline'

// 白地の画像。中身は検出をモックするので値は使わない。
function blankImage(width: number, height: number): RawImage {
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(255)
  return { data, width, height }
}

// 位置ごとに argmax が id になる logits を作る
function logitsFor(ids: number[], vocab: number): Float32Array {
  const l = new Float32Array(ids.length * vocab)
  ids.forEach((id, p) => {
    l[p * vocab + id] = 5
  })
  return l
}

describe('runOcr', () => {
  // charset[id-1] 写像なので id4='あ', id5='い', id6='う', id7='え'
  const charset = ['x', 'y', 'z', 'あ', 'い', 'う', 'え']
  const vocab = 8

  // 横書き2行の画像(scale = 800/400 = 2)。
  // 検出の座標は 800 空間で返す必要がある。
  const img = blankImage(400, 200)
  const size = OCR_CONFIG.layout.inputSize

  // 下の行(y=100..140)を先に、上の行(y=20..60)を後に返す。
  // 読み順(上→下)で並べ替えられることを確かめる。
  const boxes = new Float32Array([
    20 * 2,
    100 * 2,
    300 * 2,
    140 * 2, // 下の行
    20 * 2,
    20 * 2,
    300 * 2,
    60 * 2, // 上の行
  ])
  const raw = {
    boxes,
    scores: new Float32Array([0.9, 0.95]),
    // label は1始まり。label2 -> classId1 = line_main
    classIds: new BigInt64Array([2n, 2n]),
    charCounts: new BigInt64Array([3n, 2n]),
  }

  function makeSessions(): { sessions: OcrSessions; keys: RecognizerKey[]; tensorLengths: number[] } {
    const keys: RecognizerKey[] = []
    const tensorLengths: number[] = []
    let call = 0
    const sessions: OcrSessions = {
      detect: async (tensor, s) => {
        expect(s).toBe(size)
        expect(tensor.length).toBe(3 * size * size)
        return raw
      },
      recognize: async (key, tensor) => {
        keys.push(key)
        tensorLengths.push(tensor.length)
        // 1回目(読み順で先頭=上の行) -> 'あい'、2回目 -> 'ううえ'
        const ids = call === 0 ? [4, 5, 0] : [6, 6, 7, 0]
        call += 1
        return { logits: logitsFor(ids, vocab), seqLen: ids.length, vocab }
      },
    }
    return { sessions, keys, tensorLengths }
  }

  it('読み順に並んだ2行・期待テキスト・edited:false・一意なidを返す', async () => {
    const { sessions } = makeSessions()
    const result = await runOcr(img, sessions, charset)

    expect(result.lines).toHaveLength(2)
    expect(result.lines.map((l) => l.text)).toEqual(['あい', 'ううえ'])
    expect(result.lines.every((l) => l.edited === false)).toBe(true)
    expect(new Set(result.lines.map((l) => l.id)).size).toBe(2)
    expect(result.lines.every((l) => l.id.length > 0)).toBe(true)

    // 1行目は上の行(y≈20、2%パディング分だけ上下に広い)
    expect(result.lines[0].y).toBeCloseTo(20 - 40 * 0.02, 5)
    expect(result.lines[0].x).toBeCloseTo(20, 5)
    expect(result.lines[0].w).toBeCloseTo(280, 5)
    expect(result.lines[1].y).toBeCloseTo(100 - 40 * 0.02, 5)
    // ブロック検出が無い(rawにtext_blockを含めていない)ので、blockIdは付かない。
    expect(result.lines.every((l) => l.blockId === undefined)).toBe(true)
  })

  it('char_count に応じた認識モデルと入力サイズを使う', async () => {
    const { sessions, keys, tensorLengths } = makeSessions()
    await runOcr(img, sessions, charset)
    // 読み順の1行目 = 上の行 = charCount 2 -> 50、2行目 = charCount 3 -> 30
    expect(keys).toEqual([50, 30])
    expect(tensorLengths).toEqual([
      3 * OCR_CONFIG.recognizers[50].height * OCR_CONFIG.recognizers[50].width,
      3 * OCR_CONFIG.recognizers[30].height * OCR_CONFIG.recognizers[30].width,
    ])
  })

  it('行が検出されなければ空配列を返し、認識は呼ばない', async () => {
    let called = 0
    const sessions: OcrSessions = {
      detect: async () => ({
        boxes: new Float32Array([0, 0, 100, 100]),
        scores: new Float32Array([0.9]),
        classIds: new BigInt64Array([1n]), // classId 0 = text_block(行ではない)
      }),
      recognize: async () => {
        called += 1
        return { logits: new Float32Array(vocab), seqLen: 1, vocab }
      },
    }
    const result = await runOcr(img, sessions, charset)
    expect(result.lines).toEqual([])
    expect(called).toBe(0)
  })

  it('text_blockに収まる行には同じblockIdを付ける', async () => {
    // 上下2行(既存テストと同じ座標)を、それを覆うtext_block(原本座標で
    // x:0..400, y:0..150 = raw値 0,0,800,300)に収める。
    const rawWithBlock = {
      boxes: new Float32Array([
        20 * 2, 20 * 2, 300 * 2, 60 * 2, // 上の行(y=20..60)
        20 * 2, 100 * 2, 300 * 2, 140 * 2, // 下の行(y=100..140)
        0, 0, 800, 300, // text_block本体(label1 -> classId0、原本座標でy=0..150)
      ]),
      scores: new Float32Array([0.95, 0.9, 0.9]),
      classIds: new BigInt64Array([2n, 2n, 1n]),
      charCounts: new BigInt64Array([2n, 3n]),
    }
    const sessions: OcrSessions = {
      detect: async () => rawWithBlock,
      recognize: async () => ({ logits: logitsFor([0], vocab), seqLen: 1, vocab }),
    }
    const result = await runOcr(img, sessions, charset)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].blockId).toBeDefined()
    expect(result.lines[0].blockId).toBe(result.lines[1].blockId)
  })
})
