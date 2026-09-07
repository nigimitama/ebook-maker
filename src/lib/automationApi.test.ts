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
    })),
    goToStep: vi.fn(),
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
})
