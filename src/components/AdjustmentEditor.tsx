import { useEffect, useRef } from 'react'
import { applyAdjustment } from '../lib/applyAdjustment'
import { DEFAULT_JPEG_QUALITY, DEFAULT_RESIZE_HEIGHT, DEFAULT_RESIZE_WIDTH } from '../types'
import type { AdjustmentParams, RawImage, ResizeMode } from '../types'

interface AdjustmentEditorProps {
  image: RawImage
  adjustment: AdjustmentParams
  onAdjustmentChange: (params: AdjustmentParams) => void
  onApplyToAllPages: () => void
  onAutoAdjustPage: () => void
  onAutoAdjustAllPages: () => void
}

export function AdjustmentEditor({
  image,
  adjustment,
  onAdjustmentChange,
  onApplyToAllPages,
  onAutoAdjustPage,
  onAutoAdjustAllPages,
}: AdjustmentEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const resizeMode = adjustment.resizeMode ?? 'none'
  const resizeWidth = adjustment.resizeWidth ?? DEFAULT_RESIZE_WIDTH
  const resizeHeight = adjustment.resizeHeight ?? DEFAULT_RESIZE_HEIGHT
  const quality = adjustment.quality ?? DEFAULT_JPEG_QUALITY

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const preview = applyAdjustment(image, adjustment)
    canvas.width = preview.width
    canvas.height = preview.height
    const imageData = new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height)
    ctx.putImageData(imageData, 0, 0)
  }, [image, adjustment])

  function setResizeMode(mode: ResizeMode) {
    onAdjustmentChange({ ...adjustment, resizeMode: mode, resizeWidth, resizeHeight })
  }

  return (
    <div className="panel">
      <canvas
        ref={canvasRef}
        data-testid="adjustment-canvas"
        className="adjustment-editor__canvas"
      />
      <div className="adjustment-editor__controls">
        <fieldset className="adjustment-editor__tone">
          <legend>明るさ・コントラスト</legend>
          <label>
            明るさ
            <input
              type="range"
              min={-100}
              max={100}
              value={adjustment.brightness}
              data-testid="brightness-slider"
              onChange={(event) =>
                onAdjustmentChange({ ...adjustment, brightness: Number(event.target.value) })
              }
            />
            <span data-testid="brightness-value">{adjustment.brightness}</span>
          </label>
          <label>
            コントラスト
            <input
              type="range"
              min={-100}
              max={100}
              value={adjustment.contrast}
              data-testid="contrast-slider"
              onChange={(event) =>
                onAdjustmentChange({ ...adjustment, contrast: Number(event.target.value) })
              }
            />
            <span data-testid="contrast-value">{adjustment.contrast}</span>
          </label>
          <div className="adjustment-editor__auto">
            <button type="button" data-testid="auto-adjust-page" onClick={onAutoAdjustPage}>
              このページを自動補正
            </button>
            <button type="button" data-testid="auto-adjust-all" onClick={onAutoAdjustAllPages}>
              全ページを自動補正
            </button>
          </div>
        </fieldset>
        <label>
          画質(JPEG品質)
          <input
            type="range"
            min={1}
            max={100}
            value={quality}
            data-testid="quality-slider"
            onChange={(event) =>
              onAdjustmentChange({ ...adjustment, quality: Number(event.target.value) })
            }
          />
          <span data-testid="quality-value">{quality}</span>
        </label>

        <fieldset className="adjustment-editor__resize">
          <legend>リサイズ</legend>
          <label>
            <input
              type="radio"
              name="resize-mode"
              checked={resizeMode === 'none'}
              data-testid="resize-mode-none"
              onChange={() => setResizeMode('none')}
            />
            リサイズしない
          </label>
          <label>
            <input
              type="radio"
              name="resize-mode"
              checked={resizeMode === 'width'}
              data-testid="resize-mode-width"
              onChange={() => setResizeMode('width')}
            />
            横幅を揃える
            <input
              type="number"
              min={1}
              value={resizeWidth}
              disabled={resizeMode !== 'width'}
              data-testid="resize-width-input"
              onChange={(event) =>
                onAdjustmentChange({ ...adjustment, resizeWidth: Number(event.target.value) })
              }
            />
            px
          </label>
          <label>
            <input
              type="radio"
              name="resize-mode"
              checked={resizeMode === 'height'}
              data-testid="resize-mode-height"
              onChange={() => setResizeMode('height')}
            />
            縦幅を揃える
            <input
              type="number"
              min={1}
              value={resizeHeight}
              disabled={resizeMode !== 'height'}
              data-testid="resize-height-input"
              onChange={(event) =>
                onAdjustmentChange({ ...adjustment, resizeHeight: Number(event.target.value) })
              }
            />
            px
          </label>
          <button type="button" onClick={onApplyToAllPages}>
            リサイズ・画質を他のページにも適用
          </button>
        </fieldset>
      </div>
    </div>
  )
}
