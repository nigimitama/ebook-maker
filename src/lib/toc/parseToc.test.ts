import { describe, it, expect } from 'vitest'
import type { OcrResult } from '../ocr/types'
import { defaultBodyStartIndex, entriesToChapters, parseToc, parseTocEntries } from './parseToc'

function result(pageId: string, texts: string[]): OcrResult {
  return {
    pageId,
    modelVersion: 't',
    updatedAt: 1,
    lines: texts.map((text, i) => ({ id: `${pageId}-${i}`, x: 0, y: i * 10, w: 10, h: 10, text, edited: false })),
  }
}

describe('parseTocEntries', () => {
  it('reads dotted-leader lines', () => {
    expect(parseTocEntries(['第1章 はじめに ........ 3', '第2章 手法 ........ 25'])).toEqual([
      { title: '第1章 はじめに', printedPage: 3, level: 1 },
      { title: '第2章 手法', printedPage: 25, level: 1 },
    ])
  })

  it('normalizes full-width digits and ellipsis leaders', () => {
    expect(parseTocEntries(['第１章　はじめに………１２'])).toEqual([
      { title: '第1章 はじめに', printedPage: 12, level: 1 },
    ])
  })

  it('reads lines without leaders', () => {
    expect(parseTocEntries(['序章 出発 7'])).toEqual([
      { title: '序章 出発', printedPage: 7, level: 1 },
    ])
  })

  it('joins a title line with the following number-only line', () => {
    expect(parseTocEntries(['第3章 結果と考察', '48'])).toEqual([
      { title: '第3章 結果と考察', printedPage: 48, level: 1 },
    ])
  })

  it('detects level 2 for numbered sections', () => {
    const entries = parseTocEntries(['第1章 概要 ..... 3', '1.1 背景 ..... 4', '1-2 目的 ..... 6', '(1) 補足 ..... 7'])
    expect(entries.map((e) => e.level)).toEqual([1, 2, 2, 2])
  })

  it('treats "1. Title" as level 1 and unknown titles as level 1', () => {
    const entries = parseTocEntries(['1. Intro ..... 3', 'あとがき ..... 300'])
    expect(entries.map((e) => e.level)).toEqual([1, 1])
  })

  it('keeps roman numeral prefixes as level 1 titles', () => {
    expect(parseTocEntries(['Ⅰ 総論 ..... 9'])).toEqual([{ title: 'I 総論', printedPage: 9, level: 1 }])
  })

  it('ignores headers, bare headings and lines ending in a roman page number', () => {
    expect(parseTocEntries(['目次', 'Chapter 3', '序文 iv', '第1章 はじめに ..... 3'])).toEqual([
      { title: '第1章 はじめに', printedPage: 3, level: 1 },
    ])
  })

  it('ignores page number 0 and numbers of more than 4 digits', () => {
    expect(parseTocEntries(['付録 ..... 0', '年表 ..... 12345'])).toEqual([])
  })

  // 縦書きの本ではページ番号が漢数字(一,二,…)の桁ごとの並びで組まれることがある。
  // 「一」「二」等は通常の単語にも出るため、独立した行としてのみページ番号扱いする。
  it('reads a kanji-digit number on its own line as the page number', () => {
    expect(parseTocEntries(['第一章 発端', '一', '第二章 邂逅', '二一', '第四章 結末', '八九'])).toEqual([
      { title: '第一章 発端', printedPage: 1, level: 1 },
      { title: '第二章 邂逅', printedPage: 21, level: 1 },
      { title: '第四章 結末', printedPage: 89, level: 1 },
    ])
  })

  it('does not read a kanji digit inline at the end of an ordinary title as a page number', () => {
    // 「唯一」のように、通常の単語の末尾がたまたま漢数字と同じ文字になるケース。
    expect(parseTocEntries(['これは唯一の方法である'])).toEqual([])
  })
})

