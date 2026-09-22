import { describe, it, expect } from 'vitest'
import type { OcrResult } from '../ocr/types'
import { detectTocPages, tocScanWindow } from './detectTocPages'

function result(pageId: string, texts: string[]): OcrResult {
  return {
    pageId,
    modelVersion: 't',
    updatedAt: 1,
    lines: texts.map((text, i) => ({ id: `${pageId}-${i}`, x: 0, y: i, w: 1, h: 1, text, edited: false })),
  }
}

const tocLines = [
  '目次',
  '第1章 はじめに ........ 3',
  '第2章 背景 ........ 15',
  '第3章 手法 ........ 31',
  '第4章 結果 ........ 52',
  '第5章 議論 ........ 70',
]
const proseLines = [
  'これは本文の段落です。',
  '吾輩は猫である。名前はまだ無い。',
  'どこで生れたかとんと見当がつかぬ。',
  '何でも薄暗いじめじめした所で泣いていた。',
  '12',
]

describe('tocScanWindow', () => {
  it('is 30% of the pages, capped at 40', () => {
    expect(tocScanWindow(10)).toBe(3)
    expect(tocScanWindow(100)).toBe(30)
    expect(tocScanWindow(500)).toBe(40)
  })
})

describe('detectTocPages', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `p${i}`)

  it('finds a single toc page among prose pages', () => {
    const results = {
      p0: result('p0', proseLines),
      p1: result('p1', tocLines),
      p2: result('p2', proseLines),
    }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p1'])
  })

  it('groups a toc spanning several pages, including a short last page', () => {
    const results = {
      p0: result('p0', tocLines),
      p1: result('p1', tocLines.slice(1)),
      p2: result('p2', ['付録 ........ 90', '索引 ........ 95', '奥付 ........ 99']),
      p3: result('p3', proseLines),
    }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p0', 'p1', 'p2'])
  })

  it('detects a toc page without the heading keyword', () => {
    const results = { p1: result('p1', tocLines.slice(1)) }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p1'])
  })

  it('returns nothing for a book without a toc', () => {
    const results = { p0: result('p0', proseLines), p1: result('p1', proseLines) }
    expect(detectTocPages(ids, results).pageIds).toEqual([])
  })

  it('ignores toc-like pages beyond the scan window', () => {
    const results = { p5: result('p5', tocLines) }
    expect(detectTocPages(ids, results).pageIds).toEqual([])
  })

  it('reports pages inside the window that have no OCR result yet', () => {
    const results = { p0: result('p0', proseLines) }
    expect(detectTocPages(ids, results).unscannedPageIds).toEqual(['p1', 'p2'])
  })

  it('returns only the first block', () => {
    const results = {
      p0: result('p0', tocLines),
      p1: result('p1', proseLines),
      p2: result('p2', tocLines),
    }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p0'])
  })
})

// src/test/toc_images/ の実際の目次ページ画像を書き起こしたOCR行(想定)。
// レイアウト検出・文字認識モデル自体は対象外(このテストは lib/toc の
// テキストベースの判定ロジックだけを検証する)。
describe('detectTocPages with real-looking toc layouts', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `p${i}`)

  // 01_simple_dots.png: 縦一列、章タイトルと点線リーダー、末尾に算用数字。
  it('detects a page with a long dotted leader per entry', () => {
    const lines = [
      '目次',
      '第1章　はじめに………………………………………………1',
      '第2章　先行研究のレビュー…………………………………9',
      '第3章　提案手法………………………………………………23',
      '第4章　実験設定と評価指標……………………………… 47',
      '第5章　実験結果と考察 ……………………………… 61',
      '第6章　結論と今後の課題……………………………… 88',
      '付録A　実験パラメータ一覧…………………………… 95',
      '付録B　追加の実験結果 ………………………… 101',
    ]
    const results = { p1: result('p1', lines) }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p1'])
  })

  // 02_nested_sections.png: リーダーなし、章(太字・大きい数字)と
  // 1.1/1.2のような節が入れ子。章のページ番号と節のページ番号が
  // 別行になっている(右揃えのレイアウトのため)。
  it('detects a leader-less page with nested numbered sections', () => {
    const lines = [
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
    ]
    const results = { p2: result('p2', lines) }
    const detection = detectTocPages(ids, results)
    expect(detection.pageIds).toEqual(['p2'])
  })

  // 03_two_column.png: 2段組。読み順は列ごとと限らず、行ごとに
  // 左右が交互に来ることもある(OCRの読み順検出はlib/ocr側の責務)。
  it('detects a two-column numbered list regardless of row interleaving', () => {
    const lines = [
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
    ]
    const results = { p1: result('p1', lines) }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p1'])
  })

  // 04_scan_degraded.png: 劣化スキャン風。内容自体は01と同型なので、
  // このテストはOCRの読み取り精度低下時でも文字さえ拾えれば判定できることの確認。
  it('detects a degraded-scan page with the same dotted-leader shape', () => {
    const lines = [
      '目次',
      '第1章　序論 ‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥ 1',
      '第2章　理論的背景 ‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥ 7',
      '第3章　手法 ‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥ 19',
      '第4章　評価実験 ‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥ 38',
      '第5章　結論 ‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥‥ 55',
    ]
    const results = { p0: result('p0', lines) }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p0'])
  })

  // 05_mixed_numerals.png: 前付け(はしがき・凡例)はローマ数字ページなので
  // 候補から除外されつつ、漢数字の章見出し("第一章"等)は通常どおり検出できる。
  it('detects a page mixing roman-numeral front matter and kanji chapter numerals', () => {
    const lines = [
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
    ]
    const results = { p1: result('p1', lines) }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p1'])
  })

  // 08_vertical_multi_chapter_toc.png: 縦書き・複数章・章と節が入れ子。
  // 読み順はlib/ocr側が右列→左列の順に並べる想定で、ここではその並びを
  // そのままOCR行として与える。
  it('detects a vertical multi-chapter toc with nested sections', () => {
    const lines = [
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
    ]
    const results = { p0: result('p0', lines) }
    expect(detectTocPages(ids, results).pageIds).toEqual(['p0'])
  })
})
