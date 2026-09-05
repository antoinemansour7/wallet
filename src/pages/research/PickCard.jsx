import { useState } from 'react'
import CompanyLogo from '../../components/CompanyLogo'
import ChangedValue from '../../components/ChangedValue'

// ─── Labels ────────────────────────────────────────────────────────────────────

// The pipeline's setup names are trader shorthand. Each becomes a short phrase
// that says what the chart is doing, so the chip is readable without a glossary.
const SETUP_LABELS = {
  squeeze: 'Coiled tight', breakout: 'Breaking out', volume: 'Unusual volume',
  catalyst: 'Event coming', momentum: 'Trending up',
}

const TREND_LABELS = {
  uptrend: 'Rising', 'overbought-uptrend': 'Rising, looks stretched',
  recovery: 'Recovering', consolidating: 'Flat range', pullback: 'Pulling back',
  downtrend: 'Falling', 'oversold-downtrend': 'Falling, may be oversold',
  mixed: 'No clear direction',
}

// The raw source strings are internal identifiers. "exa-discovery" and
// "AVGO catalyst search" mean something to the pipeline and nothing to a reader.
function sourceLabel(source) {
  const s = String(source)
  if (s.startsWith('@')) return s
  if (s === 'finviz') return 'Stock screener'
  if (s === 'exa-discovery') return 'News coverage'
  if (s.endsWith('catalyst search')) return 'News search'
  if (s.endsWith('search')) return 'Web search'
  return s
}

const isHandle = (source) => String(source).startsWith('@')

// Number(null) is 0, and 0 is finite — so a plain isFinite check waved null stop
// and target values straight through and rendered a trade plan reading
// "STOP $0.00 / TARGET $0.00". Absent has to stay absent.
function num(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const CURRENCY = { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }

function money(value) {
  if (!Number.isFinite(value)) return null
  return value.toLocaleString('en-US', CURRENCY)
}

// ─── Pieces ────────────────────────────────────────────────────────────────────

// Same bar language as the market-conditions panel, so the two numbers on this
// page read as the same kind of measurement rather than two unrelated scales.
function ScoreMeter({ score, max = 10, tone = 'conviction', className = '' }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100))
  const bar = tone === 'risk'
    ? (score >= 7 ? 'bg-loss/70' : score >= 5 ? 'bg-warning/60' : 'bg-ink/30')
    : (score >= 8 ? 'bg-gain' : score >= 6 ? 'bg-ink/75' : 'bg-ink/35')
  const text = tone === 'risk'
    ? (score >= 7 ? 'text-loss' : score >= 5 ? 'text-warning' : 'text-ink/50')
    : (score >= 8 ? 'text-gain' : score >= 6 ? 'text-ink' : 'text-ink/50')

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-ink/[0.08] sm:block">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-[18px] font-semibold tabular leading-none ${text}`}>{score}</span>
      <span className="font-mono text-[12px] leading-none text-ink/25">/{max}</span>
    </div>
  )
}

// Provenance was the most useful thing the payload carried and the one thing the
// old card never showed. "Who says so" is most of what makes a pick worth
// reading, and it replaces a truncated copy of a thesis sitting one click away.
// Sources are ordered most-informative-first by the pipeline, so a phone shows
// one and a count. Three chips wrapped to three lines at 390px, which stretched
// the card and threw the logo off centre.
const MOBILE_CHIPS = 1
const DESKTOP_CHIPS = 3

function SourceChips({ sources = [] }) {
  if (sources.length === 0) return null
  const shown = sources.slice(0, DESKTOP_CHIPS)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((source, i) => (
        <span
          key={source}
          className={`rounded-md px-2 py-0.5 text-[11.5px] font-medium leading-[1.6] ${
            i >= MOBILE_CHIPS ? 'hidden sm:inline-block' : ''
          } ${isHandle(source) ? 'bg-ink/[0.08] text-ink/70' : 'bg-ink/[0.04] text-ink/45'}`}
        >
          {sourceLabel(source)}
        </span>
      ))}
      {sources.length > MOBILE_CHIPS && (
        <span className="text-[11.5px] text-ink/30 sm:hidden">+{sources.length - MOBILE_CHIPS}</span>
      )}
      {sources.length > DESKTOP_CHIPS && (
        <span className="hidden text-[11.5px] text-ink/30 sm:inline">+{sources.length - DESKTOP_CHIPS}</span>
      )}
    </div>
  )
}

function Section({ label, trailing, children }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/40">{label}</span>
        {trailing}
      </div>
      {children}
    </div>
  )
}

// ─── Card ──────────────────────────────────────────────────────────────────────