describe('entriesToChapters', () => {
  const pageIds = ['p0', 'p1', 'p2', 'p3', 'p4']
  const entries = [
    { title: 'A', printedPage: 1, level: 1 as const },
    { title: 'B', printedPage: 3, level: 2 as const },
  ]

  it('converts printed pages using the body start index', () => {
    const chapters = entriesToChapters(entries, pageIds, 1)
    expect(chapters.map((c) => [c.title, c.pageId, c.level])).toEqual([
      ['A', 'p1', 1],
      ['B', 'p3', 2],
    ])
    expect(new Set(chapters.map((c) => c.id)).size).toBe(2)
  })

  it('clamps out-of-range pages to the first and last page', () => {
    const chapters = entriesToChapters([{ title: 'Z', printedPage: 99, level: 1 }], pageIds, 1)
    expect(chapters[0].pageId).toBe('p4')
    const early = entriesToChapters(entries, pageIds, -5)
    expect(early[0].pageId).toBe('p0')
  })

  it('returns nothing when there are no pages', () => {
    expect(entriesToChapters(entries, [], 0)).toEqual([])
  })
})

describe('defaultBodyStartIndex', () => {
  const pageIds = ['p0', 'p1', 'p2', 'p3']
  it('is the page after the last toc page', () => {
    expect(defaultBodyStartIndex(pageIds, ['p1', 'p0'])).toBe(2)
  })
  it('clamps to the last page and falls back to 0 without toc pages', () => {
    expect(defaultBodyStartIndex(pageIds, ['p3'])).toBe(3)
    expect(defaultBodyStartIndex(pageIds, [])).toBe(0)
  })
})

describe('parseToc', () => {
  it('reads the toc pages in book order and converts to chapters', () => {
    const pageIds = ['t1', 't2', 'b1', 'b2', 'b3']
    const results = {
      t2: result('t2', ['第2章 手法 ..... 2']),
      t1: result('t1', ['目次', '第1章 はじめに ..... 1']),
    }
    const chapters = parseToc(['t2', 't1'], results, pageIds, 2)
    expect(chapters.map((c) => [c.title, c.pageId])).toEqual([
      ['第1章 はじめに', 'b1'],
      ['第2章 手法', 'b2'],
    ])
  })

  it('skips toc pages that have no OCR result', () => {
    expect(parseToc(['t1'], {}, ['t1', 'b1'], 1)).toEqual([])
  })
})

describe('parseTocEntries on transcribed real-looking layouts', () => {
  it('extracts chapter and section entries with page numbers on separate lines (02_nested_sections)', () => {
    const entries = parseTocEntries([
      'Contents',
      '第1章 序論',
      '1',
      '1.1 研究背景',
      '2',
      '1.2 問題設定',
      '5',
      '第2章 関連研究',
      '9',
      '2.1 統計的手法',
      '10',
    ])
    expect(entries.map((e) => [e.title, e.printedPage, e.level])).toEqual([
      ['第1章 序論', 1, 1],
      ['1.1 研究背景', 2, 2],
      ['1.2 問題設定', 5, 2],
      ['第2章 関連研究', 9, 1],
      ['2.1 統計的手法', 10, 2],
    ])
  })

  it('skips symbol-only rule lines between a title and its page number', () => {
    expect(parseTocEntries(['習慣と継続の「仕組み化」', '|', '|', '62'])).toEqual([
      { title: '習慣と継続の「仕組み化」', printedPage: 62, level: 1 },
    ])
    expect(parseTocEntries(['第3章 結果と考察', '……', '48'])).toEqual([
      { title: '第3章 結果と考察', printedPage: 48, level: 1 },
    ])
  })

  it('extracts every entry from an interleaved two-column list (03_two_column)', () => {
    const entries = parseTocEntries(['1. 概要 3', '7. 学習 41', '2. 環境構築 6', '8. 評価 50'])
    expect(entries.map((e) => [e.title, e.printedPage])).toEqual([
      ['1. 概要', 3],
      ['7. 学習', 41],
      ['2. 環境構築', 6],
      ['8. 評価', 50],
    ])
  })
})

