import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { applyAdjustment } from '../lib/applyAdjustment'
import type { AdjustmentParams, RawImage } from '../types'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 10

// ホイール/ボタンで拡大縮小、ドラッグで移動、ダブルクリックでリセットできる表示枠。
export function ZoomPane({ children }: { children: ReactNode }) {
  const paneRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)

  // (cx, cy) はペイン中心からの相対座標。その点を固定したまま倍率を変える。
  function zoomAt(factor: number, cx: number, cy: number) {
    setView((v) => {
      const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale * factor))
      const ratio = scale / v.scale
      return { scale, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio }
    })
  }

  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    // preventDefaultするため passive:false のネイティブリスナーで受ける。
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = pane.getBoundingClientRect()
      zoomAt(
        Math.exp(-event.deltaY * 0.002),
        event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2,
      )
    }
    pane.addEventListener('wheel', onWheel, { passive: false })
    return () => pane.removeEventListener('wheel', onWheel)
  }, [])

  const reset = () => setView({ scale: 1, x: 0, y: 0 })

  return (
    <>
      <div
        ref={paneRef}
        className="zoom-pane"
        data-testid="zoom-pane"
        onDoubleClick={reset}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { px: event.clientX, py: event.clientY, x: view.x, y: view.y }
        }}
        onPointerMove={(event) => {
          const d = drag.current
          if (!d) return
          setView((v) => ({ ...v, x: d.x + event.clientX - d.px, y: d.y + event.clientY - d.py }))
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <div
          className="zoom-pane__content"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {children}
        </div>
      </div>
      <div className="zoom-pane__controls">
        <button type="button" className="btn-ghost" onClick={() => zoomAt(1 / 1.5, 0, 0)} aria-label="縮小">
          −
        </button>
        <span>{Math.round(view.scale * 100)}%</span>
        <button type="button" className="btn-ghost" onClick={() => zoomAt(1.5, 0, 0)} aria-label="拡大">
          ＋
        </button>
        <button type="button" className="btn-ghost" onClick={reset}>
          リセット
        </button>
      </div>
    </>
  )
}

export interface AdjustedPreviewProps {
  image: RawImage
  adjustment: AdjustmentParams
}

// 拡大表示は原本の画素に実際の調整(明るさ・コントラスト・リサイズ)を
// 適用した結果を見せる。書き出し結果に一番近いプレビューにするため。
export function AdjustedPreview({ image, adjustment }: AdjustedPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  // 画素演算は重いので、モーダルと「loading...」を先に描画してから遅延実行する。
  useEffect(() => {
    setReady(false)
    const timer = setTimeout(() => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      const preview = applyAdjustment(image, adjustment)
      canvas.width = preview.width
      canvas.height = preview.height
      const imageData = new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height)
      ctx.putImageData(imageData, 0, 0)
      setReady(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [image, adjustment])

  return (
    <>
      {!ready && <div className="thumb-modal__loading">loading...</div>}
      <canvas
        ref={canvasRef}
        data-testid="thumb-modal-canvas"
        className="thumb-modal__canvas"
        style={ready ? undefined : { display: 'none' }}
      />
    </>
  )
}

export interface ZoomModalProps {
  /** ダイアログのaria-label(ファイル名など)。 */
  label: string
  onClose: () => void
  children: ReactNode
  /** 画像の右側に並べる追加パネル(目次の作成ステップのOCR結果表示などに使う)。 */
  sidePanel?: ReactNode
}

// ページの拡大表示に使う共通モーダル。Escapeキー・オーバーレイクリック・
// 閉じるボタンのいずれでも閉じる。中身(ZoomPane)は拡大縮小・ドラッグに対応する。
// sidePanelを渡すと、画像の右側に並べて表示する。
export function ZoomModal({ label, onClose, children, sidePanel }: ZoomModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="thumb-modal" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div
        className={`thumb-modal__frame${sidePanel ? ' thumb-modal__frame--with-side-panel' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="thumb-modal__body">
          <div className="thumb-modal__image-pane">
            <ZoomPane>{children}</ZoomPane>
          </div>
          {sidePanel && <div className="thumb-modal__side-panel">{sidePanel}</div>}
        </div>
        <button type="button" className="thumb-modal__close" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}
