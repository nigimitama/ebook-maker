import type { OcrLine } from '../lib/ocr/types'
import { buildParagraphs } from '../lib/paragraphs'

export interface OcrParagraphListProps {
  lines: OcrLine[]
}

// OCR結果を段落単位(同じブロックの行を読み順に連結したもの)で表示する、
// 読み取り専用のプレビュー。行ごとの修正はOcrLineList(行ごと表示)で行う。
export function OcrParagraphList({ lines }: OcrParagraphListProps) {
  const paragraphs = buildParagraphs(lines)
  if (paragraphs.length === 0) {
    return <p className="ocr-review__empty">このページはまだOCRされていません。</p>
  }
  return (
    <div className="ocr-paragraphs">
      {paragraphs.map((p) => (
        <p key={p.id} className="ocr-paragraphs__item">
          {p.text}
        </p>
      ))}
    </div>
  )
}
