// 使い方: npm i --no-save onnxruntime-node && node scripts/inspect-models.mjs path/to/model.onnx
// (onnxruntime-node は調査専用。package.json には追加しない)
import * as ort from 'onnxruntime-node'
const s = await ort.InferenceSession.create(process.argv[2])
console.log('inputs', s.inputNames, 'outputs', s.outputNames)
console.log(JSON.stringify(s.inputMetadata ?? '', null, 1))
console.log(JSON.stringify(s.outputMetadata ?? '', null, 1))
