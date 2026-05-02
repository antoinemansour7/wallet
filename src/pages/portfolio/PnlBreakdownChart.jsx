import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { barWidth, getPnlBuckets } from './helpers'

export default function PnlBreakdownChart({ rows }) {
  const buckets = getPnlBuckets(rows)
  const max     = Math.max(...buckets.map((b) => b.value), 1)

  return (
    <ChartPanel title="P&L Breakdown" meta={`${rows.length} positions`}>
      <div className="space-y-4">
        {buckets.map((b) => (
          <div key={b.id}>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.gradient[1] }} />
                <span className="text-sm text-white/60">{b.label}</span>
              </div>
              <span className="font-mono text-sm tabular font-semibold text-white">
                {b.count} · {fmtCurrency(b.value)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: b.value > 0 ? barWidth(b.value, max) : b.count > 0 ? '8%' : '0%',
                  background: `linear-gradient(90deg, ${b.gradient[0]}90, ${b.gradient[1]})`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </ChartPanel>
  )
}
