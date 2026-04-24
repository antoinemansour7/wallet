import UploadIcon from './UploadIcon'

export default function EmptyState({ onUploadClick }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border px-6 py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-border bg-card">
        <UploadIcon />
      </div>
      <p className="text-base font-semibold text-text-primary">No portfolio loaded</p>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-text-muted">
        Upload a CSV, Excel, or PDF from any broker to populate the dashboard.
      </p>
      <button
        type="button"
        onClick={onUploadClick}
        className="mt-5 rounded-full border border-brand bg-brand px-6 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-85"
      >
        Upload a file
      </button>
    </div>
  )
}

export function EmptyChart() {
  return (
    <div className="flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-border-subtle">
      <p className="text-sm text-text-muted">No data available</p>
    </div>
  )
}
