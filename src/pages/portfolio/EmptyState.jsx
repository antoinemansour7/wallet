import UploadIcon from './UploadIcon'

export default function EmptyState({ onUploadClick }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/[0.06] px-6 py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-white/[0.06] bg-wall-surface">
        <UploadIcon />
      </div>
      <p className="text-base font-semibold text-white">No portfolio loaded</p>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-white/40">
        Upload a CSV, Excel, or PDF from any broker to populate the dashboard.
      </p>
      <button
        type="button"
        onClick={onUploadClick}
        className="mt-5 rounded-full border border-white/10 bg-white/10 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-white/[0.15]"
      >
        Upload a file
      </button>
    </div>
  )
}

export function EmptyChart() {
  return (
    <div className="flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-white/[0.06]">
      <p className="text-sm text-white/40">No data available</p>
    </div>
  )
}
