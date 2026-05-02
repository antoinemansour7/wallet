import { fmtCurrency, parseNum } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { EmptyChart } from './EmptyState'
import { pct, barWidth, getTopPositions } from './helpers'
import { CHART_GRADIENTS } from './constants'

export default function TopPositionsChart({ rows, large = false }) {
  const items = getTopPositions(rows, large ? 10 : 6)
  const max   = Math.max(...items.map((i) => i.value), 0)
  const total = rows.reduce((s, r) => s + parseNum(r['MARKET VALUE']), 0)

  return (
    <ChartPanel title="Top Positions" meta={`${items.length} shown`} large={large}>
      {items.length === 0 ? <EmptyChart /> : (
        <div className="space-y-4">
          {items.map((item, index) => {
            const [c0, c1] = CHART_GRADIENTS[index % CHART_GRADIENTS.length]
            const isPositive = item.pnl >= 0
            return (
              <div key={`${item.symbol}-${item.index}`}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-bold text-white">{item.symbol}</p>
                    {item.description && <p className="truncate text-[11px] text-white/40">{item.description}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm tabular font-semibold text-white">{fmtCurrency(item.value)}</p>
                    <p className={`font-mono text-[11px] tabular ${isPositive ? 'text-gain' : 'text-loss'}`}>{fmtCurrency(item.pnl)}</p>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: barWidth(item.value, max), background: `linear-gradient(90deg, ${c0}90, ${c1})` }}
                  />
                </div>
                <p className="mt-1 font-mono text-[10px] tabular text-white/40">{pct(item.value, total).toFixed(1)}% of portfolio</p>
              </div>
            )
          })}
        </div>
      )}
    </ChartPanel>
  )
}
