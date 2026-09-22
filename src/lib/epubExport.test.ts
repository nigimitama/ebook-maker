import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildEpub } from './epubExport'
import { decodeBase64Jpeg } from '../test/jpegFixture'

describe('buildEpub', () => {
  it('produces a valid EPUB3 package with one xhtml+image pair per page', async () => {
    const jpeg = decodeBase64Jpeg()
    const pages = [
      { jpeg, width: 2, height: 1 },
      { jpeg, width: 2, height: 1 },
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

    // EPUB 3は dcterms:modified を、ミリ秒なしの CCYY-MM-DDThh:mm:ssZ 形式で
    // ちょうど1つ要求する。満たさないとepubcheckがパッケージを弾く。
    expect(opf).toMatch(/dcterms:modified">\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z</)
    expect(opf.match(/property="dcterms:modified"/g)).toHaveLength(1)

    expect(zip.file('OEBPS/images/page-1.jpg')).not.toBeNull()
    expect(zip.file('OEBPS/images/page-2.jpg')).not.toBeNull()
    expect(zip.file('OEBPS/text/page-1.xhtml')).not.toBeNull()
    expect(zip.file('OEBPS/text/page-2.xhtml')).not.toBeNull()

    const page1Xhtml = await zip.file('OEBPS/text/page-1.xhtml')!.async('string')
    expect(page1Xhtml).toContain('width="2"')
    expect(page1Xhtml).toContain('height="1"')

    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav).toContain('epub:type="toc"')
  })

  it('escapes XML-unsafe characters in metadata', async () => {
    const jpeg = decodeBase64Jpeg()
    const bytes = await buildEpub([{ jpeg, width: 2, height: 1 }], {
      title: 'A & B <Title>',
      author: 'X',
    })
    const zip = await JSZip.loadAsync(bytes)
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('A &amp; B &lt;Title&gt;')
  })

  it('builds a nested toc in nav.xhtml from chapters', async () => {
    const jpeg = decodeBase64Jpeg()
    const pages = [0, 1, 2].map(() => ({ jpeg, width: 2, height: 1 }))
    const bytes = await buildEpub(pages, { title: 't', author: 'a' }, [
      { title: '第1章 <はじめに>', pageIndex: 0, level: 1 },
      { title: '1.1 背景', pageIndex: 1, level: 2 },
      { title: '第2章', pageIndex: 2, level: 1 },
      { title: '範囲外', pageIndex: 9, level: 1 },
    ])
    const zip = await JSZip.loadAsync(bytes)
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav).toContain('<a href="text/page-1.xhtml">第1章 &lt;はじめに&gt;</a>')
    expect(nav).toContain('<a href="text/page-2.xhtml">1.1 背景</a>')
    expect(nav).toContain('<a href="text/page-3.xhtml">第2章</a>')
    expect(nav).not.toContain('範囲外')
    expect(nav).not.toContain('>Start<')
    // 節は章の <li> の中の入れ子の <ol> に入る。
    expect(nav).toMatch(/第1章[\s\S]*<ol>[\s\S]*1\.1 背景[\s\S]*<\/ol>[\s\S]*第2章/)
  })

  it('keeps the plain nav when there are no chapters', async () => {
    const jpeg = decodeBase64Jpeg()
    const bytes = await buildEpub([{ jpeg, width: 2, height: 1 }], { title: 't', author: 'a' })
    const zip = await JSZip.loadAsync(bytes)
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav).toContain('>Start<')
  })
})
