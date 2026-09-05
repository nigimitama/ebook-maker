import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AdjustmentEditor } from './AdjustmentEditor'
import type { RawImage } from '../types'

function image(): RawImage {
  return { data: new Uint8ClampedArray(16).fill(100), width: 2, height: 2 }
}

describe('AdjustmentEditor', () => {
  it('renders sliders reflecting the current adjustment values', () => {
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 15, contrast: -20 }}
        onAdjustmentChange={vi.fn()}
        onApplyToAllPages={vi.fn()}
      />,
    )
    expect(screen.getByTestId('brightness-slider')).toHaveValue('15')
    expect(screen.getByTestId('contrast-slider')).toHaveValue('-20')
  })

  it('calls onAdjustmentChange with an updated brightness, keeping contrast unchanged', () => {
    const onAdjustmentChange = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 5 }}
        onAdjustmentChange={onAdjustmentChange}
        onApplyToAllPages={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByTestId('brightness-slider'), { target: { value: '30' } })
    expect(onAdjustmentChange).toHaveBeenCalledWith({ brightness: 30, contrast: 5 })
  })

  it('calls onAdjustmentChange with an updated contrast, keeping brightness unchanged', () => {
    const onAdjustmentChange = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 10, contrast: 0 }}
        onAdjustmentChange={onAdjustmentChange}
        onApplyToAllPages={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByTestId('contrast-slider'), { target: { value: '-40' } })
    expect(onAdjustmentChange).toHaveBeenCalledWith({ brightness: 10, contrast: -40 })
  })

  it('calls onApplyToAllPages when the apply-to-all button is clicked', () => {
    const onApplyToAllPages = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 0 }}
        onAdjustmentChange={vi.fn()}
        onApplyToAllPages={onApplyToAllPages}
      />,
    )
    fireEvent.click(screen.getByText('他のページにも適用'))
    expect(onApplyToAllPages).toHaveBeenCalled()
  })
})
