import { fmtCurrency, parseNum } from '../../utils/portfolioStats'
import CompanyLogo from '../../components/CompanyLogo'
import ChartPanel from './ChartPanel'
import { EmptyChart } from './EmptyState'
import { pct, getTopPositions } from './helpers'

export default function TopPositionsChart({ rows, large = false }) {
  const items = getTopPositions(rows, large ? 10 : 6)
  const total = rows.reduce((s, r) => s + parseNum(r['MARKET VALUE']), 0)

  return (
    <ChartPanel title="Top positions" meta={`${items.length} shown`} large={large}>
      {items.length === 0 ? <EmptyChart /> : (
        <div className="-mx-2 space-y-1">
          {items.map((item) => {
            const isPositive = item.pnl >= 0
            const share = pct(item.value, total)
            return (
              <div
                key={`${item.symbol}-${item.index}`}
                className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.03]"
              >
                <CompanyLogo symbol={item.symbol} description={item.description} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-semibold text-white">{item.symbol}</span>
                    <span className="text-[13px] font-semibold tabular text-white">{fmtCurrency(item.value)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2.5">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                      <div
                        className={`h-full rounded-full transition-all duration-motion-long ${isPositive ? 'bg-gain' : 'bg-loss'}`}
                        style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-[11px] tabular text-white/35">{share.toFixed(1)}%</span>
                    <span className={`w-16 text-right text-[11px] font-medium tabular ${isPositive ? 'text-gain' : 'text-loss'}`}>
                      {isPositive ? '+' : ''}{fmtCurrency(item.pnl)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </ChartPanel>
  )
}
