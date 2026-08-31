import { ChartSpot } from '../../components/illustrations'

export default function EmptyState({ onUploadClick }) {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-card border border-white/[0.06] bg-wall-surface px-6 py-16 text-center">
      <div className="glow-orb absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2" />
      <div className="relative animate-fade-in">
        <ChartSpot />
      </div>
      <p className="relative mt-4 text-base font-semibold text-white">No portfolio loaded</p>
      <p className="relative mx-auto mt-2 max-w-sm text-xs leading-relaxed text-white/40">
        Upload a CSV, Excel, or PDF from any broker to populate the dashboard.
      </p>
      <button
        type="button"
        onClick={onUploadClick}
        className="relative mt-6 rounded-full bg-gradient-accent px-6 py-2.5 text-sm font-semibold text-brand shadow-glow-sm transition-all duration-ws ease-ws hover:shadow-glow"
      >
        Upload a file
      </button>
    </div>
  )
}

export function EmptyChart() {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.06]">
      <ChartSpot size={64} />
      <p className="text-sm text-white/40">No data available</p>
    </div>
  )
}
