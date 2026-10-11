import type { BookMetadata } from '../types'

interface MetadataFormProps {
  metadata: BookMetadata
  onChange: (metadata: BookMetadata) => void
}

export function MetadataForm({ metadata, onChange }: MetadataFormProps) {
  return (
    <div className="panel metadata-form__fields">
      <h3 className="panel__title">書誌情報</h3>
      <label className="field">
        <span className="field__label">タイトル</span>
        <input
          type="text"
          data-testid="title-input"
          value={metadata.title}
          onChange={(event) => onChange({ ...metadata, title: event.target.value })}
        />
      </label>
      <label className="field">
        <span className="field__label">著者</span>
        <input
          type="text"
          data-testid="author-input"
          value={metadata.author}
          onChange={(event) => onChange({ ...metadata, author: event.target.value })}
        />
      </label>
    </div>
  )
}
