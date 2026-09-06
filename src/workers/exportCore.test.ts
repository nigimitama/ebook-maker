import { describe, it, expect, vi } from 'vitest'
import { runExport } from './exportCore'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import type { RawImage } from '../types'
import { decodeBase64Png } from '../test/pngFixture'

function rawImage(w: number, h: number): RawImage {
  return { data: new Uint8ClampedArray(w * h * 4).fill(128), width: w, height: h }
}

describe('runExport', () => {
  const fixturePng = decodeBase64Png()
  const fakeEncode = vi.fn(async (_image: RawImage) => fixturePng)
  // 本物のデコーダは createImageBitmap/canvas を必要とするため、blobを無視して
  // 固定の画像を返すfakeを注入し、このテストを純粋なNode環境で完結させる。
  const fakeDecode = vi.fn(async (_blob: Blob) => rawImage(2, 1))

  it('decodes each page blob, applies its adjustment, encodes it, then builds a PDF', async () => {
    const bytes = await runExport(
      {
        format: 'pdf',
        metadata: { title: 'T', author: 'A' },
        pages: [
          { blob: new Blob(['a']), adjustment: { brightness: 0, contrast: 0 } },
          { blob: new Blob(['b']), adjustment: { brightness: 10, contrast: 10 } },
        ],
      },
      fakeEncode,
      fakeDecode,
    )
    expect(fakeDecode).toHaveBeenCalledTimes(2)
    expect(fakeEncode).toHaveBeenCalledTimes(2)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getTitle()).toBe('T')
  })

  it('builds an EPUB when format is epub', async () => {
    const bytes = await runExport(
      {
        format: 'epub',
        metadata: { title: 'T2', author: 'A2' },
        pages: [{ blob: new Blob(['a']), adjustment: { brightness: 0, contrast: 0 } }],
      },
      fakeEncode,
      fakeDecode,
    )
    const zip = await JSZip.loadAsync(bytes)
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip')
  })
})
