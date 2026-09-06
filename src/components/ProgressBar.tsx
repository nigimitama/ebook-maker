interface ProgressBarProps {
  done: number
  total: number
  label: string
  testId: string
}

export function ProgressBar({ done, total, label, testId }: ProgressBarProps) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="progress-bar" data-testid={testId}>
      <p className="progress-bar__label">
        {label} ({done}/{total})
      </p>
      <div className="progress-bar__track">
        <div className="progress-bar__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
