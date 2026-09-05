export default function ChartPanel({ title, meta, children, large = false, className = '' }) {
  return (
    <section className={`chart-panel rounded-card border border-ink/10 bg-wall-surface p-5 shadow-card sm:p-6 ${large ? 'min-h-[380px]' : ''} ${className}`}>
      <div className="chart-panel-header mb-6 flex items-start justify-between gap-3">
        <h2 className="text-[13px] font-semibold tracking-tight text-ink/90">{title}</h2>
        {meta && <span className="font-mono text-[11px] tabular text-ink/55">{meta}</span>}
      </div>
      {children}
    </section>
  )
}
