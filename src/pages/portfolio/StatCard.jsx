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
        badge: 'border-gain/20 bg-gain/10 text-gain',
        detail: 'border-gain/20 bg-gain/10',
        detailText: 'text-gain',
      }
    case 'negative':
      return {
        borderTop: 'bg-loss',
        value: 'text-loss',
        badge: 'border-loss/20 bg-loss/10 text-loss',
        detail: 'border-loss/20 bg-loss/10',
        detailText: 'text-loss',
      }
    case 'accent':
      return {
        borderTop: 'bg-[#494fdf]',
        value: 'text-[#494fdf]',
        badge: 'border-white/[0.06] bg-white/[0.04] text-white/60',
        detail: 'border-white/[0.06] bg-white/[0.04]',
        detailText: 'text-white',
      }
    default:
      return {
        borderTop: 'bg-white/10',
        value: 'text-white',
        badge: 'border-white/[0.06] bg-white/[0.04] text-white/40',
        detail: 'border-white/[0.06] bg-white/[0.04]',
        detailText: 'text-white/60',
      }
  }
}

export default function StatCard({ label, value, sub, pnl = 0, tone, badge, breakdown = [], action }) {
  const resolvedTone = resolveTone({ tone, pnl })
  const classes      = cardToneClasses(resolvedTone)

  return (
    <div className="relative overflow-hidden rounded-card border border-white/[0.06] bg-wall-surface p-4 transition-all duration-200 hover:border-white/[0.12] sm:p-5">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${classes.borderTop}`} />
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">{label}</p>
        {badge && (
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tabular sm:px-2.5 sm:py-1 ${classes.badge}`}>
            {badge}
          </span>
        )}
      </div>
      <p className={`font-mono text-[20px] font-bold tabular leading-none tracking-tight sm:text-[26px] ${value ? classes.value : 'text-white/40'}`}>
        {value ?? '—'}
      </p>
      {sub && (
        <p className="mt-2.5 text-xs leading-relaxed text-white/40">
          {sub}
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
      {breakdown.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {breakdown.map((item) => {
            const itemTone = resolveTone({ tone: item.tone, pnl: item.pnl ?? 0 })
            const itemClasses = cardToneClasses(itemTone)
            return (
              <div key={item.label} className={`rounded-lg border px-3 py-2 ${itemClasses.detail}`}>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{item.label}</span>
                <p className={`mt-1 font-mono text-xs font-semibold tabular ${itemClasses.detailText}`}>{item.value}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
