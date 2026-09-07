import { useEffect, useState } from 'react'
import { useBook } from './hooks/useBook'
import { ImportPanel } from './components/ImportPanel'
import { PageList } from './components/PageList'
import { AdjustmentEditor } from './components/AdjustmentEditor'
import { MetadataForm } from './components/MetadataForm'
import { ExportPanel } from './components/ExportPanel'
import { DEFAULT_ADJUSTMENT } from './types'

const STEPS = ['読み込み', '並べ替え・調整', '詳細＆書き出し'] as const

export function App() {
  const book = useBook()
  const selectedPage = book.pages.find((p) => p.id === book.selectedPageId)
  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)

  function goTo(next: number) {
    setStep(next)
    setMaxStep((current) => Math.max(current, next))
  }

  // 「並べ替え・調整」工程に入ったとき、まだ何も選ばれていなければ1ページ目を選ぶ。
  useEffect(() => {
    if (step !== 1) return
    if (selectedPage) return
    const first = book.pages[0]
    if (first) void book.selectPage(first.id)
  }, [step, selectedPage, book.pages, book.selectPage])

  return (
    <div className="app-shell">
      <h1>ebook-maker</h1>
      {book.error && (
        <div role="alert" data-testid="error-banner" className="error-banner">
          <span>{book.error}</span>
          <button type="button" onClick={book.clearError}>
            閉じる
          </button>
        </div>
      )}

      <div className="wizard">
        <nav className="rail">
          <div className="rail__title">新規ブック</div>
          <div className="rail__steps">
            {STEPS.map((label, index) => {
              const isActive = index === step
              const isReachable = index <= maxStep
              return (
                <div
                  key={label}
                  className={
                    isActive
                      ? 'step step--active'
                      : isReachable
                        ? 'step step--done'
                        : 'step step--disabled'
                  }
                  onClick={() => isReachable && goTo(index)}
                >
                  <span className="stepnum">{index + 1}</span>
                  <span>{label}</span>
                </div>
              )
            })}
          </div>
        </nav>

        <div className="step-content">
          {step === 0 && (
            <>
              <ImportPanel
                onImport={book.importFiles}
                pageCount={book.pages.length}
                onClearAll={book.clearAllPages}
                importProgress={book.importProgress}
              />
              <div className="nav-actions nav-actions--end">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={book.pages.length === 0}
                  onClick={() => goTo(1)}
                >
                  次へ
                </button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="page-adjust-layout">
                <div className="page-adjust-layout__list">
                  <PageList
                    pages={book.pages}
                    thumbnails={book.thumbnails}
                    selectedPageId={book.selectedPageId}
                    selectedImage={book.selectedImage}
                    onSelect={book.selectPage}
                    onReorder={book.reorderPages}
                    onDelete={book.deletePage}
                    onConfirmMerge={book.confirmMerge}
                  />
                </div>
                <div className="page-adjust-layout__preview">
                  {selectedPage &&
                    (book.selectedImage ? (
                      <AdjustmentEditor
                        image={book.selectedImage}
                        adjustment={selectedPage.adjustment ?? DEFAULT_ADJUSTMENT}
                        onAdjustmentChange={(params) => book.updateAdjustment(selectedPage.id, params)}
                        onApplyToAllPages={() => book.applyAdjustmentToAllPages(selectedPage.id)}
                        onAutoAdjustPage={() => book.autoAdjustPage(selectedPage.id)}
                        onAutoAdjustAllPages={() => book.autoAdjustAllPages()}
                      />
                    ) : (
                      // 画素の準備が整うまでの繋ぎ。ここでエディタごと消すと、ページを
                      // 切り替えるたびにパネルが一瞬消えて壊れて見える。
                      <div className="panel" data-testid="preview-loading">
                        プレビューを準備中...
                      </div>
                    ))}
                </div>
              </div>
              <div className="nav-actions nav-actions--between">
                <button type="button" className="btn btn-ghost" onClick={() => goTo(0)}>
                  戻る
                </button>
                <button type="button" className="btn btn-primary" onClick={() => goTo(2)}>
                  詳細情報へ進む
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <MetadataForm metadata={book.metadata} onChange={book.setMetadata} />
              <ExportPanel onExport={book.exportBook} title={book.metadata.title} />
              <div className="nav-actions nav-actions--start">
                <button type="button" className="btn btn-ghost" onClick={() => goTo(1)}>
                  ページ編集へ戻る
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
