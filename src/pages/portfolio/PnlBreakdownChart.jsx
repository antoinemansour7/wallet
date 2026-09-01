import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { getPnlBuckets } from './helpers'

export default function PnlBreakdownChart({ rows }) {
  const buckets = getPnlBuckets(rows)
  const up = buckets.find((bucket) => bucket.id === 'gainers')
  const down = buckets.find((bucket) => bucket.id === 'losers')
  const flat = buckets.find((bucket) => bucket.id === 'flat')
  const upCount = up?.count ?? 0
  const downCount = down?.count ?? 0
  const total = Math.max(rows.length, 1)

  return (
    <ChartPanel title="Winners and losers" meta={`${rows.length} positions`} className="h-full">
      {/* Led with "7 of 12 positions are down", which states the worse half of a
          split and makes the reader do the subtraction for the rest. Both
          numbers, both colours, no arithmetic. */}
      <div className="mb-5 flex items-baseline gap-4">
        <p className="font-display text-[30px] font-medium leading-none tabular text-gain">
          {upCount} <span className="text-[15px] font-normal text-white/40">up</span>
        </p>
        <p className="font-display text-[30px] font-medium leading-none tabular text-loss">
          {downCount} <span className="text-[15px] font-normal text-white/40">down</span>
        </p>
      </div>

      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-label={`${upCount} positions up, ${downCount} positions down`}>
        <div className="rounded-l-full bg-gain" style={{ width: `${(upCount / total) * 100}%` }} />
        <div className="rounded-r-full bg-loss" style={{ width: `${(downCount / total) * 100}%` }} />
        {flat?.count > 0 && <div className="bg-white/20" style={{ width: `${(flat.count / total) * 100}%` }} />}
      </div>

      <div className="mt-4 flex flex-col gap-2 text-[12.5px]">
        <div className="flex items-baseline justify-between">
          <span className="text-white/45">Gains on the winners</span>
          <span className="font-mono tabular text-gain">+{fmtCurrency(up?.value ?? 0)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-white/45">Losses on the losers</span>
          <span className="font-mono tabular text-loss">−{fmtCurrency(Math.abs(down?.value ?? 0))}</span>
        </div>
        {flat?.count > 0 && (
          <div className="flex items-baseline justify-between">
            <span className="text-white/45">Unchanged</span>
            <span className="font-mono tabular text-white/40">{flat.count}</span>
          </div>
        )}
      </div>
    </ChartPanel>
  )
}