// src/test/toc_images/ の実際の目次ページ画像を書き起こしたOCR結果から、
// parseToc()(OCR結果 → 章候補 → 画像ページへのマッピング)を通しで検証する。
// 目次ページは画像1枚目、本文は2枚目から始まる想定(bodyStartIndex=1)。
describe('parseToc on transcribed real-looking layouts', () => {
  // 印刷ページ番号Pに対応する画像index(1始まりの本文が2枚目=index1から始まる)。
  function bodyPageIds(maxPrintedPage: number): string[] {
    return ['toc', ...Array.from({ length: maxPrintedPage }, (_, i) => `b${i + 1}`)]
  }

  it('01_simple_dots: 長い点線リーダーの一覧を章に変換する', () => {
    const pageIds = bodyPageIds(101)
    const results = {
      toc: result('toc', [
        '目次',
        '第1章　はじめに………………………………………………1',
        '第2章　先行研究のレビュー…………………………………9',
        '第3章　提案手法………………………………………………23',
        '第4章　実験設定と評価指標……………………………… 47',
        '第5章　実験結果と考察 ……………………………… 61',
        '第6章　結論と今後の課題……………………………… 88',
        '付録A　実験パラメータ一覧…………………………… 95',
        '付録B　追加の実験結果 ………………………… 101',
      ]),
    }
    const chapters = parseToc(['toc'], results, pageIds, 1)
    expect(chapters.map((c) => [c.title, c.pageId, c.level])).toEqual([
      ['第1章 はじめに', 'b1', 1],
      ['第2章 先行研究のレビュー', 'b9', 1],
      ['第3章 提案手法', 'b23', 1],
      ['第4章 実験設定と評価指標', 'b47', 1],
      ['第5章 実験結果と考察', 'b61', 1],
      ['第6章 結論と今後の課題', 'b88', 1],
      ['付録A 実験パラメータ一覧', 'b95', 1],
      ['付録B 追加の実験結果', 'b101', 1],
    ])
  })

  it('02_nested_sections: リーダーなし・節の入れ子を章に変換する', () => {
    const pageIds = bodyPageIds(40)
    const results = {
      toc: result('toc', [
        'Contents',
        '第1章 序論',
        '1',
        '1.1 研究背景',
        '2',
        '1.2 問題設定',
        '5',
        '1.3 本論文の構成',
        '7',
        '第2章 関連研究',
        '9',
        '2.1 統計的手法',
        '10',
        '2.2 機械学習的手法',
        '15',
        '2.3 本研究の位置づけ',
        '20',
        '第3章 提案手法',
        '23',
        '3.1 モデルの概要',
        '24',
        '3.2 損失関数の設計',
        '29',
        '3.3 最適化アルゴリズム',
        '34',
        '3.4 実装上の工夫',
        '40',
      ]),
    }
    const chapters = parseToc(['toc'], results, pageIds, 1)
    expect(chapters.map((c) => [c.title, c.pageId, c.level])).toEqual([
      ['第1章 序論', 'b1', 1],
      ['1.1 研究背景', 'b2', 2],
      ['1.2 問題設定', 'b5', 2],
      ['1.3 本論文の構成', 'b7', 2],
      ['第2章 関連研究', 'b9', 1],
      ['2.1 統計的手法', 'b10', 2],
      ['2.2 機械学習的手法', 'b15', 2],
      ['2.3 本研究の位置づけ', 'b20', 2],
      ['第3章 提案手法', 'b23', 1],
      ['3.1 モデルの概要', 'b24', 2],
      ['3.2 損失関数の設計', 'b29', 2],
      ['3.3 最適化アルゴリズム', 'b34', 2],
      ['3.4 実装上の工夫', 'b40', 2],
    ])
  })

  it('03_two_column: 2段組(行の読み順が左右交互)を章に変換する', () => {
    const pageIds = bodyPageIds(83)
    const results = {
      toc: result('toc', [
        '目次',
        '1. 概要 3',
        '7. 学習 41',
        '2. 環境構築 6',
        '8. 評価 50',
        '3. データ収集 11',
        '9. デプロイ 58',
        '4. 前処理 18',
        '10. 監視と運用 66',
        '5. 特徴量設計 25',
        '11. トラブルシューティング 74',
        '6. モデル選定 33',
        '12. まとめ 83',
      ]),
    }
    const chapters = parseToc(['toc'], results, pageIds, 1)
    // 2段組は読み順が行ごとに左右交互(1,7,2,8,...)になりうるが、最終的な章の並びは
    // 開始ページ順(sortChapters)で整えるのはUI側(ChaptersStep)の責務であり、
    // parseToc自体はOCRの読み順のまま返す。
    expect(chapters.map((c) => [c.title, c.pageId])).toEqual([
      ['1. 概要', 'b3'],
      ['7. 学習', 'b41'],
      ['2. 環境構築', 'b6'],
      ['8. 評価', 'b50'],
      ['3. データ収集', 'b11'],
      ['9. デプロイ', 'b58'],
      ['4. 前処理', 'b18'],
      ['10. 監視と運用', 'b66'],
      ['5. 特徴量設計', 'b25'],
      ['11. トラブルシューティング', 'b74'],
      ['6. モデル選定', 'b33'],
      ['12. まとめ', 'b83'],
    ])
  })

  it('04_scan_degraded: 劣化スキャン風の点線リーダーを章に変換する', () => {
    const pageIds = bodyPageIds(55)
    const results = {
      toc: result('toc', [
        '目次',
        '第1章　序論 ‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥ 1',
        '第2章　理論的背景 ‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥ 7',
        '第3章　手法 ‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥ 19',
        '第4章　評価実験 ‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥ 38',
        '第5章　結論 ‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥ 55',
      ]),
    }
    const chapters = parseToc(['toc'], results, pageIds, 1)
    expect(chapters.map((c) => [c.title, c.pageId])).toEqual([
      ['第1章 序論', 'b1'],
      ['第2章 理論的背景', 'b7'],
      ['第3章 手法', 'b19'],
      ['第4章 評価実験', 'b38'],
      ['第5章 結論', 'b55'],
    ])
  })

  it('05_mixed_numerals: ローマ数字の前付けを除外し、漢数字の章見出しを変換する', () => {
    const pageIds = bodyPageIds(60)
    const results = {
      toc: result('toc', [
        '目次',
        'はしがき',
        'i',
        '凡例',
        'iii',
        '第一章　総説',
        '1',
        '第二章　資料と方法',
        '12',
        '第三章　結果',
        '29',
        '第四章　考察',
        '44',
        '第五章　結語',
        '60',
      ]),
    }
    const chapters = parseToc(['toc'], results, pageIds, 1)
    // はしがき(i)・凡例(iii)はローマ数字ページなので候補から除外される
    // (前付けのページ番号は本文の画像へ換算できないため)。
    expect(chapters.map((c) => [c.title, c.pageId])).toEqual([
      ['第一章 総説', 'b1'],
      ['第二章 資料と方法', 'b12'],
      ['第三章 結果', 'b29'],
      ['第四章 考察', 'b44'],
      ['第五章 結語', 'b60'],
    ])
  })

  it('06_vertical_writing: 縦書きの漢数字ページ番号(桁ごとの並び)を変換する', () => {
    const pageIds = bodyPageIds(89)
    const results = {
      toc: result('toc', [
        '目次',
        '第一章　発端',
        '一',
        '第二章　邂逅',
        '二一',
        '第三章　暗転',
        '四七',
        '第四章　結末',
        '八九',
      ]),
    }
    const chapters = parseToc(['toc'], results, pageIds, 1)
    expect(chapters.map((c) => [c.title, c.pageId])).toEqual([
      ['第一章 発端', 'b1'],
      ['第二章 邂逅', 'b21'],
      ['第三章 暗転', 'b47'],
      ['第四章 結末', 'b89'],
    ])
  })

  it('08_vertical_multi_chapter_toc: 縦書き複数章を変換する(節はインデントのみで番号がなく、字下げを使わない現在の階層判定ではlevel 1になる)', () => {
    const pageIds = bodyPageIds(95)
    const results = {
      toc: result('toc', [
        '目次',
        '第1章　始まりの条件',
        '15',
        '小さく始めて検証する',
        '19',
        '失敗を前提にした設計',
        '24',
        'チームの合意形成',
        '29',
        '第2章　成長を支える仕組み',
        '41',
        '採用基準の見直し',
        '45',
        '評価制度の透明化',
        '52',
        '「任せる」ことの難しさ',
        '58',
        '情報共有の速度を上げる',
        '63',
        '第3章　壁を越える判断',
        '77',
        '撤退基準をあらかじめ決めておく',
        '80',
        '数字よりも先に人を見る',
        '88',
        '長期と短期の綱引き',
        '95',
      ]),
    }
    const chapters = parseToc(['toc'], results, pageIds, 1)
    expect(chapters.map((c) => [c.title, c.pageId, c.level])).toEqual([
      ['第1章 始まりの条件', 'b15', 1],
      ['小さく始めて検証する', 'b19', 1],
      ['失敗を前提にした設計', 'b24', 1],
      ['チームの合意形成', 'b29', 1],
      ['第2章 成長を支える仕組み', 'b41', 1],
      ['採用基準の見直し', 'b45', 1],
      ['評価制度の透明化', 'b52', 1],
      ['「任せる」ことの難しさ', 'b58', 1],
      ['情報共有の速度を上げる', 'b63', 1],
      ['第3章 壁を越える判断', 'b77', 1],
      ['撤退基準をあらかじめ決めておく', 'b80', 1],
      ['数字よりも先に人を見る', 'b88', 1],
      ['長期と短期の綱引き', 'b95', 1],
    ])
  })

  it('09_fontsize_contrast_chapter_preview: 縦書き・章ごとに要約文付きの目次から章名とページ番号を取り出す', () => {
    const pageIds = bodyPageIds(84)
    // 読み順は右列→左列。「第」「5」「章」は大きさの違う別々の行、章名の列の下に
    // 短い罫線(「|」)とページ番号が続き、その後に副題と要約文の列が並ぶ。
    const results = {
      toc: result('toc', [
        '第',
        '5',
        '章',
        '習慣と継続の「仕組み化」',
        '|',
        '|',
        '62',
        '——成果を出す人が徹底していること',
        '一流の人は当たり前のことを徹底している/と思ってしまう/自分',
        'が普通だと思っていることが/実は特別だという事実に/気づいて',
        'いないだけかもしれない/継続できる人とできない人の違いは/才',
        '能ではなく仕組みにある/モチベーションに頼らず/自動的に体が',
        '動く状態を作れるかが/分かれ目になる/小さな習慣を積み重ねる',
        'ことでしか/大きな変化は起こらない/今日 少しだけ昨日より前',
        '進する/それだけでいい/完璧を求めすぎると続けることが苦しく',
        'なる/六割の出来でも続けることを優先する',
        '第',
        '6',
        '章',
        '選択と集中の「優先順位」',
        '|',
        '|',
        '84',
        '——限られた時間で最大の成果を出す方法',
        '選ぶことは同時に/何かを捨てることでもある/すべてを手に入れ',
        'ようとする人ほど/結局は何も残らない/優先順位をつけられない',
        'のは/判断基準を持っていないからだ/重要度と緊急度を分けて考',
        'える/それだけで景色が変わる/限られた時間の中で/最大の成果',
        'を出す人に共通するのは/「やらないこと」を先に決めている点だ',
        '/忙しさは成果の証ではない/むしろ優先順位のなさの表れである',
      ]),
    }
    const chapters = parseToc(['toc'], results, pageIds, 1)
    // 章番号の「5」は単独の数字行なので、断片の「第」とは結び付かずページ番号扱いにもならない
    // (章名に「第5章」は付かない)。副題・要約文は番号が続かないので章にならない。
    expect(chapters.map((c) => [c.title, c.pageId, c.level])).toEqual([
      ['習慣と継続の「仕組み化」', 'b62', 1],
      ['選択と集中の「優先順位」', 'b84', 1],
    ])
  })
})
