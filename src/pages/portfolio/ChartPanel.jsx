export default function ChartPanel({ title, meta, children, large = false }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-5 shadow-card ${large ? 'min-h-[380px]' : ''}`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        {meta && (
          <span className="rounded-full border border-border bg-brand-light px-2.5 py-0.5 font-mono text-[10px] tabular text-text-muted">
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}
