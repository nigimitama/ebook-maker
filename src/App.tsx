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
    <div>
      <h1>ebook-maker</h1>
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
          {book.selectedImage && selectedPage && (
            <AdjustmentEditor
              image={book.selectedImage}
              adjustment={selectedPage.adjustment ?? DEFAULT_ADJUSTMENT}
              onAdjustmentChange={(params) => book.updateAdjustment(selectedPage.id, params)}
              onApplyToAllPages={() => book.applyAdjustmentToAllPages(selectedPage.id)}
            />
          )}
          <MetadataForm metadata={book.metadata} onChange={book.setMetadata} />
          <ExportPanel onExport={book.exportBook} />
        </>
      )}
    </div>
  )
}
