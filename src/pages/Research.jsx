import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import CompanyLogo from '../components/CompanyLogo'
import Reveal from '../components/Reveal'
import { SearchSpot } from '../components/illustrations'
import { loadLocalPortfolio } from '../utils/portfolioStorage'
import { flattenAccountRows } from '../utils/accountPortfolio'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatGeneratedAt(dateStr) {
  if (!dateStr) return null
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    })
  } catch {
    return null
  }
}

function trendLabel(trend) {
  const labels = {
    uptrend: 'Uptrend', 'overbought-uptrend': 'Overbought', recovery: 'Recovery',
    consolidating: 'Consolidating', pullback: 'Pullback', downtrend: 'Downtrend',
    'oversold-downtrend': 'Oversold', mixed: 'Mixed',
  }
  return labels[trend] || trend
}

function setupLabel(type) {
  const labels = {
    squeeze: 'Squeeze', breakout: 'Breakout', volume: 'Volume',
    catalyst: 'Catalyst', momentum: 'Momentum',
  }
  return labels[type] || type
}

// ─── Pick Card ─────────────────────────────────────────────────────────────────

function PickCard({ pick, rank }) {
  const [open, setOpen] = useState(false)
  const {
    ticker, conviction, reason, setupType,
    sourceCount, technicals,
    bearCase, riskScore,
    catalystVerified, catalystDetail, catalystTimeline, catalystPricedIn,
    price, stopLoss, target,
  } = pick

  const scoreColor = conviction >= 8 ? 'text-gain' : conviction >= 6 ? 'text-white' : 'text-white/40'

  return (
    <div className="rounded-2xl border border-white/[0.05] bg-wall-surface transition-all duration-300 hover:border-white/[0.09]">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-4 text-left sm:px-6 sm:py-5"
      >
        <div className="flex items-center gap-4">
          <span className="relative shrink-0">
            <CompanyLogo symbol={ticker} size={36} />
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-wall-elevated text-[9px] font-semibold text-white/60 ring-2 ring-wall-surface">
              {rank}
            </span>
          </span>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-[15px] font-semibold tracking-[-0.02em] text-white">{ticker}</span>
              {setupType && (
                <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium tracking-wide text-white/30">
                  {setupLabel(setupType)}
                </span>
              )}
            </div>
            <p className="mt-0.5 hidden max-w-md truncate text-[12px] text-white/30 sm:block">
              {reason?.slice(0, 90)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className={`font-mono text-[14px] font-semibold ${scoreColor}`}>{conviction}</span>
            <span className="font-mono text-[11px] text-white/20">/10</span>
          </div>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            className={`text-white/20 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {/* Body — expanded */}
      {open && (
        <div className="border-t border-white/[0.04] px-5 py-5 sm:px-6 sm:py-6">
          {/* Thesis */}
          <p className="text-[13px] leading-[1.8] text-white/50">{reason}</p>

          {/* Technical pills */}
          {technicals && (
            <div className="mt-4 flex flex-wrap gap-2">
              {technicals.trend && (
                <span className="rounded-full border border-white/[0.06] px-2.5 py-1 text-[11px] text-white/40">
                  {trendLabel(technicals.trend)}
                </span>
              )}
              {technicals.rsi != null && (
                <span className="rounded-full border border-white/[0.06] px-2.5 py-1 font-mono text-[11px] text-white/35">
                  RSI {technicals.rsi}
                </span>
              )}
              {technicals.pctFrom52wHigh != null && (
                <span className="rounded-full border border-white/[0.06] px-2.5 py-1 font-mono text-[11px] text-white/30">
                  {technicals.pctFrom52wHigh}% from high
                </span>
              )}
              {technicals.relativeVolume > 1.3 && (
                <span className="rounded-full border border-white/[0.06] px-2.5 py-1 font-mono text-[11px] text-white/30">
                  {technicals.relativeVolume}x vol
                </span>
              )}
              {sourceCount > 0 && (
                <span className="rounded-full border border-white/[0.06] px-2.5 py-1 text-[11px] text-white/25">
                  {sourceCount} source{sourceCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

          {/* Trade plan — ATR-based exit levels */}
          {price != null && stopLoss != null && target != null && (
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-white/[0.03] px-3 py-2.5 text-center">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/30">Entry</p>
                <p className="mt-0.5 text-[13px] font-semibold tabular text-white">${price}</p>
              </div>
              <div className="rounded-xl bg-loss/[0.06] px-3 py-2.5 text-center">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-loss/50">Stop</p>
                <p className="mt-0.5 text-[13px] font-semibold tabular text-loss">${stopLoss}</p>
              </div>
              <div className="rounded-xl bg-gain/[0.06] px-3 py-2.5 text-center">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-gain/50">Target</p>
                <p className="mt-0.5 text-[13px] font-semibold tabular text-gain">${target}</p>
              </div>
            </div>
          )}

          {/* Bear Case */}
          {bearCase && (
            <div className="mt-5 rounded-xl bg-loss/[0.04] px-4 py-3.5">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-loss/60">Bear Case</span>
                {riskScore != null && (
                  <span className="font-mono text-[10px] text-loss/40">Risk {riskScore}/10</span>
                )}
              </div>
              <p className="text-[12px] leading-[1.7] text-white/40">{bearCase}</p>
            </div>
          )}

          {/* Catalyst */}
          {catalystVerified != null && (
            <div className={`mt-3 rounded-xl px-4 py-3.5 ${catalystVerified ? 'bg-gain/[0.04]' : 'bg-white/[0.02]'}`}>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className={`text-[10px] font-semibold uppercase tracking-[0.06em] ${catalystVerified ? 'text-gain/60' : 'text-white/25'}`}>
                  {catalystVerified ? 'Catalyst Verified' : 'No Catalyst'}
                </span>
                {catalystTimeline && (
                  <span className="text-[10px] text-white/25">{catalystTimeline}</span>
                )}
                {catalystPricedIn && (
                  <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-medium text-white/30">Priced in</span>
                )}
              </div>
              {catalystDetail && (
                <p className="text-[12px] leading-[1.7] text-white/40">{catalystDetail}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Research() {
  const [research, setResearch] = useState(null)
  const [loadingResearch, setLoadingResearch] = useState(true)
  const [sizing, setSizing] = useState(null)
  const [sizingLoading, setSizingLoading] = useState(false)
  const { user } = useAuth()

  async function loadResearch() {
    try {
      const res = await fetch('/api/get-research')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setResearch(data)
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
      const data = await res.json()
      setSizing(data)
    } catch (err) {
      console.error('[Research] position sizing failed:', err.message)
      setSizing({ error: 'Failed to analyze positions' })
    } finally {
      setSizingLoading(false)
    }
  }

  useEffect(() => { loadResearch() }, [])

  const picks = (research?.picks ?? []).filter((p) => p.conviction >= 6).sort((a, b) => b.conviction - a.conviction)
  const signalCount = research?.signalCount ?? research?.tweetCount ?? 0
  const generatedAtLabel = formatGeneratedAt(research?.generatedAt)

  return (
    <div className="relative min-h-screen overflow-hidden bg-wall-bg">
      <div className="glow-orb blob-drift absolute -top-72 left-1/2 h-[520px] w-[520px] -translate-x-1/2" />
      <div className="relative mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">

        {/* Header */}
        <div className="mb-8 sm:mb-12">
          <h1 className="text-[20px] font-semibold tracking-[-0.03em] text-white sm:text-[24px]">Research</h1>
          <div className="mt-2 flex items-center gap-3">
            <p className="text-[13px] text-white/30">
              {picks.length > 0
                ? `${picks.length} picks from ${signalCount} signals`
                : 'AI-curated picks from X signals'
              }
            </p>
            {generatedAtLabel && (
              <span className="rounded-full bg-gain/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-gain/80">
                {generatedAtLabel}
              </span>
            )}
          </div>
        </div>

        {/* Picks */}
        {loadingResearch ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-[72px] animate-pulse rounded-2xl border border-white/[0.04] bg-wall-surface" />
            ))}
          </div>
        ) : picks.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/[0.06] py-16 text-center">
            <SearchSpot />
            <p className="mt-3 text-[14px] text-white/40">No picks yet</p>
            <p className="mt-1 text-[12px] text-white/20">Pipeline runs nightly at 3 AM UTC</p>
          </div>
        ) : (
          <div className="space-y-3">
            {picks.map((pick, i) => (
              <Reveal key={pick.ticker} delay={i * 70}>
                <PickCard pick={pick} rank={i + 1} />
              </Reveal>
            ))}
          </div>
        )}

        {/* Position Sizing */}
        {picks.length > 0 && user && (
          <div className="mt-10">
            {!sizing && (
              <button
                onClick={() => loadPositionSizing(picks)}
                disabled={sizingLoading}
                className="rounded-full border border-white/[0.06] bg-wall-surface px-4 py-2 text-[12px] font-medium text-white/40 transition-all duration-200 hover:border-white/[0.12] hover:text-white/60 disabled:opacity-50"
              >
                {sizingLoading ? 'Analyzing...' : 'Size against my portfolio'}
              </button>
            )}

            {sizing?.error && (
              <p className="mt-3 text-[12px] text-loss/60">{sizing.error}</p>
            )}

            {sizing?.picks && sizing.picks.length > 0 && (
              <div className="mt-5 space-y-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/20">
                  Suggested: ${sizing.totalSuggestedAllocation?.toLocaleString()} ({sizing.allocationPct}%)
                </p>
                {sizing.picks.map((sp) => (
                  <div key={sp.ticker} className="rounded-xl border border-white/[0.05] bg-wall-surface px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[13px] font-medium text-white/70">{sp.ticker}</span>
                      <span className="font-mono text-[12px] text-gain/70">{sp.suggestedPct}% · ${sp.suggestedAmount?.toLocaleString()}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-white/35">{sp.reasoning}</p>
                    {sp.warning && <p className="mt-1 text-[11px] text-loss/50">{sp.warning}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
