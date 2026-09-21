import type { RunOptions, RunSummary } from '../hooks/useOcr'
import type { OcrResult } from './ocr/types'
import type { AdjustmentParams, BookMetadata, Chapter, PageEntry } from '../types'

export interface AutomationPageSummary {
  id: string
  order: number
  fileName?: string
  width: number
  height: number
  adjustment: AdjustmentParams
}

export interface AutomationState {
  step: number
  maxStep: number
  pages: AutomationPageSummary[]
  selectedPageId: string | null
  metadata: BookMetadata
  error: string | null
  importProgress: { done: number; total: number } | null
  canUndoClearAll: boolean
  ocr: {
    running: boolean
    progress: { done: number; total: number; stage?: string } | null
  }
  chapters: Chapter[]
}

export interface AutomationApi {
  getState: () => AutomationState
  goToStep: (step: number) => void
  getChapters: () => Chapter[]
  setChapters: (chapters: Chapter[]) => Promise<void>
  detectTocPages: () => { pageIds: string[]; unscannedPageIds: string[] }
  parseToc: (tocPageIds: string[], bodyStartPageId?: string) => Chapter[]
  runOcr: (pageId: string, opts?: RunOptions) => Promise<RunSummary>
  runOcrAll: (opts?: RunOptions) => Promise<RunSummary>
  getOcr: (pageId: string) => OcrResult | undefined
  setOcrLineText: (pageId: string, lineId: string, text: string) => Promise<void>
  importFiles: (files: File[]) => Promise<void>
  selectPage: (id: string) => Promise<void>
  updateAdjustment: (id: string, adjustment: AdjustmentParams) => Promise<void>
  applyResizeToAllPages: (sourceId: string) => Promise<void>
  applyQualityToAllPages: (sourceId: string) => Promise<void>
  applyToneToAllPages: (sourceId: string) => Promise<void>
  autoAdjustAllPages: () => Promise<void>
  reorderPages: (orderedIds: string[]) => Promise<void>
  deletePage: (id: string) => Promise<void>
  clearAllPages: () => Promise<void>
  undoClearAll: () => Promise<void>
  confirmMerge: (firstId: string, secondId: string) => Promise<void>
  setMetadata: (metadata: BookMetadata) => void
  exportBook: (format: 'pdf' | 'epub') => Promise<Blob>
  clearError: () => void
  describe: () => AutomationApiDescription
}

export interface AutomationApiDescription {
  name: string
  methods: Record<Exclude<keyof AutomationApi, 'describe'>, string>
}

const API_DESCRIPTION: AutomationApiDescription = {
  name: 'ebook-maker automation API',
  methods: {
    getState: '() => AutomationState — 現在の状態(工程・ページ一覧・選択中ページ・メタデータ・エラー・OCRの実行状況等)をJSONで返す。',
    goToStep: '(step: number) => void — 工程(0:読み込み, 1:並べ替え・調整, 2:OCR確認・修正, 3:章立て, 4:詳細＆書き出し)を切り替える。OCRと章立ては任意工程で、飛ばして4に進んでもよい。',
    getChapters: '() => Chapter[] — 章立て({ id, title, pageId, level })を返す。levelは1=章, 2=節。配列順が書籍順(同一ページ内の順序も表す)。',
    setChapters: '(chapters: Chapter[]) => Promise<void> — 章立てを丸ごと置き換えて保存する。空配列で章立てなし。書き出し時、章があればPDFのしおり・EPUBの目次に埋め込まれる。',
    detectTocPages: '() => { pageIds: string[]; unscannedPageIds: string[] } — OCR結果から目次ページを自動検出する(先頭の一部のページが対象)。unscannedPageIdsは検出範囲内でOCR未実施のページ。',
    parseToc: '(tocPageIds: string[], bodyStartPageId?: string) => Chapter[] — 指定した目次ページのOCR結果から章の候補を作って返す(保存しない)。bodyStartPageIdは印刷ページ1ページ目に当たるページ(省略時は目次の最後の次)。保存はsetChaptersで行う。',
    runOcr: '(pageId: string, opts?: { skipDone?: boolean; overwriteEdited?: boolean }) => Promise<{ skippedEdited: string[] }> — 1ページに文字認識をかける。修正済みの行があるページは見送られ、skippedEditedに入る(overwriteEdited: trueで上書き)。',
    runOcrAll: '(opts?: { skipDone?: boolean; overwriteEdited?: boolean }) => Promise<{ skippedEdited: string[] }> — 全ページに文字認識をかける。進捗は getState().ocr で確認できる。',
    getOcr: '(pageId: string) => OcrResult | undefined — ページのOCR結果(行の並びが読み順)を返す。未実行ならundefined。',
    setOcrLineText: '(pageId: string, lineId: string, text: string) => Promise<void> — OCR結果の1行の文字を修正する(修正済みとして保存される)。',
    importFiles: '(files: File[]) => Promise<void> — 画像ファイルをページとして読み込む。',
    selectPage: '(id: string) => Promise<void> — 編集対象のページを選択する。',
    updateAdjustment: '(id: string, adjustment: AdjustmentParams) => Promise<void> — ページの調整値(明るさ・コントラスト・リサイズ・画質)を更新する。',
    applyResizeToAllPages: '(sourceId: string) => Promise<void> — 指定ページのリサイズ設定を全ページに複製する。',
    applyQualityToAllPages: '(sourceId: string) => Promise<void> — 指定ページの画質設定を全ページに複製する。',
    applyToneToAllPages: '(sourceId: string) => Promise<void> — 指定ページの明るさ・コントラストを全ページに複製する。',
    autoAdjustAllPages: '() => Promise<void> — 全ページに自動補正をかける。',
    reorderPages: '(orderedIds: string[]) => Promise<void> — ページの並び順を変更する。',
    deletePage: '(id: string) => Promise<void> — ページを削除する。',
    clearAllPages: '() => Promise<void> — 全ページを削除する(undoClearAllで取り消し可能)。',
    undoClearAll: '() => Promise<void> — 直前のclearAllPagesを取り消す。',
    confirmMerge: '(firstId: string, secondId: string) => Promise<void> — 2ページを見開きとして結合する。',
    setMetadata: '(metadata: BookMetadata) => void — 書籍のタイトル・著者を設定する。',
    exportBook: "(format: 'pdf' | 'epub') => Promise<Blob> — 書籍を指定形式で書き出す。",
    clearError: '() => void — 表示中のエラーを消す。',
  },
}

export function toAutomationPageSummary(page: PageEntry): AutomationPageSummary {
  return {
    id: page.id,
    order: page.order,
    fileName: page.fileName,
    width: page.width,
    height: page.height,
    adjustment: page.adjustment,
  }
}

declare global {
  interface Window {
    EbookMaker?: AutomationApi
  }
}

export function installAutomationApi(api: Omit<AutomationApi, 'describe'>): void {
  if (typeof window === 'undefined') return
  window.EbookMaker = {
    ...api,
    describe: () => API_DESCRIPTION,
  }
}
