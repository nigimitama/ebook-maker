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
        onApplyResizeToAllPages={vi.fn()}
        onApplyQualityToAllPages={vi.fn()}
        onApplyToneToAllPages={vi.fn()}
        onAutoAdjustAllPages={vi.fn()}
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
        onApplyResizeToAllPages={vi.fn()}
        onApplyQualityToAllPages={vi.fn()}
        onApplyToneToAllPages={vi.fn()}
        onAutoAdjustAllPages={vi.fn()}
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
        onApplyResizeToAllPages={vi.fn()}
        onApplyQualityToAllPages={vi.fn()}
        onApplyToneToAllPages={vi.fn()}
        onAutoAdjustAllPages={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByTestId('contrast-slider'), { target: { value: '-40' } })
    expect(onAdjustmentChange).toHaveBeenCalledWith({ brightness: 10, contrast: -40 })
  })

  it('calls onApplyResizeToAllPages when the resize apply-to-all button is clicked', () => {
    const onApplyResizeToAllPages = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 0 }}
        onAdjustmentChange={vi.fn()}
        onApplyResizeToAllPages={onApplyResizeToAllPages}
        onApplyQualityToAllPages={vi.fn()}
        onApplyToneToAllPages={vi.fn()}
        onAutoAdjustAllPages={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('リサイズを他のページにも適用'))
    expect(onApplyResizeToAllPages).toHaveBeenCalled()
  })

  it('calls onApplyQualityToAllPages when the quality apply-to-all button is clicked', () => {
    const onApplyQualityToAllPages = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 0 }}
        onAdjustmentChange={vi.fn()}
        onApplyResizeToAllPages={vi.fn()}
        onApplyQualityToAllPages={onApplyQualityToAllPages}
        onApplyToneToAllPages={vi.fn()}
        onAutoAdjustAllPages={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('画質を他のページにも適用'))
    expect(onApplyQualityToAllPages).toHaveBeenCalled()
  })

  it('calls onApplyToneToAllPages when the tone apply-to-all button is clicked', () => {
    const onApplyToneToAllPages = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 0 }}
        onAdjustmentChange={vi.fn()}
        onApplyResizeToAllPages={vi.fn()}
        onApplyQualityToAllPages={vi.fn()}
        onApplyToneToAllPages={onApplyToneToAllPages}
        onAutoAdjustAllPages={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('他のページにも適用'))
    expect(onApplyToneToAllPages).toHaveBeenCalled()
  })

  it('calls onAutoAdjustAllPages when the all-pages auto-adjust button is clicked', () => {
    const onAutoAdjustAllPages = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 0 }}
        onAdjustmentChange={vi.fn()}
        onApplyResizeToAllPages={vi.fn()}
        onApplyQualityToAllPages={vi.fn()}
        onApplyToneToAllPages={vi.fn()}
        onAutoAdjustAllPages={onAutoAdjustAllPages}
      />,
    )
    fireEvent.click(screen.getByTestId('auto-adjust-all'))
    expect(onAutoAdjustAllPages).toHaveBeenCalled()
  })

  it('defaults to no resize and a JPEG quality of 75 when unset', () => {
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 0 }}
        onAdjustmentChange={vi.fn()}
        onApplyResizeToAllPages={vi.fn()}
        onApplyQualityToAllPages={vi.fn()}
        onApplyToneToAllPages={vi.fn()}
        onAutoAdjustAllPages={vi.fn()}
      />,
    )
    expect(screen.getByTestId('resize-mode-none')).toBeChecked()
    expect(screen.getByTestId('resize-width-input')).toBeDisabled()
    expect(screen.getByTestId('resize-height-input')).toBeDisabled()
    expect(screen.getByTestId('quality-slider')).toHaveValue('75')
  })

  it('enables the width input and reports width mode when its radio is selected', () => {
    const onAdjustmentChange = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 0 }}
        onAdjustmentChange={onAdjustmentChange}
        onApplyResizeToAllPages={vi.fn()}
        onApplyQualityToAllPages={vi.fn()}
        onApplyToneToAllPages={vi.fn()}
        onAutoAdjustAllPages={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('resize-mode-width'))
    expect(onAdjustmentChange).toHaveBeenCalledWith(
      expect.objectContaining({ resizeMode: 'width', resizeWidth: 1080, resizeHeight: 1920 }),
    )
  })

  it('updates resizeHeight when the height mode is active and its input changes', () => {
    const onAdjustmentChange = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 0, resizeMode: 'height', resizeHeight: 1920 }}
        onAdjustmentChange={onAdjustmentChange}
        onApplyResizeToAllPages={vi.fn()}
        onApplyQualityToAllPages={vi.fn()}
        onApplyToneToAllPages={vi.fn()}
        onAutoAdjustAllPages={vi.fn()}
      />,
    )
    expect(screen.getByTestId('resize-mode-height')).toBeChecked()
    fireEvent.change(screen.getByTestId('resize-height-input'), { target: { value: '2000' } })
    expect(onAdjustmentChange).toHaveBeenCalledWith(
      expect.objectContaining({ resizeMode: 'height', resizeHeight: 2000 }),
    )
  })

  it('calls onAdjustmentChange with an updated quality', () => {
    const onAdjustmentChange = vi.fn()
    render(
      <AdjustmentEditor
        image={image()}
        adjustment={{ brightness: 0, contrast: 0 }}
        onAdjustmentChange={onAdjustmentChange}
        onApplyResizeToAllPages={vi.fn()}
        onApplyQualityToAllPages={vi.fn()}
        onApplyToneToAllPages={vi.fn()}
        onAutoAdjustAllPages={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByTestId('quality-slider'), { target: { value: '40' } })
    expect(onAdjustmentChange).toHaveBeenCalledWith(
      expect.objectContaining({ brightness: 0, contrast: 0, quality: 40 }),
    )
  })
})
