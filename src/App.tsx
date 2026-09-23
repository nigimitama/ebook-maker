import { useEffect, useMemo, useState } from 'react'
import { useBook } from './hooks/useBook'
import { useOcr } from './hooks/useOcr'
import { ImportPanel } from './components/ImportPanel'
import { PageList } from './components/PageList'
import { AdjustmentEditor } from './components/AdjustmentEditor'
import { OcrReview } from './components/OcrReview'
import { useChapters } from './hooks/useChapters'
import { ChaptersStep } from './components/ChaptersStep'
import { TitleStep } from './components/TitleStep'
import { MetadataForm } from './components/MetadataForm'
import { detectTocPages } from './lib/toc/detectTocPages'
import { defaultBodyStartIndex, parseToc } from './lib/toc/parseToc'
import { ExportPanel } from './components/ExportPanel'
import { DEFAULT_ADJUSTMENT } from './types'
import { installAutomationApi, toAutomationPageSummary } from './lib/automationApi'

const STEPS = ['読み込み', '並べ替え・調整', 'OCR確認・修正', 'タイトルの設定', '目次の作成', '詳細＆書き出し'] as const
const EXPORT_STEP = STEPS.length - 1

export function App() {
  const book = useBook()
  const selectedPage = book.pages.find((p) => p.id === book.selectedPageId)
  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)
  // 実際に開いた工程。スキップで飛び越えた工程は、選べても「済」には見せない。
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([0]))
  // 書き出し工程の「戻る」の行き先。スキップで来たなら、飛ばした工程ではなく来た工程へ戻す。
  const [exportBackStep, setExportBackStep] = useState(4)
  // ページが削除・結合・取り消しされたら保存済みのOCR結果を読み直させる。
  // 配列そのものを渡すと毎描画で別参照になるため、IDの並びで memo する。
  const pageIds = useMemo(() => book.pages.map((p) => p.id), [book.pages])
  const ocr = useOcr(book.getStore, { pageIds })
  const chapters = useChapters(book.getStore, { pageIds })

  const error = book.error ?? chapters.error

  function goTo(next: number) {
    if (next === EXPORT_STEP && step !== EXPORT_STEP) setExportBackStep(step)
    setStep(next)
    setMaxStep((current) => Math.max(current, next))
    setVisited((current) => (current.has(next) ? current : new Set(current).add(next)))
  }

  // 「並べ替え・調整」「OCR確認・修正」工程に入ったとき、まだ何も選ばれていなければ
  // 1ページ目を選ぶ。どちらの画面も選択中ページの画素(selectedImage)を描画する。
  useEffect(() => {
    if (step !== 1 && step !== 2) return
    if (selectedPage) return
    const first = book.pages[0]
    if (first) void book.selectPage(first.id)
  }, [step, selectedPage, book.pages, book.selectPage])

  // Claude Code等の外部エージェントがブラウザ越しにアプリを操作できるよう、
  // window.EbookMaker としてAPIを公開する(詳細: window.EbookMaker.describe())。
  useEffect(() => {
    installAutomationApi({
      getState: () => ({
        step,
        maxStep,
        pages: book.pages.map(toAutomationPageSummary),
        selectedPageId: book.selectedPageId,
        metadata: book.metadata,
        error: book.error,
        importProgress: book.importProgress,
        canUndoClearAll: book.canUndoClearAll,
        ocr: {
          running: ocr.running,
          progress: ocr.progress,
          concurrency: ocr.concurrency,
          maxConcurrency: ocr.maxConcurrency,
        },
        chapters: chapters.chapters,
      }),
      goToStep: goTo,
      getChapters: () => chapters.chapters,
      setChapters: chapters.setChapters,
      detectTocPages: () => detectTocPages(pageIds, ocr.results),
      parseToc: (tocPageIds, bodyStartPageId) => {
        if (bodyStartPageId && !pageIds.includes(bodyStartPageId)) {
          throw new Error(`bodyStartPageId が見つかりません: ${bodyStartPageId}`)
        }
        const bodyStart = bodyStartPageId
          ? pageIds.indexOf(bodyStartPageId)
          : defaultBodyStartIndex(pageIds, tocPageIds)
        return parseToc(tocPageIds, ocr.results, pageIds, bodyStart)
      },
      runOcr: ocr.runOne,
      runOcrAll: (opts) => ocr.runAll(pageIds, opts),
      getOcr: (pageId) => ocr.results[pageId],
      getOcrConcurrency: () => ({ value: ocr.concurrency, max: ocr.maxConcurrency }),
      setOcrConcurrency: ocr.setConcurrency,
      setOcrLineText: ocr.updateLine,
      importFiles: book.importFiles,
      selectPage: book.selectPage,
      updateAdjustment: book.updateAdjustment,
      applyResizeToAllPages: book.applyResizeToAllPages,
      applyQualityToAllPages: book.applyQualityToAllPages,
      applyToneToAllPages: book.applyToneToAllPages,
      autoAdjustAllPages: book.autoAdjustAllPages,
      reorderPages: book.reorderPages,
      deletePage: book.deletePage,
      clearAllPages: book.clearAllPages,
      undoClearAll: book.undoClearAll,
      confirmMerge: book.confirmMerge,
      setMetadata: book.setMetadata,
      exportBook: book.exportBook,
      clearError: book.clearError,
    })
  })

  return (
    <div className="app-shell">
      <h1>ebook-maker</h1>
      {error && (
        <div role="alert" data-testid="error-banner" className="error-banner">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              book.clearError()
              chapters.clearError()
            }}
          >
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
                      : !isReachable
                        ? 'step step--disabled'
                        : visited.has(index)
                          ? 'step step--done'
                          : 'step step--skipped'
                  }
                  onClick={() => isReachable && goTo(index)}
                >
                  <span className="stepnum">{index + 1}</span>
                  <span>{label}</span>
                </div>
              )
            })}
          </div>
          <div className="rail__nav">
            {step === 0 && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={book.pages.length === 0}
                onClick={() => goTo(1)}
              >
                次へ
              </button>
            )}
            {step === 1 && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => goTo(2)}>
                  OCRへ進む
                </button>
                {/* OCRは任意工程。使わない人がここで詰まらないよう、書き出しへ直行できる。 */}
                <button type="button" className="btn btn-ghost" onClick={() => goTo(5)}>
                  OCRをスキップして書き出しへ
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => goTo(0)}>
                  戻る
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => goTo(3)}>
                  タイトルの設定へ進む
                </button>
                {/* タイトル・目次の設定も任意工程(タイトルは書き出し工程でも入力できる)。
                    既存の章立ては消さずに書き出しへ進む。 */}
                <button type="button" className="btn btn-ghost" onClick={() => goTo(5)}>
                  タイトル・目次の設定をスキップして書き出しへ
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => goTo(1)}>
                  戻る
                </button>
              </>
            )}
            {step === 3 && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => goTo(4)}>
                  目次の作成へ進む
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => goTo(2)}>
                  戻る
                </button>
              </>
            )}
            {step === 4 && (
              <>
                <button type="button" className="btn btn-primary" onClick={() => goTo(5)}>
                  詳細情報へ進む
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => goTo(3)}>
                  戻る
                </button>
              </>
            )}
            {step === 5 && (
              <button type="button" className="btn btn-ghost" onClick={() => goTo(exportBackStep)}>
                {STEPS[exportBackStep]}へ戻る
              </button>
            )}
          </div>
        </nav>

        <div className="step-content">
          {step === 0 && (
            <>
              <ImportPanel
                onImport={book.importFiles}
                pageCount={book.pages.length}
                onClearAll={book.clearAllPages}
                canUndoClearAll={book.canUndoClearAll}
                onUndoClearAll={book.undoClearAll}
                importProgress={book.importProgress}
              />
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
                        onApplyResizeToAllPages={() => book.applyResizeToAllPages(selectedPage.id)}
                        onApplyQualityToAllPages={() => book.applyQualityToAllPages(selectedPage.id)}
                        onApplyToneToAllPages={() => book.applyToneToAllPages(selectedPage.id)}
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
            </>
          )}

          {step === 2 && (
            <OcrReview
              pages={book.pages}
              thumbnails={book.thumbnails}
              selectedPageId={book.selectedPageId}
              selectedImage={book.selectedImage}
              onSelect={book.selectPage}
              ocr={ocr}
              title={book.metadata.title}
            />
          )}

          {step === 3 && (
            <TitleStep
              coverPage={book.pages[0]}
              thumbnail={book.pages[0] ? book.thumbnails[book.pages[0].id] : undefined}
              ocrResult={book.pages[0] ? ocr.results[book.pages[0].id] : undefined}
              ocrRunning={ocr.running}
              onRunOcr={() => {
                const cover = book.pages[0]
                if (cover) void ocr.runOne(cover.id)
              }}
              metadata={book.metadata}
              onChange={book.setMetadata}
              getPagePreview={book.getPagePreview}
            />
          )}

          {step === 4 && (
            <ChaptersStep
              pages={book.pages}
              thumbnails={book.thumbnails}
              ocrResults={ocr.results}
              ocrRunning={ocr.running}
              onRunOcr={(ids) => void ocr.runAll(ids, { skipDone: true })}
              chapters={chapters.chapters}
              onChange={(next) => chapters.setChapters(next).catch(() => {})}
              getPagePreview={book.getPagePreview}
              onUpdateOcrLine={(pageId, lineId, text) => void ocr.updateLine(pageId, lineId, text)}
              onDeleteOcrLine={(pageId, lineId) => void ocr.deleteLine(pageId, lineId)}
              onMoveOcrLine={(pageId, lineId, toIndex) => void ocr.moveLine(pageId, lineId, toIndex)}
            />
          )}

          {step === 5 && (
            <>
              <MetadataForm metadata={book.metadata} onChange={book.setMetadata} />
              <ExportPanel
                onExport={book.exportBook}
                title={book.metadata.title}
                chapterCount={chapters.chapters.length}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
