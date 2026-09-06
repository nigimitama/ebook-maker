import type { BookMetadata } from '../types'

interface MetadataFormProps {
  metadata: BookMetadata
  onChange: (metadata: BookMetadata) => void
}

export function MetadataForm({ metadata, onChange }: MetadataFormProps) {
  return (
    <div className="panel metadata-form__fields">
      <label>
        タイトル
        <input
          type="text"
          data-testid="title-input"
          value={metadata.title}
          onChange={(event) => onChange({ ...metadata, title: event.target.value })}
        />
      </label>
      <label>
        著者
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
