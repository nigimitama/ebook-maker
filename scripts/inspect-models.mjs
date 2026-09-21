// 使い方: node scripts/inspect-models.mjs path/to/model.onnx
import * as ort from 'onnxruntime-node'
const s = await ort.InferenceSession.create(process.argv[2])
console.log('inputs', s.inputNames, 'outputs', s.outputNames)
console.log(JSON.stringify(s.inputMetadata ?? '', null, 1))
console.log(JSON.stringify(s.outputMetadata ?? '', null, 1))
