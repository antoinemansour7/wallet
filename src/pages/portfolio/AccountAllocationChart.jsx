import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { EmptyChart } from './EmptyState'
import { pct, getAccountBreakdown } from './helpers'

export default function AccountAllocationChart({ accounts, large = false }) {
  const items = getAccountBreakdown(accounts)
  const total = items.reduce((s, i) => s + i.value, 0)

  return (
    <ChartPanel title="Allocation by Account" meta={fmtCurrency(total)} large={large}>
      {items.length === 0 ? <EmptyChart /> : (
        <>
          <div className="mb-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-ink/[0.07]">
            {items.map((item) => (
              <div
                key={item.account}
                style={{ width: `${pct(item.value, total)}%`, backgroundColor: item.color }}
                className="h-full rounded-full transition-all duration-motion-long"
                title={`Account ${item.account}: ${fmtCurrency(item.value)}`}
              />
            ))}
          </div>
          <div className="space-y-3.5">
            {items.map((item) => (
              <div key={item.account} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white/60">Account {item.account}</p>
                    <p className="text-[11px] text-white/40">
                      {item.positions} positions
                      {item.cash !== 0 ? ` · ${fmtCurrency(item.cash)} ${item.cashSource === 'explicit' ? 'cash' : 'inferred cash'}` : ''}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm tabular font-semibold text-white">{fmtCurrency(item.value)}</p>
                  <p className="font-mono text-[11px] tabular text-white/40">{pct(item.value, total).toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </ChartPanel>
  )
}
