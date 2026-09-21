export const OCR_CONFIG = {
  layout: {
    url: 'models/deim-s-1024x1024.onnx', // サイト相対
    inputSize: 800, // ファイル名は1024だが実体は800
    scoreThreshold: 0.3,
    nmsIou: 0.5,
    lineBoxPadRatio: 0.02,
    minBoxPx: 10,
    mean: [123.675, 116.28, 103.53],
    std: [58.395, 57.12, 57.375],
    lineClassIds: [1, 2, 3, 4, 5, 16],
    blockClassId: 0, // label-1 後
  },
  recognizers: {
    // キー = 最大文字数。char_count 3->30, 2->50, その他->100
    30: { url: 'models/parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx', height: 24, width: 256 },
    50: { url: 'models/parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx', height: 24, width: 384 },
    100: { url: 'models/parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx', height: 24, width: 768 },
  },
  charsetUrl: 'config/NDLmoji.yaml', // キー model.charset_train, 7141文字
} as const

export type RecognizerKey = keyof typeof OCR_CONFIG.recognizers // 30 | 50 | 100
