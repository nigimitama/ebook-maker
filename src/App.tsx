import { useBook } from './hooks/useBook'
import { ImportPanel } from './components/ImportPanel'
import { PageList } from './components/PageList'
import { AdjustmentEditor } from './components/AdjustmentEditor'
import { MetadataForm } from './components/MetadataForm'
import { ExportPanel } from './components/ExportPanel'
import { DEFAULT_ADJUSTMENT } from './types'

export function App() {
  const book = useBook()
  const selectedPage = book.pages.find((p) => p.id === book.selectedPageId)

  return (
    <div className="app">
      <h1>ebook-maker</h1>
      {book.error && (
        <div role="alert" data-testid="error-banner" className="error-banner">
          <span>{book.error}</span>
          <button type="button" onClick={book.clearError}>
            閉じる
          </button>
        </div>
      )}
      <ImportPanel onImport={book.importFiles} />
      {book.pages.length > 0 && (
        <>
          <PageList
            pages={book.pages}
            thumbnails={book.thumbnails}
            selectedPageId={book.selectedPageId}
            onSelect={book.selectPage}
            onReorder={book.reorderPages}
            onDelete={book.deletePage}
            onConfirmMerge={book.confirmMerge}
          />
          {selectedPage &&
            (book.selectedImage ? (
              <AdjustmentEditor
                image={book.selectedImage}
                adjustment={selectedPage.adjustment ?? DEFAULT_ADJUSTMENT}
                onAdjustmentChange={(params) => book.updateAdjustment(selectedPage.id, params)}
                onApplyToAllPages={() => book.applyAdjustmentToAllPages(selectedPage.id)}
              />
            ) : (
              // 画素の準備が整うまでの繋ぎ。ここでエディタごと消すと、ページを
              // 切り替えるたびにパネルが一瞬消えて壊れて見える。
              <div className="panel" data-testid="preview-loading">
                プレビューを準備中...
              </div>
            ))}
          <MetadataForm metadata={book.metadata} onChange={book.setMetadata} />
          <ExportPanel onExport={book.exportBook} />
        </>
      )}
    </div>
  )
}