/** When the overnight run happened, said the way a person would say it. */
function runLabel(generatedAt) {
  const ms = Date.parse(String(generatedAt ?? ''))
  if (!Number.isFinite(ms)) return 'the last run'

  const hours = Math.floor((Date.now() - ms) / 3600000)
  if (hours < 1) return 'this run'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export default function PickCard({ pick, rank, defaultOpen = false, live, generatedAt }) {
  const [open, setOpen] = useState(defaultOpen)
  const {
    ticker, conviction, reason, setupType, sources = [], themes = [],
    signalCount, technicals, bearCase, riskScore, quoteVerified,
    catalystVerified, catalystDetail, catalystTimeline, catalystPricedIn,
    price, stopLoss, target, technicalAgreement, disagreementNote,
    coverageAcceleration, coverageToday, coveragePriorAverage,
  } = pick

  // Say what changed in counts a reader can check, not "coverage accelerating".
  // Only worth a line when it actually moved: a steady or brand-new ticker has
  // nothing to report, and "new" in particular means there is no history to
  // compare against rather than that attention jumped.
  const coverageNote = (() => {
    if (!Number.isFinite(coverageToday) || !Number.isFinite(coveragePriorAverage)) return null
    const before = Math.round(coveragePriorAverage)
    // "New" is load-bearing: a post already counted on an earlier day is not
    // counted again, so these are genuinely per-day figures rather than two
    // overlapping trailing windows being differenced.
    if (coverageAcceleration === 'accelerating') {
      return `New mentions jumped to ${coverageToday} today, against about ${before} a day recently.`
    }
    if (coverageAcceleration === 'decelerating') {
      return `New mentions fell to ${coverageToday} today, against about ${before} a day recently.`
    }
    return null
  })()

  // The live quote wins where there is one. The stored figures were captured
  // when the pipeline ran and are what the ranking was built on — right for
  // scoring, wrong to show, because a card rendering them looked current while
  // being up to a day old. That is why every pick read 0.00%.
  const entry = num(live?.price) || num(price)
  const change = live ? live.changePercent : null
  const priceIsLive = Boolean(live)
  const stop = num(stopLoss)
  const tgt = num(target)
  const priceLabel = money(entry)
  // A plan needs all three legs at real levels — a zero stop is not a stop.
  const hasPlan = entry > 0 && stop > 0 && tgt > 0

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-wall-surface transition-colors duration-motion-short ${
        open ? 'border-ink/[0.12]' : 'border-ink/[0.06] hover:border-ink/[0.10]'
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3.5 px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/20 sm:gap-4 sm:px-5 sm:py-5"
      >
        <span className="relative shrink-0">
          <CompanyLogo symbol={ticker} size={44} />
          <span className="absolute -bottom-1 -right-1 flex h-[19px] w-[19px] items-center justify-center rounded-full bg-wall-elevated text-[10.5px] font-semibold text-ink/70 ring-2 ring-wall-surface">
            {rank}
          </span>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[19px] font-semibold tracking-[-0.02em] text-ink">{ticker}</span>
            {setupType && (
              <span className="rounded-md bg-ink/[0.07] px-2 py-0.5 text-[11.5px] font-medium text-ink/55">
                {SETUP_LABELS[setupType] || setupType}
              </span>
            )}
          </div>
          <div className="mt-2">
            <SourceChips sources={sources} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3.5 sm:gap-5">
          {priceLabel && (
            <ChangedValue
              as="div"
              value={`${entry}:${change}`}
              className="-mx-1 rounded px-1 text-right"
            >
              <p className="text-[17px] font-semibold tabular leading-none text-ink">{priceLabel}</p>
              {/* A flat day and a missing quote must not render identically —
                  showing 0.00% for "we do not know" is what made every card
                  look like nothing had moved. */}
              {change != null ? (
                <p className={`mt-1.5 text-[13px] font-semibold tabular leading-none ${
                  change > 0 ? 'text-gain' : change < 0 ? 'text-loss' : 'text-ink/45'
                }`}>
                  {change > 0 ? '+' : ''}{change.toFixed(2)}%
                </p>
              ) : (
                <p className="mt-1.5 text-[13px] font-medium leading-none text-ink/30">—</p>
              )}
            </ChangedValue>
          )}
          <ScoreMeter score={conviction} />
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 text-ink/30 transition-transform duration-motion-short ${open ? 'rotate-180' : ''}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="motion-enter space-y-5 border-t border-ink/[0.06] px-4 py-5 sm:px-5 sm:py-6">
          <Section label="Why this one">
            <p className="text-[14.5px] leading-[1.8] text-ink/75">{reason}</p>
          </Section>

          {hasPlan && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { k: 'Buy near', v: money(entry), cls: 'text-ink', bg: 'bg-ink/[0.04]' },
                { k: 'Cut losses at', v: money(stop), cls: 'text-loss', bg: 'bg-loss/[0.07]' },
                { k: 'Take profit at', v: money(tgt), cls: 'text-gain', bg: 'bg-gain/[0.07]' },
              ].map((c) => (
                <div key={c.k} className={`rounded-xl px-3 py-2.5 text-center ${c.bg}`}>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink/45">{c.k}</p>
                  <p className={`mt-1.5 text-[15px] font-semibold tabular ${c.cls}`}>{c.v}</p>
                </div>
              ))}
            </div>
          )}

          {technicals && (technicals.trend || technicals.rsi != null) && (
            <Section label="What the chart shows">
              <div className="flex flex-wrap gap-1.5">
                {technicals.trend && (
                  <span className="rounded-md border border-ink/[0.08] px-2.5 py-1.5 text-[12.5px] text-ink/60">
                    {TREND_LABELS[technicals.trend] || technicals.trend}
                  </span>
                )}
                {technicals.rsi != null && (
                  <span className="rounded-md border border-ink/[0.08] px-2.5 py-1.5 text-[12.5px] text-ink/55">
                    {technicals.rsi >= 70 ? 'Possibly overbought' : technicals.rsi <= 30 ? 'Possibly oversold' : 'Neither cheap nor stretched'}
                    <span className="ml-1.5 font-mono text-ink/30">{technicals.rsi}</span>
                  </span>
                )}
                {technicals.pctFrom52wHigh != null && (
                  <span className="rounded-md border border-ink/[0.08] px-2.5 py-1.5 text-[12.5px] text-ink/55">
                    <span className="font-mono">{Math.abs(technicals.pctFrom52wHigh)}%</span> below its 12-month high
                  </span>
                )}
                {technicals.relativeVolume > 1.3 && (
                  <span className="rounded-md border border-ink/[0.08] px-2.5 py-1.5 text-[12.5px] text-ink/55">
                    <span className="font-mono">{technicals.relativeVolume}×</span> its normal volume
                  </span>
                )}
              </div>
            </Section>
          )}

          {bearCase && (
            <div className="rounded-xl bg-loss/[0.05] px-3.5 py-3">
              <Section
                label="What could go wrong"
                trailing={riskScore != null && <ScoreMeter score={riskScore} tone="risk" />}
              >
                <p className="text-[13.5px] leading-[1.8] text-ink/65">{bearCase}</p>
              </Section>
            </div>
          )}

          {/* The model's confidence and the chart don't always agree — shown as
              its own callout rather than silently blended into one score,
              because the conflict itself is the useful information. */}
          {technicalAgreement === 'conflict' && disagreementNote && (
            <div className="rounded-xl bg-warning/[0.08] px-3.5 py-3">
              <Section label="The chart disagrees">
                <p className="text-[13.5px] leading-[1.8] text-ink/65">{disagreementNote}</p>
              </Section>
            </div>
          )}

          {coverageNote && (
            <div className="rounded-xl bg-ink/[0.03] px-3.5 py-3">
              <Section label="How much it is being talked about">
                <p className="text-[13.5px] leading-[1.8] text-ink/65">{coverageNote}</p>
              </Section>
            </div>
          )}

          {catalystVerified != null && (
            <div className={`rounded-xl px-3.5 py-3 ${catalystVerified ? 'bg-gain/[0.05]' : 'bg-ink/[0.03]'}`}>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className={`text-[10px] font-semibold uppercase tracking-[0.1em] ${catalystVerified ? 'text-gain/80' : 'text-ink/35'}`}>
                  {catalystVerified ? 'We confirmed this event' : "We couldn't confirm this event"}
                </span>
                {catalystTimeline && <span className="text-[10.5px] text-ink/35">{catalystTimeline}</span>}
                {catalystPricedIn && (
                  <span className="rounded-md bg-ink/[0.06] px-1.5 py-0.5 text-[9.5px] font-medium text-ink/40">Market likely expects it</span>
                )}
              </div>
              {catalystDetail && <p className="text-[13.5px] leading-[1.8] text-ink/65">{catalystDetail}</p>}
            </div>
          )}

          {/* Evidence trail, so the score above is auditable rather than asserted. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-ink/[0.05] pt-3.5 text-[12px] text-ink/40">
            <span>
              Found by {sources.length} source{sources.length === 1 ? '' : 's'} that don't share a feed
              {signalCount > 0 && ` · ${signalCount} mention${signalCount === 1 ? '' : 's'}`}
            </span>
            {themes.length > 0 && (
              <span className="text-ink/25">About: {themes.slice(0, 4).join(', ')}</span>
            )}
            {/* This said "Price checked just now" regardless, on a figure written
                once by the overnight run — false for the entire life of the
                payload. It now says which of the two it is. */}
            {priceIsLive
              ? <span className="text-ink/25">Price live</span>
              : quoteVerified && <span className="text-ink/25">Price from {runLabel(generatedAt)}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
