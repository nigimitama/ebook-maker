import { useId, useState } from 'react'

export interface OcrSettingsProps {
  value: number
  max: number
  disabled: boolean
  /** 丸めて保存し、実際に採用した値を返す。 */
  onChange: (n: number) => number
}

// 同時に動かすOCR Workerの数。変更は次の実行から反映される。
export function OcrSettings({ value, max, disabled, onChange }: OcrSettingsProps) {
  const inputId = useId()
  // 入力途中(空欄など)を許すため、確定までは文字列で持つ。
  const [draft, setDraft] = useState(String(value))
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    setDraft(String(value))
  }

  function commit() {
    setDraft(String(onChange(Number(draft))))
  }

  return (
    <section className="ocr-settings" aria-label="OCRの設定">
      <h3 className="ocr-settings__title">OCRの設定</h3>
      <div className="ocr-settings__row">
        <label htmlFor={inputId}>同時に処理するページ数</label>
        <input
          id={inputId}
          className="ocr-settings__input"
          type="number"
          min={1}
          max={max}
          step={1}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
      </div>
      <p className="ocr-review__hint">
        この端末の上限: {max}(論理コア数−1)。増やすと速くなりますが、1つ増やすごとにメモリを多く使い、PCが重くなることがあります。
      </p>
    </section>
  )
}
