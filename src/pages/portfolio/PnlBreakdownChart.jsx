import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { getPnlBuckets } from './helpers'

export default function PnlBreakdownChart({ rows }) {
  const buckets = getPnlBuckets(rows)
  const up = buckets.find((bucket) => bucket.id === 'gainers')
  const down = buckets.find((bucket) => bucket.id === 'losers')
  const flat = buckets.find((bucket) => bucket.id === 'flat')
  const downCount = down?.count ?? 0
  const total = Math.max(rows.length, 1)
  const downWidth = `${(downCount / total) * 100}%`
  const upWidth = `${((up?.count ?? 0) / total) * 100}%`

  return (
    <ChartPanel title="Position health" meta={`${rows.length} positions`}>
      <div className="mb-6">
        <p className="font-display text-3xl font-medium tracking-tight tabular text-white">{downCount} of {rows.length}</p>
        <p className="mt-2 text-sm text-white/50">positions are down</p>
      </div>
      <div className="mb-6">
        <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.07]" aria-label={`${downCount} positions down, ${up?.count ?? 0} positions up`}>
          <div className="bg-loss" style={{ width: downWidth }} />
          <div className="bg-gain" style={{ width: upWidth }} />
        </div>
        <div className="mt-3 flex justify-between text-xs text-white/40">
          <span>{downCount} down · {fmtCurrency(down?.value ?? 0)}</span>
          <span>{up?.count ?? 0} up · {fmtCurrency(up?.value ?? 0)}</span>
        </div>
      </div>
      {flat?.count > 0 && <p className="text-xs text-white/35">{flat.count} unchanged position{flat.count === 1 ? '' : 's'} · {fmtCurrency(flat.value)}</p>}
    </ChartPanel>
  )
}
