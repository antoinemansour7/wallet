function resolveTone({ tone, pnl }) {
  if (tone) return tone
  if (pnl > 0) return 'positive'
  if (pnl < 0) return 'negative'
  return 'neutral'
}

function cardToneClasses(tone) {
  switch (tone) {
    case 'positive':
      return {
        borderTop: 'bg-gain',
        value: 'text-gain',
        badge: 'border-gain/20 bg-gain-bg text-gain',
        detail: 'border-gain/20 bg-gain-bg',
        detailText: 'text-gain',
      }
    case 'negative':
      return {
        borderTop: 'bg-loss',
        value: 'text-loss',
        badge: 'border-loss/20 bg-loss-bg text-loss',
        detail: 'border-loss/20 bg-loss-bg',
        detailText: 'text-loss',
      }
    case 'accent':
      return {
        borderTop: 'bg-brand',
        value: 'text-brand',
        badge: 'border-border bg-brand-light text-text-secondary',
        detail: 'border-border bg-brand-light',
        detailText: 'text-text-primary',
      }
    default:
      return {
        borderTop: 'bg-border',
        value: 'text-text-primary',
        badge: 'border-border bg-brand-light text-text-muted',
        detail: 'border-border bg-brand-light',
        detailText: 'text-text-secondary',
      }
  }
}

export default function StatCard({ label, value, sub, pnl = 0, tone, badge, breakdown = [] }) {
  const resolvedTone = resolveTone({ tone, pnl })
  const classes      = cardToneClasses(resolvedTone)

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card transition-all duration-200 hover:shadow-card-hover">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${classes.borderTop}`} />
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">{label}</p>
        {badge && (
          <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold tabular ${classes.badge}`}>
            {badge}
          </span>
        )}
      </div>
      <p className={`font-mono text-[26px] font-bold tabular leading-none tracking-tight ${value ? classes.value : 'text-text-muted'}`}>
        {value ?? '—'}
      </p>
      {sub && (
        <p className="mt-2.5 text-xs leading-relaxed text-text-muted">
          {sub}
        </p>
      )}
      {breakdown.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {breakdown.map((item) => {
            const itemTone = resolveTone({ tone: item.tone, pnl: item.pnl ?? 0 })
            const itemClasses = cardToneClasses(itemTone)
            return (
              <div key={item.label} className={`rounded-lg border px-3 py-2 ${itemClasses.detail}`}>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">{item.label}</span>
                <p className={`mt-1 font-mono text-xs font-semibold tabular ${itemClasses.detailText}`}>{item.value}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
