import { PDFDocument, PDFHexString, PDFName, type PDFContext, type PDFRef } from 'pdf-lib'
import type { BookMetadata, ExportChapter } from '../types'
import { buildOutlineTree, type OutlineNode } from './toc/chapters'

export interface ExportPage {
  jpeg: Uint8Array
  width: number
  height: number
}

// 兄弟の項目を書き込み、先頭・末尾の参照と、子孫を含めた項目数を返す。
// pdf-lib にはしおり用のAPIがないので、低レベルの辞書を組み立てる。
function writeOutlineItems(
  doc: PDFDocument,
  context: PDFContext,
  nodes: OutlineNode[],
  parentRef: PDFRef,
): { first: PDFRef; last: PDFRef; count: number } {
  const refs = nodes.map(() => context.nextRef())
  let count = 0
  nodes.forEach((node, i) => {
    const dict = context.obj({
      Title: PDFHexString.fromText(node.chapter.title),
      Parent: parentRef,
      Dest: [doc.getPage(node.chapter.pageIndex).ref, PDFName.of('Fit')],
    })
    if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1])
    if (i < nodes.length - 1) dict.set(PDFName.of('Next'), refs[i + 1])
    count += 1
    if (node.children.length > 0) {
      const children = writeOutlineItems(doc, context, node.children, refs[i])
      dict.set(PDFName.of('First'), children.first)
      dict.set(PDFName.of('Last'), children.last)
      dict.set(PDFName.of('Count'), context.obj(children.count))
      count += children.count
    }
    context.assign(refs[i], dict)
  })
  return { first: refs[0], last: refs[refs.length - 1], count }
}

function addOutlines(doc: PDFDocument, chapters: ExportChapter[]): void {
  const pageCount = doc.getPageCount()
  const valid = chapters.filter((c) => c.pageIndex >= 0 && c.pageIndex < pageCount)
  const roots = buildOutlineTree(valid)
  if (roots.length === 0) return
  const context = doc.context
  const rootRef = context.nextRef()
  const items = writeOutlineItems(doc, context, roots, rootRef)
  const rootDict = context.obj({
    Type: 'Outlines',
    First: items.first,
    Last: items.last,
    Count: items.count,
  })
  context.assign(rootRef, rootDict)
  doc.catalog.set(PDFName.of('Outlines'), rootRef)
}

export async function buildPdf(
  pages: ExportPage[],
  metadata: BookMetadata,
  chapters: ExportChapter[] = [],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  if (metadata.title) doc.setTitle(metadata.title)
  if (metadata.author) doc.setAuthor(metadata.author)

  for (const page of pages) {
    const image = await doc.embedJpg(page.jpeg)
    const pdfPage = doc.addPage([page.width, page.height])
    pdfPage.drawImage(image, { x: 0, y: 0, width: page.width, height: page.height })
  }

  if (pages.length > 0) {
    const firstPage = doc.getPage(0)
    const openAction = doc.context.obj([firstPage.ref, PDFName.of('FitH'), null])
    doc.catalog.set(PDFName.of('OpenAction'), openAction)
  }

  addOutlines(doc, chapters)

  return doc.save()
}
