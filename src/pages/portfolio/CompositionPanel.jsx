import { useState } from 'react'
import { fmtCurrency } from '../../utils/portfolioStats'
import CompanyLogo from '../../components/CompanyLogo'
import { EmptyChart } from './EmptyState'
import { getAccountBreakdown, getCompositionSegments, pct } from './helpers'

function RestGlyph({ count }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-ink/20 text-[10px] font-semibold tabular text-ink/40">
      +{count}
    </span>
  )
}

/**
 * One sheet instead of three panels: the whole book as a single strip, the
 * holdings that make it up, and the accounts it is split across. The strip and
 * the list are the same data at two zoom levels, so hovering either one lights
 * up the other — which is also why the rows no longer carry their own little
 * progress bars. The strip already draws every proportion on one shared scale.
 */
export default function CompositionPanel({ rows, accounts }) {
  const [active, setActive] = useState(null)
  const { segments, total, holdingCount } = getCompositionSegments(rows, 7)
  const accountItems = getAccountBreakdown(accounts)
  const accountTotal = accountItems.reduce((sum, item) => sum + item.value, 0)
  const activeSeg = active != null ? segments[active] : null

  return (
    <section className="rounded-card border border-ink/[0.09] bg-wall-surface p-5 shadow-card sm:p-6">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold tracking-tight text-ink">What you own</h2>
        <span className="font-mono text-[11px] tabular text-ink/45">{fmtCurrency(total)}</span>
      </header>

      {segments.length === 0 ? <div className="mt-4"><EmptyChart /></div> : (
        <>
          {/* The strip: one continuous ribbon cut largest-to-smallest. The
              hairline seams are the card showing through a 1px flex gap, so the
              slices read as one bar rather than detached blocks. Height is fixed
              and emphasis is a sheen overlay, so hovering never reflows. */}
          <div
            className="mt-5 flex h-3.5 w-full gap-px overflow-hidden rounded-full"
            onMouseLeave={() => setActive(null)}
          >
            {segments.map((seg, i) => (
              <button
                key={seg.symbol}
                type="button"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                style={{ flexGrow: Math.max(seg.share, 0.5), flexBasis: 0, backgroundColor: seg.color }}
                className={`relative h-full min-w-[3px] outline-none transition-opacity duration-motion-short focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/40 ${
                  active !== null && active !== i ? 'opacity-30' : 'opacity-100'
                }`}
                aria-label={`${seg.symbol}, ${fmtCurrency(seg.value)}, ${seg.share.toFixed(1)}% of holdings`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 bg-gradient-to-b from-white/30 to-transparent transition-opacity duration-motion-short ${
                    active === i ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </button>
            ))}
          </div>

          {/* One readout line, fixed height, so the strip never reflows the
              page as the pointer crosses it. */}
          <p className="mt-3 h-4 truncate text-[11.5px] tabular text-ink/45">
            {activeSeg
              ? `${activeSeg.symbol} · ${fmtCurrency(activeSeg.value)} · ${activeSeg.share.toFixed(1)}%`
              : `${holdingCount} holding${holdingCount === 1 ? '' : 's'}, largest first`}
          </p>

          <div className="mt-3 grid gap-x-8 sm:grid-cols-2" onMouseLeave={() => setActive(null)}>
            {segments.map((seg, i) => {
              const dimmed = active !== null && active !== i
              return (
                <button
                  key={seg.symbol}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition duration-motion-short focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 ${
                    active === i ? 'bg-ink/[0.05]' : dimmed ? 'opacity-45' : 'hover:bg-ink/[0.03]'
                  }`}
                >
                  {/* The row's tie to its segment in the strip above. */}
                  <span className="h-9 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
                  {seg.isRest
                    ? <RestGlyph count={seg.count} />
                    : <CompanyLogo symbol={seg.symbol} description={seg.description} size={32} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{seg.symbol}</p>
                    <p className="truncate text-[11px] text-ink/45">
                      {seg.share.toFixed(1)}% of holdings
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-semibold tabular text-ink">{fmtCurrency(seg.value)}</p>
                    <p className={`text-[11px] tabular ${seg.pnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                      {seg.pnl >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(seg.pnl))}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {accountItems.length > 0 && (
        <div className="mt-7 border-t border-ink/[0.09] pt-6">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/45">
            Split across accounts
          </h3>
          {/* No tiles and no borders — each account is measured by the rule
              above it, which is the same device as the strip at account scale. */}
          <div
            className="mt-4 grid gap-x-8 gap-y-6"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
          >
            {accountItems.map((item) => {
              const share = pct(item.value, accountTotal)
              return (
                <div key={item.account} className="min-w-0">
                  <div className="h-[3px] w-full overflow-hidden rounded-full bg-ink/[0.08]">
                    <div
                      className="h-full rounded-full transition-all duration-motion-long"
                      style={{ width: `${share}%`, backgroundColor: item.color }}
                    />
                  </div>
                  <div className="mt-3 flex items-baseline justify-between gap-2">
                    <p className="truncate text-[12px] font-medium text-ink/60">{item.account}</p>
                    <span className="shrink-0 font-mono text-[11px] tabular text-ink/45">{share.toFixed(1)}%</span>
                  </div>
                  <p className="mt-2 font-display text-[19px] font-medium leading-none tabular text-ink">
                    {fmtCurrency(item.value)}
                  </p>
                  <p className="mt-2 truncate text-[11px] text-ink/45">
                    {/* "holding", not "position" — the strip above this one
                        already says "holding", and this app has exactly one
                        word for a thing you own. */}
                    {item.positions} holding{item.positions === 1 ? '' : 's'}
                    {item.cash !== 0
                      ? ` · ${fmtCurrency(item.cash)} ${item.cashSource === 'explicit' ? 'cash' : 'inferred cash'}`
                      : ''}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
