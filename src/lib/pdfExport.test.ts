import { describe, it, expect } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from 'pdf-lib'
import { buildPdf } from './pdfExport'
import { decodeBase64Jpeg } from '../test/jpegFixture'

describe('buildPdf', () => {
  it('builds a PDF with one page per input image and embeds metadata', async () => {
    const jpeg = decodeBase64Jpeg()
    const pages = [
      { jpeg, width: 2, height: 1 },
      { jpeg, width: 2, height: 1 },
    ]
    const bytes = await buildPdf(pages, { title: 'My Book', author: 'Someone' })
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')

    const loaded = await PDFDocument.load(bytes)
    expect(loaded.getPageCount()).toBe(2)
    expect(loaded.getTitle()).toBe('My Book')
    expect(loaded.getAuthor()).toBe('Someone')
    const [page1] = loaded.getPages()
    expect(page1.getWidth()).toBe(2)
    expect(page1.getHeight()).toBe(1)
  })
})

interface OutlineItem {
  title: string
  pageIndex: number
  children: OutlineItem[]
}

// 生成したPDFを読み直し、/Outlines の木をたどって取り出す。
function readOutline(doc: PDFDocument): OutlineItem[] | null {
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  if (!root) return null
  const pageTags = doc.getPages().map((p) => p.ref.tag)
  const readSiblings = (first: PDFRef | undefined): OutlineItem[] => {
    const items: OutlineItem[] = []
    let ref: PDFRef | undefined = first
    while (ref) {
      const dict = doc.context.lookup(ref, PDFDict)
      const title = dict.lookup(PDFName.of('Title'), PDFHexString).decodeText()
      // Dest は [pageRef, /Fit]
      const dest = dict.lookup(PDFName.of('Dest'), PDFArray)
      const destPage = dest.get(0) as PDFRef
      const firstChild = dict.get(PDFName.of('First')) as PDFRef | undefined
      items.push({
        title,
        pageIndex: pageTags.indexOf(destPage.tag),
        children: readSiblings(firstChild),
      })
      ref = dict.get(PDFName.of('Next')) as PDFRef | undefined
    }
    return items
  }
  return readSiblings(root.get(PDFName.of('First')) as PDFRef | undefined)
}

describe('buildPdf outlines', () => {
  const jpeg = decodeBase64Jpeg()
  const pages = [0, 1, 2].map(() => ({ jpeg, width: 2, height: 1 }))
  const meta = { title: 't', author: 'a' }

  it('adds nested bookmarks pointing at the right pages', async () => {
    const bytes = await buildPdf(pages, meta, [
      { title: '第1章', pageIndex: 0, level: 1 },
      { title: '1.1 背景', pageIndex: 1, level: 2 },
      { title: '第2章', pageIndex: 2, level: 1 },
    ])
    const outline = readOutline(await PDFDocument.load(bytes))
    expect(outline).toEqual([
      { title: '第1章', pageIndex: 0, children: [{ title: '1.1 背景', pageIndex: 1, children: [] }] },
      { title: '第2章', pageIndex: 2, children: [] },
    ])
  })

  it('has no outlines without chapters or when every chapter is out of range', async () => {
    expect(readOutline(await PDFDocument.load(await buildPdf(pages, meta)))).toBeNull()
    const bytes = await buildPdf(pages, meta, [{ title: 'x', pageIndex: 9, level: 1 }])
    expect(readOutline(await PDFDocument.load(bytes))).toBeNull()
  })
})
