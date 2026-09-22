import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OcrParagraphList } from './OcrParagraphList'
import type { OcrLine } from '../lib/ocr/types'

function line(id: string, text: string, blockId?: string): OcrLine {
  return { id, x: 0, y: 0, w: 1, h: 1, text, edited: false, ...(blockId ? { blockId } : {}) }
}

describe('OcrParagraphList', () => {
  it('同じブロックの行を1つの段落として表示する', () => {
    render(
      <OcrParagraphList
        lines={[line('a', '吾輩は猫である。名前はまだ', 'b1'), line('b', '無い。', 'b1')]}
      />,
    )
    expect(screen.getByText('吾輩は猫である。名前はまだ無い。')).toBeInTheDocument()
  })

  it('ブロックが無い行はそれぞれ別の段落として表示する', () => {
    render(<OcrParagraphList lines={[line('a', '一行目'), line('b', '二行目')]} />)
    expect(screen.getByText('一行目')).toBeInTheDocument()
    expect(screen.getByText('二行目')).toBeInTheDocument()
  })

  it('行が無ければ未OCRの案内を出す', () => {
    render(<OcrParagraphList lines={[]} />)
    expect(screen.getByText('このページはまだOCRされていません。')).toBeInTheDocument()
  })
})
