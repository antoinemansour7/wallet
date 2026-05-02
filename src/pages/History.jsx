import { useEffect, useState } from 'react'

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
    return Math.floor(diff / 86400000)
  } catch {
    return 0
  }
}

function scoreBadge(score) {
  if (!score) return null
  const n = Number(score)
  const color = n >= 8 ? 'border-gain/20 bg-gain/10 text-gain' : n >= 6 ? 'border-amber-400/20 bg-amber-400/10 text-amber-400' : 'border-white/10 bg-white/[0.06] text-white/40'
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold ${color}`}>
      {n}/10
    </span>
  )
}

function PerformanceBadge({ pickPrice, currentPrice }) {
  if (!pickPrice || !currentPrice) return null
  const pct = ((currentPrice - pickPrice) / pickPrice) * 100
  const isPos = pct >= 0
  const color = isPos ? 'text-gain bg-gain/10 border-gain/20' : 'text-loss bg-loss/10 border-loss/20'
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${color}`}>
      {isPos ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function EngineStats({ entries, liveQuotes }) {
  if (entries.length === 0) return null

  let wins = 0
  let losses = 0
  let totalReturn = 0
  let count = 0

  for (const entry of entries) {
    for (const pick of entry.picks) {
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

  const avgReturn = totalReturn / count
  const winRate = (wins / count) * 100

  return (
    <div className="mb-6 grid grid-cols-3 gap-3">
      <div className="rounded-card border border-white/[0.06] bg-wall-surface p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">Win Rate</p>
        <p className={`mt-1 font-mono text-lg font-bold ${winRate >= 50 ? 'text-gain' : 'text-loss'}`}>
          {winRate.toFixed(0)}%
        </p>
        <p className="mt-0.5 text-[11px] text-white/20">{wins}W / {losses}L</p>
      </div>
      <div className="rounded-card border border-white/[0.06] bg-wall-surface p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">Avg Return</p>
        <p className={`mt-1 font-mono text-lg font-bold ${avgReturn >= 0 ? 'text-gain' : 'text-loss'}`}>
          {avgReturn >= 0 ? '+' : ''}{avgReturn.toFixed(1)}%
        </p>
        <p className="mt-0.5 text-[11px] text-white/20">per pick</p>
      </div>
      <div className="rounded-card border border-white/[0.06] bg-wall-surface p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">Picks Tracked</p>
        <p className="mt-1 font-mono text-lg font-bold text-white">{count}</p>
        <p className="mt-0.5 text-[11px] text-white/20">across {entries.length} days</p>
      </div>
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

        // Fetch live prices for all historical tickers
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
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-white">Pick History</h1>
          <p className="mt-1 text-sm text-white/40">Past nightly AI picks — track performance since picked.</p>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-card border border-white/[0.06] bg-wall-surface" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-card border border-dashed border-white/[0.06] px-5 py-16 text-center">
            <p className="text-sm text-white/40">No history yet.</p>
            <p className="mt-1 text-xs text-white/20">History is recorded each time the nightly pipeline runs.</p>
          </div>
        ) : (
          <>
            <EngineStats entries={entries} liveQuotes={liveQuotes} />

            <div className="relative space-y-4">
              {/* Timeline line */}
              <div className="absolute left-[19px] top-4 bottom-4 w-px bg-white/[0.06]" />

              {entries.map((entry) => (
                <div key={entry.date} className="relative flex gap-4">
                  {/* Timeline dot */}
                  <div className="relative z-10 mt-5 flex h-10 w-10 shrink-0 items-center justify-center">
                    <div className="h-2.5 w-2.5 rounded-full border-2 border-white/20 bg-wall-bg" />
                  </div>

                  {/* Card */}
                  <div className="flex-1 rounded-card border border-white/[0.06] bg-wall-surface p-5 transition-all duration-200 hover:border-white/[0.12]">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">{formatDate(entry.date)}</h3>
                        <span className="text-[10px] text-white/20">{daysAgo(entry.date)}d ago</span>
                      </div>
                      <span className="text-[10px] text-white/20">{entry.signalCount} signals</span>
                    </div>

                    <div className="space-y-2">
                      {entry.picks.map((pick) => {
                        const pickPrice = Number(pick.price) || null
                        const currentPrice = liveQuotes[pick.ticker] || null
                        return (
                          <div key={pick.ticker} className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm font-bold text-white">
                              {pick.ticker?.[0]}
                            </div>
                            <span className="font-mono text-sm font-bold text-white">{pick.ticker}</span>
                            {scoreBadge(pick.report || pick.conviction)}
                            <p className="min-w-0 flex-1 truncate text-xs text-white/40">{pick.reason}</p>
                            <div className="flex shrink-0 items-center gap-2">
                              {pickPrice && (
                                <span className="font-mono text-[11px] text-white/20">${pickPrice.toFixed(2)}</span>
                              )}
                              {currentPrice && pickPrice && (
                                <>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white/10">
                                    <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                  <span className="font-mono text-[11px] text-white/40">${currentPrice.toFixed(2)}</span>
                                </>
                              )}
                              <PerformanceBadge pickPrice={pickPrice} currentPrice={currentPrice} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
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
