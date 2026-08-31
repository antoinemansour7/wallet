export default function ChartPanel({ title, meta, children, large = false }) {
  return (
    <section className={`rounded-card border border-white/[0.06] bg-wall-surface p-5 transition-all duration-ws ease-ws hover:-translate-y-0.5 hover:border-white/[0.12] hover:shadow-card-hover ${large ? 'min-h-[380px]' : ''}`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {meta && (
          <span className="rounded-full border border-white/[0.06] bg-white/[0.04] px-2.5 py-0.5 font-mono text-[10px] tabular text-white/40">
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}
