import type { AdjustmentParams, BookMetadata, PageEntry } from '../types'

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
}

export interface AutomationApi {
  getState: () => AutomationState
  goToStep: (step: number) => void
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
    getState: '() => AutomationState — 現在の状態(工程・ページ一覧・選択中ページ・メタデータ・エラー等)をJSONで返す。',
    goToStep: '(step: number) => void — 工程(0:読み込み, 1:並べ替え・調整, 2:詳細＆書き出し)を切り替える。',
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
