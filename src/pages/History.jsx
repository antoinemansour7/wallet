import { useEffect, useState } from 'react'
import CompanyLogo from '../components/CompanyLogo'
import { HistorySpot } from '../components/illustrations'

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

function daysAgo(dateStr) {
  try {
    const diff = Date.now() - new Date(dateStr + 'T00:00:00').getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'today'
    if (days === 1) return '1d ago'
    return `${days}d ago`
  } catch {
    return ''
  }
}

function pctReturn(pickPrice, currentPrice) {
  if (!pickPrice || !currentPrice) return null
  return ((currentPrice - pickPrice) / pickPrice) * 100
}

function ReturnPill({ pct }) {
  if (pct === null) return <span className="w-12 sm:w-16" />
  const isPos = pct >= 0
  const color = isPos ? 'text-gain' : 'text-loss'
  return (
    <span className={`w-12 shrink-0 text-right font-mono text-[11px] font-semibold sm:w-16 sm:text-xs ${color}`}>
      {isPos ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function StatPill({ label, value, sub, highlight }) {
  const border = highlight ? 'border-gain/20' : 'border-ink/[0.06]'
  const bg = highlight ? 'bg-gain/[0.05]' : 'bg-wall-surface'
  return (
    <div className={`rounded-xl border ${border} ${bg} px-4 py-3`}>
      <p className={`text-[10px] font-bold uppercase tracking-wider ${highlight ? 'text-gain/70' : 'text-ink/30'}`}>{label}</p>
      <p className={`mt-0.5 font-mono text-base font-bold ${highlight ? 'text-gain' : 'text-ink'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-ink/20">{sub}</p>}
    </div>
  )
}

function EngineStats({ entries, liveQuotes }) {
  if (entries.length === 0) return null

  const computeStats = (filterFn) => {
    let wins = 0, losses = 0, totalReturn = 0, count = 0
    for (const entry of entries) {
      for (const pick of entry.picks) {
        if (filterFn && !filterFn(pick)) continue
        const pickPrice = Number(pick.price)
        const current = liveQuotes[pick.ticker]
        if (!pickPrice || !current) continue
        const pct = ((current - pickPrice) / pickPrice) * 100
        totalReturn += pct
        count++
        if (pct >= 0) wins++
        else losses++
      }
    }
    if (count === 0) return null
    return { wins, losses, count, avgReturn: totalReturn / count, winRate: (wins / count) * 100 }
  }

  const all = computeStats()
  const high = computeStats((p) => p.conviction >= 7)

  if (!all) return null

  return (
    <div className="mb-8 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatPill label="Win Rate" value={`${all.winRate.toFixed(0)}%`} sub={`${all.wins}W / ${all.losses}L`} />
        <StatPill label="Avg Return" value={`${all.avgReturn >= 0 ? '+' : ''}${all.avgReturn.toFixed(1)}%`} sub="per pick" />
        <StatPill label="Picks" value={all.count} sub={`${entries.length} days`} />
        {high && (
          <StatPill
            label="7+ Conviction"
            value={`${high.avgReturn >= 0 ? '+' : ''}${high.avgReturn.toFixed(1)}%`}
            sub={`${high.winRate.toFixed(0)}% win · ${high.count} picks`}
            highlight
          />
        )}
      </div>
    </div>
  )
}

function PickRow({ pick, currentPrice }) {
  const pickPrice = Number(pick.price) || null
  const pct = pctReturn(pickPrice, currentPrice)
  const conviction = Number(pick.conviction || pick.report || 0)

  return (
    <div className="group flex items-center gap-2 py-2.5 border-b border-ink/[0.04] last:border-0 sm:gap-3">
      {/* Ticker */}
      <CompanyLogo symbol={pick.ticker} size={24} className="hidden sm:flex" />
      <span className="w-12 shrink-0 font-mono text-[13px] font-bold text-ink sm:w-14 sm:text-sm">{pick.ticker}</span>

      {/* Conviction dot */}
      <div className="hidden items-center gap-1 sm:flex">
        <div className={`h-1.5 w-1.5 rounded-full ${conviction >= 8 ? 'bg-gain' : conviction >= 6 ? 'bg-warning' : 'bg-ink/20'}`} />
        <span className="font-mono text-[10px] text-ink/30">{conviction}</span>
      </div>

      {/* Reason */}
      <p className="min-w-0 flex-1 truncate text-[11px] text-ink/40 group-hover:text-ink/60 transition-colors sm:text-xs">{pick.reason}</p>

      {/* Prices */}
      <div className="hidden sm:flex items-center gap-1.5 text-ink/20">
        {pickPrice && <span className="font-mono text-[10px]">${pickPrice.toFixed(0)}</span>}
        {pickPrice && currentPrice && <span className="text-[10px]">→</span>}
        {currentPrice && <span className="font-mono text-[10px]">${currentPrice.toFixed(0)}</span>}
      </div>

      {/* Return */}
      <ReturnPill pct={pct} />
    </div>
  )
}

export default function History() {
  const [entries, setEntries] = useState([])
  const [liveQuotes, setLiveQuotes] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/get-research-history')
      .then((r) => r.json())
      .then((d) => {
        const today = new Date().toISOString().slice(0, 10)
        const e = (d.entries || []).filter((entry) => entry.date !== today)
        setEntries(e)

        const tickers = [...new Set(e.flatMap((entry) => entry.picks.map((p) => p.ticker)))]
        if (tickers.length > 0) {
          fetch('/api/live-prices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols: tickers }),
          })
            .then((r) => r.json())
            .then((data) => {
              const map = {}
              for (const q of data.quotes ?? []) {
                const sym = q.requestedSymbol ?? q.symbol
                const price = q.price ?? q.regularMarketPrice
                if (sym && price) map[sym] = Number(price)
              }
              setLiveQuotes(map)
            })
            .catch(() => {})
        }
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-wall-bg">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-ink">Pick History</h1>
          <p className="mt-0.5 text-xs text-ink/30">Engine performance tracked since pick date</p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-ink/[0.04] bg-wall-surface" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-ink/[0.06] py-14 text-center">
            <HistorySpot />
            <p className="mt-3 text-sm text-ink/40">No history yet.</p>
            <p className="mt-1 text-xs text-ink/20">Recorded after each nightly pipeline run.</p>
          </div>
        ) : (
          <>
            <EngineStats entries={entries} liveQuotes={liveQuotes} />

            {/* Entries */}
            <div className="space-y-3">
              {entries.filter((entry) => entry.picks.some((p) => p.conviction >= 6)).map((entry) => (
                <div key={entry.date} className="overflow-hidden rounded-xl border border-ink/[0.06] bg-wall-surface">
                  {/* Day header */}
                  <div className="flex items-center justify-between border-b border-ink/[0.04] px-4 py-3 sm:px-5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-semibold text-ink">{formatDate(entry.date)}</h3>
                      <span className="text-[10px] text-ink/20">{daysAgo(entry.date)}</span>
                    </div>
                    <span className="rounded-full bg-ink/[0.04] px-2.5 py-0.5 text-[10px] font-medium text-ink/30">
                      {entry.signalCount} signals
                    </span>
                  </div>

                  {/* Picks */}
                  <div className="px-4 py-1 sm:px-5">
                    {entry.picks.filter((p) => p.conviction >= 6).map((pick) => (
                      <PickRow
                        key={`${pick.ticker}-${entry.date}`}
                        pick={pick}
                        currentPrice={liveQuotes[pick.ticker] || null}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
