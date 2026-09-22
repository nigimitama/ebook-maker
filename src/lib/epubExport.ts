import JSZip from 'jszip'
import type { BookMetadata, ExportChapter } from '../types'
import { buildOutlineTree, type OutlineNode } from './toc/chapters'
import type { ExportPage } from './pdfExport'

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function pseudoUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// EPUB 3は CCYY-MM-DDThh:mm:ssZ 形式(ミリ秒なし)の dcterms:modified を
// ちょうど1つ要求する。これがないとepubcheckが通らず、Apple BooksやKoboなど
// 厳格なリーダーにファイルを弾かれる。
function epubTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function pageXhtml(n: number, width: number, height: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Page ${n}</title>
  <meta name="viewport" content="width=${width}, height=${height}"/>
</head>
<body style="margin:0;padding:0">
  <img src="../images/page-${n}.jpg" width="${width}" height="${height}" alt="page ${n}"/>
</body>
</html>
`
}

function navItems(nodes: OutlineNode[], indent: string): string {
  return nodes
    .map((node) => {
      const link = `<a href="text/page-${node.chapter.pageIndex + 1}.xhtml">${escapeXml(node.chapter.title)}</a>`
      if (node.children.length === 0) return `${indent}<li>${link}</li>`
      return `${indent}<li>${link}\n${indent}  <ol>\n${navItems(node.children, `${indent}    `)}\n${indent}  </ol>\n${indent}</li>`
    })
    .join('\n')
}

function navXhtml(chapters: ExportChapter[], pageCount: number): string {
  const valid = chapters.filter((c) => c.pageIndex >= 0 && c.pageIndex < pageCount)
  const items =
    valid.length > 0
      ? navItems(buildOutlineTree(valid), '      ')
      : '      <li><a href="text/page-1.xhtml">Start</a></li>'
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Navigation</title></head>
<body>
  <nav epub:type="toc">
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>
`
}

// JSZip.folder() がnullを返すのは受け付けない名前(正規表現的な引数)を
// 渡した場合だけ。ここでの呼び出しはすべて素の文字列リテラルなので、
// nullは回復すべき状態ではなくこのファイルのバグを意味する。
function folder(zip: JSZip, name: string): JSZip {
  const created = zip.folder(name)
  if (!created) throw new Error(`failed to create zip folder: ${name}`)
  return created
}

export async function buildEpub(
  pages: ExportPage[],
  metadata: BookMetadata,
  chapters: ExportChapter[] = [],
): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  folder(zip, 'META-INF').file('container.xml', CONTAINER_XML)

  const oebps = folder(zip, 'OEBPS')
  const images = folder(oebps, 'images')
  const text = folder(oebps, 'text')

  const manifestItems: string[] = []
  const spineItems: string[] = []

  pages.forEach((page, index) => {
    const n = index + 1
    images.file(`page-${n}.jpg`, page.jpeg)
    text.file(`page-${n}.xhtml`, pageXhtml(n, page.width, page.height))
    manifestItems.push(
      `<item id="img${n}" href="images/page-${n}.jpg" media-type="image/jpeg"/>`,
    )
    manifestItems.push(
      `<item id="page${n}" href="text/page-${n}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    spineItems.push(`<itemref idref="page${n}"/>`)
  })

  oebps.file('nav.xhtml', navXhtml(chapters, pages.length))

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${pseudoUuid()}</dc:identifier>
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    <dc:creator>${escapeXml(metadata.author)}</dc:creator>
    <dc:language>ja</dc:language>
    <meta property="dcterms:modified">${epubTimestamp()}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>
`
  oebps.file('content.opf', opf)

  return zip.generateAsync({ type: 'uint8array' })
}
