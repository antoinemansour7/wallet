import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Reveal from '../components/Reveal'
import { SearchSpot } from '../components/illustrations'
import { loadLocalPortfolio } from '../utils/portfolioStorage'
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
    x?.accountSignals != null && { label: 'Curated accounts', value: x.accountSignals },
    x?.searchSignals != null && { label: 'X search', value: x.searchSignals },
    research?.articles?.length ? { label: 'News', value: research.articles.length } : null,
    research?.queryCount ? { label: 'Queries', value: research.queryCount } : null,
  ].filter(Boolean)

  if (parts.length === 0) return null

  return (
    <div className="mt-10 rounded-2xl border border-white/[0.05] bg-wall-surface/60 px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30">What fed this run</p>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        {parts.map((p) => (
          <div key={p.label}>
            <p className="font-mono text-[15px] font-semibold tabular leading-none text-white/80">
              {p.value.toLocaleString()}
            </p>
            <p className="mt-1 text-[11px] text-white/35">{p.label}</p>
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
  const [sizing, setSizing] = useState(null)
  const [sizingLoading, setSizingLoading] = useState(false)
  const { user } = useAuth()

  async function loadResearch() {
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
      <div className="relative mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">

        <header className="mb-7">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-white sm:text-[26px]">Research</h1>
            {timeLabel && (
              <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-white/35">
                <span className="h-1.5 w-1.5 rounded-full bg-gain/70" />
                {timeLabel}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13px] text-white/45">
            {hasAnything
              ? `${picks.length + below.length} pick${picks.length + below.length === 1 ? '' : 's'} from ${signalCount.toLocaleString()} signals across X, screeners, media and news`
              : 'Overnight picks from X, screeners, media and news'}
          </p>
        </header>

        {!loadingResearch && <RegimeGauge regime={research?.regime} />}

        {loadingResearch ? (
          <div className="space-y-2.5">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-[78px] animate-pulse rounded-2xl border border-white/[0.05] bg-wall-surface" />
            ))}
          </div>
        ) : !hasAnything ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/[0.08] py-16 text-center">
            <SearchSpot />
            <p className="mt-3 text-[14px] text-white/50">No picks yet</p>
            <p className="mt-1 text-[12px] text-white/30">The pipeline runs nightly at 3 AM UTC</p>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              {picks.map((pick, i) => (
                <Reveal key={pick.ticker} delay={i * 60}>
                  <PickCard pick={pick} rank={i + 1} />
                </Reveal>
              ))}
            </div>

            {picks.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/[0.08] px-5 py-8 text-center">
                <p className="text-[13px] text-white/50">Nothing cleared {CONVICTION_THRESHOLD}/10 tonight</p>
                <p className="mt-1 text-[12px] text-white/30">
                  {below.length} lower-conviction candidate{below.length === 1 ? '' : 's'} below
                </p>
              </div>
            )}

            {below.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowBelow((v) => !v)}
                  aria-expanded={showBelow}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/[0.05] py-2.5 text-[11.5px] text-white/35 transition-colors duration-200 hover:border-white/[0.10] hover:text-white/60"
                >
                  {showBelow ? 'Hide' : `Show ${below.length} more`} below the {CONVICTION_THRESHOLD}/10 threshold
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
                      <PickCard key={pick.ticker} pick={pick} rank={picks.length + i + 1} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {picks.length > 0 && user && (
          <div className="mt-8">
            {!sizing && (
              <button
                onClick={() => loadPositionSizing(picks)}
                disabled={sizingLoading}
                className="w-full rounded-xl border border-white/[0.07] bg-wall-surface py-3 text-[12.5px] font-medium text-white/60 transition-colors duration-200 hover:border-white/[0.14] hover:text-white/85 disabled:opacity-50 sm:w-auto sm:px-5"
              >
                {sizingLoading ? 'Analyzing…' : 'Size against my portfolio'}
              </button>
            )}

            {sizing?.error && <p className="mt-3 text-[12px] text-loss/70">{sizing.error}</p>}

            {sizing?.picks?.length > 0 && (
              <div className="mt-5">
                <div className="mb-2.5 flex items-baseline justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/35">Suggested allocation</p>
                  <p className="font-mono text-[12px] tabular text-white/60">
                    ${sizing.totalSuggestedAllocation?.toLocaleString()}
                    <span className="text-white/30"> · {sizing.allocationPct}%</span>
                  </p>
                </div>
                <div className="space-y-2">
                  {sizing.picks.map((sp) => (
                    <div key={sp.ticker} className="rounded-xl border border-white/[0.06] bg-wall-surface px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[13.5px] font-semibold text-white">{sp.ticker}</span>
                        <span className="font-mono text-[12px] tabular text-gain">
                          {sp.suggestedPct}% · ${sp.suggestedAmount?.toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11.5px] leading-[1.7] text-white/50">{sp.reasoning}</p>
                      {sp.warning && <p className="mt-1.5 text-[11.5px] text-loss/70">{sp.warning}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!loadingResearch && hasAnything && <SignalTrail research={research} />}
      </div>
    </div>
  )
}
