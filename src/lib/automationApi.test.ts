import { describe, it, expect, afterEach, vi } from 'vitest'
import { installAutomationApi, type AutomationApi } from './automationApi'

function fakeApi(overrides: Partial<Omit<AutomationApi, 'describe'>> = {}): Omit<AutomationApi, 'describe'> {
  return {
    getState: vi.fn(() => ({
      step: 0,
      maxStep: 0,
      pages: [],
      selectedPageId: null,
      metadata: { title: '', author: '' },
      error: null,
      importProgress: null,
      canUndoClearAll: false,
      ocr: { running: false, progress: null },
    })),
    goToStep: vi.fn(),
    runOcr: vi.fn(),
    runOcrAll: vi.fn(),
    getOcr: vi.fn(),
    setOcrLineText: vi.fn(),
    importFiles: vi.fn(),
    selectPage: vi.fn(),
    updateAdjustment: vi.fn(),
    applyResizeToAllPages: vi.fn(),
    applyQualityToAllPages: vi.fn(),
    applyToneToAllPages: vi.fn(),
    autoAdjustAllPages: vi.fn(),
    reorderPages: vi.fn(),
    deletePage: vi.fn(),
    clearAllPages: vi.fn(),
    undoClearAll: vi.fn(),
    confirmMerge: vi.fn(),
    setMetadata: vi.fn(),
    exportBook: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  delete window.EbookMaker
})

describe('installAutomationApi', () => {
  it('exposes the given operations on window.EbookMaker', () => {
    const api = fakeApi()

    installAutomationApi(api)

    expect(window.EbookMaker?.getState()).toEqual(api.getState())
    window.EbookMaker?.selectPage('p1')
    expect(api.selectPage).toHaveBeenCalledWith('p1')
  })

  it('describes every operation it exposes, keeping documentation in sync with the API', () => {
    installAutomationApi(fakeApi())

    const description = window.EbookMaker?.describe()
    const documentedMethods = Object.keys(description?.methods ?? {}).sort()
    const exposedMethods = Object.keys(fakeApi()).sort()

    expect(documentedMethods).toEqual(exposedMethods)
  })

  // 外部エージェントは describe() だけを見て操作するので、工程番号がずれたままだと
  // 書き出し工程に行けない。OCR工程を含む0〜3を説明に載せる。
  it('documents the OCR step in goToStep and the OCR operations', () => {
    installAutomationApi(fakeApi())

    const methods = window.EbookMaker!.describe().methods
    expect(methods.goToStep).toContain('2:OCR確認・修正')
    expect(methods.goToStep).toContain('3:詳細＆書き出し')
    for (const name of ['runOcr', 'runOcrAll', 'getOcr', 'setOcrLineText'] as const) {
      expect(methods[name]).toBeTruthy()
    }
  })
})
