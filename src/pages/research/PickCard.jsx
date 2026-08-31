import { useState } from 'react'
import CompanyLogo from '../../components/CompanyLogo'

// ─── Labels ────────────────────────────────────────────────────────────────────

const SETUP_LABELS = {
  squeeze: 'Squeeze', breakout: 'Breakout', volume: 'Volume',
  catalyst: 'Catalyst', momentum: 'Momentum',
}

const TREND_LABELS = {
  uptrend: 'Uptrend', 'overbought-uptrend': 'Overbought', recovery: 'Recovery',
  consolidating: 'Consolidating', pullback: 'Pullback', downtrend: 'Downtrend',
  'oversold-downtrend': 'Oversold', mixed: 'Mixed',
}

// The raw source strings are internal identifiers. "exa-discovery" and
// "AVGO catalyst search" mean something to the pipeline and nothing to a reader.
function sourceLabel(source) {
  const s = String(source)
  if (s.startsWith('@')) return s
  if (s === 'finviz') return 'Screener'
  if (s === 'exa-discovery') return 'Media'
  if (s.endsWith('catalyst search')) return 'Catalyst search'
  if (s.endsWith('search')) return 'Search'
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

export default function PickCard({ pick, rank, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const {
    ticker, conviction, reason, setupType, sources = [], themes = [],
    signalCount, technicals, bearCase, riskScore, quoteVerified,
    catalystVerified, catalystDetail, catalystTimeline, catalystPricedIn,
    price, quoteChangePercent, stopLoss, target,
  } = pick

  const change = num(quoteChangePercent)
  const entry = num(price)
  const stop = num(stopLoss)
  const tgt = num(target)
  const priceLabel = money(entry)
  // A plan needs all three legs at real levels — a zero stop is not a stop.
  const hasPlan = entry > 0 && stop > 0 && tgt > 0

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-wall-surface transition-colors duration-200 ${
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
            <div className="text-right">
              <p className="text-[17px] font-semibold tabular leading-none text-ink">{priceLabel}</p>
              {change != null && (
                <p className={`mt-1.5 text-[13px] font-semibold tabular leading-none ${change >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                </p>
              )}
            </div>
          )}
          <ScoreMeter score={conviction} />
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 text-ink/30 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="space-y-5 border-t border-ink/[0.06] px-4 py-5 sm:px-5 sm:py-6">
          <Section label="Thesis">
            <p className="text-[14.5px] leading-[1.8] text-ink/75">{reason}</p>
          </Section>

          {hasPlan && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { k: 'Entry', v: money(entry), cls: 'text-ink', bg: 'bg-ink/[0.04]' },
                { k: 'Stop', v: money(stop), cls: 'text-loss', bg: 'bg-loss/[0.07]' },
                { k: 'Target', v: money(tgt), cls: 'text-gain', bg: 'bg-gain/[0.07]' },
              ].map((c) => (
                <div key={c.k} className={`rounded-xl px-3 py-2.5 text-center ${c.bg}`}>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink/45">{c.k}</p>
                  <p className={`mt-1.5 text-[15px] font-semibold tabular ${c.cls}`}>{c.v}</p>
                </div>
              ))}
            </div>
          )}

          {technicals && (technicals.trend || technicals.rsi != null) && (
            <Section label="Technicals">
              <div className="flex flex-wrap gap-1.5">
                {technicals.trend && (
                  <span className="rounded-md border border-ink/[0.08] px-2.5 py-1.5 text-[12.5px] text-ink/60">
                    {TREND_LABELS[technicals.trend] || technicals.trend}
                  </span>
                )}
                {technicals.rsi != null && (
                  <span className="rounded-md border border-ink/[0.08] px-2.5 py-1.5 font-mono text-[12.5px] text-ink/55">
                    RSI {technicals.rsi}
                  </span>
                )}
                {technicals.pctFrom52wHigh != null && (
                  <span className="rounded-md border border-ink/[0.08] px-2.5 py-1.5 font-mono text-[12.5px] text-ink/55">
                    {technicals.pctFrom52wHigh}% from high
                  </span>
                )}
                {technicals.relativeVolume > 1.3 && (
                  <span className="rounded-md border border-ink/[0.08] px-2.5 py-1.5 font-mono text-[12.5px] text-ink/55">
                    {technicals.relativeVolume}× vol
                  </span>
                )}
              </div>
            </Section>
          )}

          {bearCase && (
            <div className="rounded-xl bg-loss/[0.05] px-3.5 py-3">
              <Section
                label="Bear case"
                trailing={riskScore != null && <ScoreMeter score={riskScore} tone="risk" />}
              >
                <p className="text-[13.5px] leading-[1.8] text-ink/65">{bearCase}</p>
              </Section>
            </div>
          )}

          {catalystVerified != null && (
            <div className={`rounded-xl px-3.5 py-3 ${catalystVerified ? 'bg-gain/[0.05]' : 'bg-ink/[0.03]'}`}>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className={`text-[10px] font-semibold uppercase tracking-[0.1em] ${catalystVerified ? 'text-gain/80' : 'text-ink/35'}`}>
                  {catalystVerified ? 'Catalyst verified' : 'Unverified catalyst'}
                </span>
                {catalystTimeline && <span className="text-[10.5px] text-ink/35">{catalystTimeline}</span>}
                {catalystPricedIn && (
                  <span className="rounded-md bg-ink/[0.06] px-1.5 py-0.5 text-[9.5px] font-medium text-ink/40">Priced in</span>
                )}
              </div>
              {catalystDetail && <p className="text-[13.5px] leading-[1.8] text-ink/65">{catalystDetail}</p>}
            </div>
          )}

          {/* Evidence trail, so the score above is auditable rather than asserted. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-ink/[0.05] pt-3.5 text-[12px] text-ink/40">
            <span>
              {sources.length} independent source{sources.length === 1 ? '' : 's'}
              {signalCount > 0 && ` · ${signalCount} signal${signalCount === 1 ? '' : 's'}`}
            </span>
            {themes.length > 0 && <span className="text-ink/25">{themes.slice(0, 4).join(' · ')}</span>}
            {quoteVerified && <span className="text-ink/25">price verified live</span>}
          </div>
        </div>
      )}
    </div>
  )
}
