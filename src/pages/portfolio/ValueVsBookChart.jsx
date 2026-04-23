import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { barWidth } from './helpers'

function GradientBar({ label, value, max, from, to }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-text-muted">{label}</span>
        <span className="font-mono text-sm tabular font-semibold text-text-primary">{fmtCurrency(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-brand-light">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: barWidth(value, max), background: `linear-gradient(90deg, ${from}, ${to})` }}
        />
      </div>
    </div>
  )
}

export default function ValueVsBookChart({ stats }) {
  const max = Math.max(stats.totalMarketValue, stats.totalBookValue, stats.totalCashValue, 1)

  return (
    <ChartPanel title="Value vs Book" meta={fmtCurrency(stats.totalPnl)}>
      <div className="space-y-5">
        <GradientBar label="Portfolio value" value={stats.totalMarketValue} max={max} from="#1c1c1c90" to="#1c1c1c" />
        <GradientBar label="Book value" value={stats.totalBookValue} max={max} from="#a1a1aa90" to="#71717a" />
        <GradientBar label="Cash reserve" value={stats.totalCashValue} max={max} from="#0d948890" to="#0f766e" />
      </div>
      <div className="mt-5 rounded-lg border border-border bg-brand-light px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-text-muted">Total P&L</span>
          <span className={`font-mono text-sm tabular font-bold ${stats.totalPnl >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtCurrency(stats.totalPnl)}</span>
        </div>
      </div>
    </ChartPanel>
  )
}
