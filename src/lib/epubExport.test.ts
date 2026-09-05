import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildEpub } from './epubExport'
import { decodeBase64Png } from '../test/pngFixture'

describe('buildEpub', () => {
  it('produces a valid EPUB3 package with one xhtml+image pair per page', async () => {
    const png = decodeBase64Png()
    const pages = [
      { png, width: 2, height: 1 },
      { png, width: 2, height: 1 },
    ]
    const bytes = await buildEpub(pages, { title: 'My Book', author: 'Someone' })
    const zip = await JSZip.loadAsync(bytes)

    const mimetype = await zip.file('mimetype')!.async('string')
    expect(mimetype).toBe('application/epub+zip')

    expect(await zip.file('META-INF/container.xml')!.async('string')).toContain(
      'OEBPS/content.opf',
    )

    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<dc:title>My Book</dc:title>')
    expect(opf).toContain('<dc:creator>Someone</dc:creator>')
    expect(opf).toContain('rendition:layout')
    expect(opf).toContain('pre-paginated')

    expect(zip.file('OEBPS/images/page-1.png')).not.toBeNull()
    expect(zip.file('OEBPS/images/page-2.png')).not.toBeNull()
    expect(zip.file('OEBPS/text/page-1.xhtml')).not.toBeNull()
    expect(zip.file('OEBPS/text/page-2.xhtml')).not.toBeNull()

    const page1Xhtml = await zip.file('OEBPS/text/page-1.xhtml')!.async('string')
    expect(page1Xhtml).toContain('width="2"')
    expect(page1Xhtml).toContain('height="1"')

    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav).toContain('epub:type="toc"')
  })

  it('escapes XML-unsafe characters in metadata', async () => {
    const png = decodeBase64Png()
    const bytes = await buildEpub([{ png, width: 2, height: 1 }], {
      title: 'A & B <Title>',
      author: 'X',
    })
    const zip = await JSZip.loadAsync(bytes)
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('A &amp; B &lt;Title&gt;')
  })
})
