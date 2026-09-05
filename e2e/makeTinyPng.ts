import zlib from 'node:zlib'

function crc32(buf: Buffer): number {
  const table: number[] = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

export function makeTinyPng(
  width: number,
  height: number,
  pixel: [number, number, number, number],
): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA

  const raw = Buffer.alloc(height * (1 + width * 4))
  let o = 0
  for (let y = 0; y < height; y += 1) {
    raw[o] = 0 // filter type: none
    o += 1
    for (let x = 0; x < width; x += 1) {
      raw[o] = pixel[0]
      raw[o + 1] = pixel[1]
      raw[o + 2] = pixel[2]
      raw[o + 3] = pixel[3]
      o += 4
    }
  }
  const idatData = zlib.deflateSync(raw)

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))])
}
