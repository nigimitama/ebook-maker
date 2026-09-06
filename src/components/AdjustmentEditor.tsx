import { useEffect, useRef } from 'react'
import { applyAdjustment } from '../lib/applyAdjustment'
import type { AdjustmentParams, RawImage } from '../types'

interface AdjustmentEditorProps {
  image: RawImage
  adjustment: AdjustmentParams
  onAdjustmentChange: (params: AdjustmentParams) => void
  onApplyToAllPages: () => void
}

export function AdjustmentEditor({
  image,
  adjustment,
  onAdjustmentChange,
  onApplyToAllPages,
}: AdjustmentEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    canvas.width = image.width
    canvas.height = image.height
    const preview = applyAdjustment(image, adjustment)
    const imageData = new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height)
    ctx.putImageData(imageData, 0, 0)
  }, [image, adjustment])

  return (
    <div className="panel">
      <canvas
        ref={canvasRef}
        data-testid="adjustment-canvas"
        className="adjustment-editor__canvas"
      />
      <div className="adjustment-editor__controls">
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
        </label>
        <button type="button" onClick={onApplyToAllPages}>
          他のページにも適用
        </button>
      </div>
    </div>
  )
}
