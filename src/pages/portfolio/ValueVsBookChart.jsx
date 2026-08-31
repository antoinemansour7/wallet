import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { barWidth } from './helpers'

function ValueBar({ label, value, max, muted = false }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm text-white/55">{label}</span>
        <span className="font-mono text-sm font-semibold tabular text-white">{fmtCurrency(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
        <div className={`h-full rounded-full transition-all duration-700 ${muted ? 'bg-white/25' : 'bg-accent'}`} style={{ width: barWidth(value, max) }} />
      </div>
    </div>
  )
}

export default function ValueVsBookChart({ stats }) {
  const max = Math.max(stats.totalMarketValue, stats.totalBookValue, stats.totalCashValue, 1)
  const pnl = stats.totalPnl
  return (
    <ChartPanel title="Portfolio value" meta="Today">
      <div className="mb-7">
        <p className="font-display text-3xl font-medium tracking-tight tabular text-white">{fmtCurrency(stats.totalMarketValue)}</p>
        <p className={`mt-2 text-sm ${pnl >= 0 ? 'text-gain' : 'text-loss'}`}>
          {fmtCurrency(Math.abs(pnl))} {pnl >= 0 ? 'above' : 'below'} amount invested
        </p>
      </div>
      <div className="flex flex-col gap-5">
        <ValueBar label="Amount invested" value={stats.totalBookValue} max={max} muted />
        <ValueBar label="Cash" value={stats.totalCashValue} max={max} muted />
      </div>
    </ChartPanel>
  )
}
