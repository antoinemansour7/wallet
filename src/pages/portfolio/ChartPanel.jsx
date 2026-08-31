export default function ChartPanel({ title, meta, children, large = false }) {
  return (
    <section className={`rounded-card border border-white/[0.08] bg-wall-surface p-5 shadow-card sm:p-6 ${large ? 'min-h-[380px]' : ''}`}>
      <div className="mb-6 flex items-start justify-between gap-3">
        <h2 className="text-[13px] font-semibold tracking-tight text-white/90">{title}</h2>
        {meta && <span className="font-mono text-[11px] tabular text-white/35">{meta}</span>}
      </div>
      {children}
    </section>
  )
}
