import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { barWidth } from './helpers'

function ValueBar({ label, value, max, tone = 'muted' }) {
  const fill = tone === 'accent' ? 'bg-accent' : tone === 'cash' ? 'bg-ink/30' : 'bg-ink/50'
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-white/55">{label}</span>
        <span className="font-mono text-[13px] font-semibold tabular text-white">{fmtCurrency(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.09]">
        <div className={`h-full rounded-full transition-all duration-700 ${fill}`} style={{ width: barWidth(value, max) }} />
      </div>
    </div>
  )
}

export default function ValueVsBookChart({ stats }) {
  // The market value led this card and also sits in the middle of the donut a
  // few hundred pixels away — the same figure twice on one screen. The gain is
  // the thing this card alone answers, so it leads instead, and the three bars
  // below share one scale so the comparison is the point rather than decoration.
  const max = Math.max(stats.totalMarketValue, stats.totalBookValue, stats.totalCashValue, 1)
  const pnl = stats.totalPnl
  const pct = stats.totalBookValue > 0 ? (pnl / stats.totalBookValue) * 100 : 0

  return (
    <ChartPanel title="Value vs. cost" meta="Today" className="h-full">
      <div className="mb-6">
        <p className={`font-display text-[30px] font-medium leading-none tracking-tight tabular ${pnl >= 0 ? 'text-gain' : 'text-loss'}`}>
          {pnl >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(pnl))}
        </p>
        <p className="mt-2 text-[13px] text-white/50">
          {pnl >= 0 ? 'more' : 'less'} than you paid · {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <ValueBar label="Worth today" value={stats.totalMarketValue} max={max} tone="accent" />
        <ValueBar label="What you paid" value={stats.totalBookValue} max={max} />
        <ValueBar label="Cash" value={stats.totalCashValue} max={max} tone="cash" />
      </div>
    </ChartPanel>
  )
}
