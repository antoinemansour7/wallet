import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Reveal from '../components/Reveal'
import { SearchSpot } from '../components/illustrations'
import { loadLocalPortfolio } from '../utils/portfolioStorage'
import { IS_PREVIEW, PREVIEW_RESEARCH } from '../preview/mockMode'
import { flattenAccountRows } from '../utils/accountPortfolio'
import RegimeGauge from './research/RegimeGauge'
import PickCard from './research/PickCard'

// Picks below this are kept off the main list. They are still shown on request
// rather than hidden outright — the header used to read "2 picks" on a night the
// pipeline produced four, which looks like a thinner run than actually happened.
const CONVICTION_THRESHOLD = 6

function formatTime(dateStr) {
  if (!dateStr) return null
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch {
    return null
  }
}

/** What actually fed the run — the counts already in the payload. */
function SignalTrail({ research }) {
  const x = research?.xBreakdown
  const parts = [
    // Pipeline stage names meant nothing to a reader. Each label now says what
    // was actually read, not which part of the system read it.
    x?.accountSignals != null && { label: 'Posts from traders we follow', value: x.accountSignals },
    x?.searchSignals != null && { label: 'Other posts found by searching', value: x.searchSignals },
    research?.articles?.length ? { label: 'News articles', value: research.articles.length } : null,
    research?.queryCount ? { label: 'Searches run', value: research.queryCount } : null,
  ].filter(Boolean)

  if (parts.length === 0) return null

  return (
    <div className="rounded-2xl border border-ink/[0.05] bg-wall-surface/60 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/40">What we read last night</p>
      {/* Two columns so this reads the same in a 320px rail as it does full width. */}
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3.5">
        {parts.map((p) => (
          <div key={p.label}>
            <p className="font-mono text-[19px] font-semibold tabular leading-none text-ink/85">
              {p.value.toLocaleString()}
            </p>
            <p className="mt-1.5 text-[12px] text-ink/40">{p.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Research() {
  const [research, setResearch] = useState(null)
  const [loadingResearch, setLoadingResearch] = useState(true)
  const [showBelow, setShowBelow] = useState(false)
  const [livePrices, setLivePrices] = useState({})
  const [sizing, setSizing] = useState(null)
  const [sizingLoading, setSizingLoading] = useState(false)
  const { user } = useAuth()

  async function loadResearch() {
    // /api/get-research needs the nightly pipeline behind it. In preview the
    // page would otherwise sit on its empty state, which is the one view that
    // shows nothing about how the copy reads.
    if (IS_PREVIEW) { setResearch(PREVIEW_RESEARCH); setLoadingResearch(false); return }
    try {
      const res = await fetch('/api/get-research')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setResearch(await res.json())
    } catch (err) {
      console.error('[Research] failed to load research:', err.message)
      setResearch({ empty: true, picks: [], signalCount: 0, generatedAt: null })
    } finally {
      setLoadingResearch(false)
    }
  }

  /**
   * Prices for the picks, taken now rather than read back out of the payload.
   *
   * The pipeline captures a price and a day change when it runs and stores them
   * beside the pick. The page used to render those straight back, so a figure
   * could be a full day old and the change was whatever was true at the moment
   * the pipeline happened to ask — which is why every card showed 0.00% and a
   * price that never moved.
   *
   * The stored figures are kept, because the ranking is built on what was true
   * when the pick was made. They are just the wrong thing to show.
   */
  async function loadLivePrices(picksToPrice) {
    const symbols = [...new Set(picksToPrice.map((p) => p.ticker).filter(Boolean))]
    if (symbols.length === 0) return

    try {
      const res = await fetch('/api/live-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      })
      if (!res.ok) return

      const data = await res.json()
      const at = new Date().toISOString()
      const next = {}
      for (const quote of data.quotes ?? []) {
        const symbol = quote.requestedSymbol ?? quote.symbol
        const price = Number(quote.price ?? quote.regularMarketPrice)
        if (!symbol || !Number.isFinite(price)) continue
        next[symbol] = {
          price,
          changePercent: Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent) : null,
          at,
        }
      }
      setLivePrices(next)
    } catch {
      // A failed refresh leaves the stored figures showing, and the card says
      // when they were taken. Silence is fine; a wrong number is not.
    }
  }

  async function loadPositionSizing(picksToSize) {
    if (!user?.uid) return
    setSizingLoading(true)
    try {
      const saved = loadLocalPortfolio(user.uid)
      if (!saved) { setSizing({ error: 'Upload your portfolio first' }); return }
      const portfolioRows = saved.rows?.length > 0 ? saved.rows : flattenAccountRows(saved.accounts)
      if (!portfolioRows.length) { setSizing({ error: 'No holdings found in portfolio' }); return }
      const res = await fetch('/api/position-sizing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picks: picksToSize, portfolioRows }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSizing(await res.json())
    } catch (err) {
      console.error('[Research] position sizing failed:', err.message)
      setSizing({ error: 'Failed to analyze positions' })
    } finally {
      setSizingLoading(false)
    }
  }

  useEffect(() => { loadResearch() }, [])

  // Priced on arrival, then every five minutes, matching the portfolio.
  useEffect(() => {
    const all = research?.picks ?? []
    if (all.length === 0) return undefined

    loadLivePrices(all)
    const id = window.setInterval(() => loadLivePrices(all), 5 * 60 * 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [research])

  const { picks, below } = useMemo(() => {
    const all = [...(research?.picks ?? [])].sort((a, b) => b.conviction - a.conviction)
    return {
      picks: all.filter((p) => p.conviction >= CONVICTION_THRESHOLD),
      below: all.filter((p) => p.conviction < CONVICTION_THRESHOLD),
    }
  }, [research])

  const signalCount = research?.signalCount ?? research?.tweetCount ?? 0
  const timeLabel = formatTime(research?.generatedAt)
  const hasAnything = picks.length + below.length > 0

  return (
    <div className="relative min-h-screen overflow-hidden bg-wall-bg">
      <div className="glow-orb blob-drift absolute -top-72 left-1/2 h-[520px] w-[520px] -translate-x-1/2" />
      <div className="relative mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">

        <header className="mb-7">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-ink sm:text-[34px]">Research</h1>
            {timeLabel && (
              <span className="flex shrink-0 items-center gap-2 text-[12.5px] text-ink/40">
                <span className="h-1.5 w-1.5 rounded-full bg-gain/70" />
                {timeLabel}
              </span>
            )}
          </div>
          <p className="mt-2 text-[15px] leading-relaxed text-ink/50">
            {hasAnything
              ? `${picks.length + below.length} idea${picks.length + below.length === 1 ? '' : 's'}, picked overnight from ${signalCount.toLocaleString()} posts, articles and stock screens`
              : 'Ideas picked overnight from posts, articles and stock screens'}
          </p>
        </header>

        {/* Two columns above lg: the picks carry the page, the rail holds the
            context that used to stack underneath them and leave a 672px column
            marooned in the middle of a wide screen. Grid placement rather than
            source order, so a phone still reads conditions → picks → context. */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6">

        <div className="lg:col-start-2 lg:row-start-1">
          {!loadingResearch && <RegimeGauge regime={research?.regime} defaultOpen />}
        </div>

        <div className="lg:col-start-1 lg:row-start-1 lg:row-span-3">
        {loadingResearch ? (
          <div className="space-y-2.5">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-[78px] animate-pulse rounded-2xl border border-ink/[0.05] bg-wall-surface" />
            ))}
          </div>
        ) : !hasAnything ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-ink/[0.08] py-16 text-center">
            <SearchSpot />
            <p className="mt-3 text-[14px] text-ink/50">No picks yet</p>
            <p className="mt-1 text-[12px] text-ink/30">The pipeline runs nightly at 3 AM UTC</p>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              {picks.map((pick, i) => (
                <Reveal key={pick.ticker} delay={i * 60}>
                  {/* Lead with the top pick already open: the page opens on an
                      argument rather than on a row you have to discover is
                      clickable, and it balances the context rail beside it. */}
                  <PickCard
                    pick={pick}
                    rank={i + 1}
                    defaultOpen={i === 0}
                    live={livePrices[pick.ticker]}
                    generatedAt={research?.generatedAt}
                  />
                </Reveal>
              ))}
            </div>

            {picks.length === 0 && (
              <div className="rounded-2xl border border-dashed border-ink/[0.08] px-5 py-8 text-center">
                <p className="text-[13px] text-ink/50">Nothing looked strong enough tonight</p>
                <p className="mt-1 text-[12px] text-ink/30">
                  {below.length} weaker idea{below.length === 1 ? '' : 's'} below, if you want to look anyway
                </p>
              </div>
            )}

            {below.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowBelow((v) => !v)}
                  aria-expanded={showBelow}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-ink/[0.05] py-2.5 text-[11.5px] text-ink/35 transition-colors duration-200 hover:border-ink/[0.10] hover:text-ink/60"
                >
                  {showBelow ? 'Hide the weaker ideas' : `Show ${below.length} weaker idea${below.length === 1 ? '' : 's'}`}
                  <svg
                    width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    className={`transition-transform duration-200 ${showBelow ? 'rotate-180' : ''}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {showBelow && (
                  <div className="mt-2.5 space-y-2.5 opacity-70">
                    {below.map((pick, i) => (
                      <PickCard
                        key={pick.ticker}
                        pick={pick}
                        rank={picks.length + i + 1}
                        live={livePrices[pick.ticker]}
                        generatedAt={research?.generatedAt}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        </div>

        {picks.length > 0 && user && (
          <div className="lg:col-start-2 lg:row-start-2">
            {!sizing && (
              <button
                onClick={() => loadPositionSizing(picks)}
                disabled={sizingLoading}
                className="w-full rounded-xl border border-ink/[0.07] bg-wall-surface py-3.5 text-[13.5px] font-medium text-ink/65 transition-colors duration-200 hover:border-ink/[0.14] hover:text-ink/90 disabled:opacity-50"
              >
                {sizingLoading ? 'Analyzing…' : 'Size against my portfolio'}
              </button>
            )}

            {sizing?.error && <p className="mt-3 text-[12px] text-loss/70">{sizing.error}</p>}

            {sizing?.picks?.length > 0 && (
              <div className="mt-5">
                <div className="mb-2.5 flex items-baseline justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink/35">Suggested allocation</p>
                  <p className="font-mono text-[12px] tabular text-ink/60">
                    ${sizing.totalSuggestedAllocation?.toLocaleString()}
                    <span className="text-ink/30"> · {sizing.allocationPct}%</span>
                  </p>
                </div>
                <div className="space-y-2">
                  {sizing.picks.map((sp) => (
                    <div key={sp.ticker} className="rounded-xl border border-ink/[0.06] bg-wall-surface px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[13.5px] font-semibold text-ink">{sp.ticker}</span>
                        <span className="font-mono text-[12px] tabular text-gain">
                          {sp.suggestedPct}% · ${sp.suggestedAmount?.toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11.5px] leading-[1.7] text-ink/50">{sp.reasoning}</p>
                      {sp.warning && <p className="mt-1.5 text-[11.5px] text-loss/70">{sp.warning}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="lg:col-start-2 lg:row-start-3">
          {!loadingResearch && hasAnything && <SignalTrail research={research} />}
        </div>

        </div>
      </div>
    </div>
  )
}
