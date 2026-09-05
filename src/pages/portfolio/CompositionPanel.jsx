import { Fragment, useMemo, useRef, useState } from 'react'
import { fmtCurrency, fmtPct } from '../../utils/portfolioStats'
import CompanyLogo from '../../components/CompanyLogo'
import { analyticsScopes } from './chartAnalytics'
import { compositionHoldings, sortComposition } from './compositionHoldings'
import './CompositionPanel.css'

const SORTS = { value: 'Market value', pnl: 'Total return ($)', pnlPct: 'Total return (%)', day: 'Today ($)', dayPct: 'Today (%)', cost: 'Cost basis', symbol: 'Name' }
const shares = (value) => new Intl.NumberFormat('en-CA', { maximumFractionDigits: 8 }).format(value)
const money = (value) => value == null ? '—' : fmtCurrency(value)
const signed = (value) => value == null ? '—' : `${value < 0 ? '−' : '+'}${fmtCurrency(Math.abs(value))}`
const tone = (value) => value > 0 ? 'own-gain' : value < 0 ? 'own-loss' : 'own-neutral'

function ReturnValue({ value, percent }) {
  return <span className={`own-return ${tone(value)}`}><strong>{signed(value)}</strong><small>{percent == null ? value == null ? 'Unavailable' : '—' : fmtPct(percent)}</small></span>
}

export default function CompositionPanel({ rows = [], accounts = [] }) {
  const [currency, setCurrency] = useState('CAD')
  const [sort, setSort] = useState({ field: 'value', direction: 'desc' })
  const [showAll, setShowAll] = useState(false)
  const [active, setActive] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [mobileReturn, setMobileReturn] = useState('total')
  const rowButtons = useRef(new Map())
  const scopes = useMemo(() => analyticsScopes(accounts.length ? accounts : [{ accountNumber: '', positions: rows, cash: 0 }]), [accounts, rows])
  const scope = scopes.find((item) => item.currency === currency) || scopes[0]
  const holdings = useMemo(() => compositionHoldings(scope?.rows || []), [scope])
  const total = holdings.reduce((sum, item) => sum + item.value, 0)
  const cost = holdings.every((item) => item.cost != null) ? holdings.reduce((sum, item) => sum + item.cost, 0) : null
  const ranked = holdings.map((item, index) => ({ ...item, rank: index + 1, weight: item.value / total * 100, color: index < 3 ? 'var(--own-allocation-fill)' : 'var(--own-allocation-rest)' }))
  const sorted = sortComposition(ranked, sort.field, sort.direction)
  const visible = showAll ? sorted : sorted.slice(0, 8)
  const remainder = ranked.slice(3)
  const topCount = Math.min(3, ranked.length)
  const topWeight = ranked.slice(0, 3).reduce((sum, item) => sum + item.weight, 0)
  const segments = [...ranked.slice(0, 3), ...(remainder.length ? [{ id: 'other-holdings', symbol: `Other ${remainder.length}`, value: remainder.reduce((sum, item) => sum + item.value, 0), weight: remainder.reduce((sum, item) => sum + item.weight, 0), color: 'var(--own-allocation-rest)', isRest: true }] : [])]
  const selected = ranked.find((item) => item.id === active) || segments.find((item) => item.id === active)
  // Shared by the bar and its legend below: one `fr` track per segment, in the
  // same order, on both grids. Grid's track sizing is a pure function of the
  // column list and the container width — unlike matching flexGrow across two
  // separate flex rows, it isn't perturbed by what a track's own content does
  // internally, so the same track list on both containers is what actually
  // guarantees the legend lines up under its segment rather than approximating it.
  const columnTracks = segments.map((segment) => `${segment.weight}fr`).join(' ')
  const accountItems = [...(scope?.accounts || [])].sort((a, b) => b.value - a.value)
  const accountTotal = accountItems.reduce((sum, item) => sum + item.value, 0)

  const changeSort = (field) => setSort((current) => ({ field, direction: current.field === field ? current.direction === 'desc' ? 'asc' : 'desc' : field === 'symbol' ? 'asc' : 'desc' }))
  const selectSegment = (segment) => {
    setShowAll(true)
    const id = segment.isRest ? remainder[0]?.id : segment.id
    setActive(id)
    requestAnimationFrame(() => {
      const button = rowButtons.current.get(id)
      button?.focus({ preventScroll: true })
      button?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    })
  }
  const sortHeader = (label, field, className = '') => {
    const chosen = sort.field === field || (field === 'pnl' && sort.field === 'pnlPct') || (field === 'day' && sort.field === 'dayPct')
    return <th scope="col" className={className} aria-sort={chosen ? sort.direction === 'desc' ? 'descending' : 'ascending' : 'none'}><button type="button" onClick={() => changeSort(field)} aria-label={`Sort by ${label.toLowerCase()}`}>{label}<span aria-hidden="true" className={chosen ? 'is-sorted' : ''}>{chosen ? sort.direction === 'desc' ? '↓' : '↑' : '↕'}</span></button></th>
  }

  return <section className="ownership-panel" aria-labelledby="ownership-title" data-mobile-return={mobileReturn}>
    <header className="own-header">
      <div><h2 id="ownership-title">What you own</h2><p>{holdings.length} holding{holdings.length === 1 ? '' : 's'}<span>·</span>Cash excluded</p></div>
      <div className="own-balance"><strong>{money(total)} <small>{scope?.currency || ''}</small></strong><p>Cost basis <span>{money(cost)}</span></p></div>
    </header>

    {holdings.length ? <div className="own-concentration">
      <div className="own-concentration-heading"><span>{topCount === 1 ? 'Largest holding' : `Top ${topCount} holdings`}</span><span><strong>{topWeight.toFixed(1)}%</strong> of investments</span></div>
      <div className="own-allocation" style={{ gridTemplateColumns: columnTracks }} aria-label="Holdings allocation" onMouseLeave={() => setActive(null)}>{segments.map((segment) => <button type="button" key={segment.id} style={{ background: segment.color }} onMouseEnter={() => setActive(segment.id)} onFocus={() => setActive(segment.id)} onBlur={() => setActive(null)} onClick={() => selectSegment(segment)} data-muted={active != null && active !== segment.id && !(segment.isRest && selected?.rank > 3)} aria-label={`${segment.symbol}, ${segment.weight.toFixed(1)}% of holdings. Show in list.`} />)}</div>
      {/* Same column tracks as the bar above, so the legend reads as the bar's
          own labels rather than a caption laid out independently of it — a
          wide slice gets a wide label, lined up under it exactly. */}
      <div className="own-allocation-legend" style={{ gridTemplateColumns: columnTracks }} onMouseLeave={() => setActive(null)}>{segments.map((segment) => <button key={segment.id} type="button" onMouseEnter={() => setActive(segment.id)} onFocus={() => setActive(segment.id)} onBlur={() => setActive(null)} onClick={() => selectSegment(segment)} data-active={active === segment.id || (segment.isRest && selected?.rank > 3)} aria-label={`${segment.symbol}, ${segment.weight.toFixed(1)}% of holdings. Show in list.`}><span className="own-legend-name">{segment.symbol}</span><span>{segment.weight.toFixed(1)}%</span></button>)}</div>
    </div> : <p className="own-empty">Your holdings will appear here when investments are added to this portfolio.</p>}

    <div className="own-toolbar">
      <div className="own-return-switch" role="group" aria-label="Return shown on mobile"><button type="button" aria-pressed={mobileReturn === 'total'} onClick={() => setMobileReturn('total')}>Total return</button><button type="button" aria-pressed={mobileReturn === 'day'} onClick={() => setMobileReturn('day')}>Today</button></div>
      <div className="own-toolbar-label">Your holdings <span>{holdings.length}</span></div>
      <div className="own-controls">{scopes.length > 1 && <label><span className="sr-only">Holdings currency</span><select aria-label="Holdings currency" value={scope.currency} onChange={(event) => { setCurrency(event.target.value); setActive(null); setExpanded(null); setShowAll(false) }}>{scopes.map((item) => <option key={item.currency}>{item.currency}</option>)}</select></label>}<label className="own-sort-select"><span>Sort by</span><select aria-label="Sort holdings" value={sort.field} onChange={(event) => changeSort(event.target.value)}>{Object.entries(SORTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button type="button" className="own-sort-direction" aria-label={sort.direction === 'desc' ? 'Sort ascending' : 'Sort descending'} onClick={() => changeSort(sort.field)}>{sort.direction === 'desc' ? '↓' : '↑'}</button></div>
    </div>

    {holdings.length > 0 && <table className="own-table"><caption className="sr-only">Holdings in {scope.currency}. Total return is unrealized gain or loss on current holdings. Cash is excluded.</caption><thead><tr>{sortHeader('Investment', 'symbol', 'own-asset-col')}{sortHeader('Market value', 'value', 'own-value-col')}{sortHeader('Today', 'day', 'own-day-col')}{sortHeader('Total return', 'pnl', 'own-total-col')}{sortHeader('Cost basis', 'cost', 'own-cost-col')}</tr></thead><tbody>{visible.map((item) => <Fragment key={item.id}>
      <tr className="own-holding" data-active={active === item.id} data-largest={item.rank <= 3} onMouseEnter={() => setActive(item.id)} onMouseLeave={() => setActive(null)}>
        <th scope="row" className="own-asset-col"><button type="button" className="own-asset" ref={(element) => { if (element) rowButtons.current.set(item.id, element); else rowButtons.current.delete(item.id) }} onClick={() => setExpanded(expanded === item.id ? null : item.id)} onFocus={() => setActive(item.id)} onBlur={() => setActive(null)} aria-expanded={expanded === item.id} aria-label={`View ${item.symbol} details`}><span className="own-row-marker" /><CompanyLogo symbol={item.symbol} description={item.description} size={36} /><span className="own-asset-copy"><strong>{item.symbol}<span aria-hidden="true" className="own-detail-arrow">{expanded === item.id ? '−' : '+'}</span></strong><small title={item.description}>{item.description || 'Investment'}</small></span></button></th>
        <td className="own-value-col"><strong className="own-market-value">{money(item.value)}</strong><span className="own-weight">{item.weight.toFixed(1)}%<span className="own-weight-label"> of holdings</span></span></td>
        <td className="own-day-col"><ReturnValue value={item.day} percent={item.dayPct} /></td>
        <td className="own-total-col"><ReturnValue value={item.pnl} percent={item.pnlPct} /></td>
        <td className="own-cost-col"><span className="own-cost">{money(item.cost)}</span><small className="own-quantity">{item.quantity == null ? 'Shares unavailable' : `${shares(item.quantity)} shares`}</small></td>
      </tr>
      {expanded === item.id && <tr className="own-detail-row"><td colSpan={5}><div className="own-detail"><p>{item.description || item.symbol}</p><dl><div><dt>Shares</dt><dd>{item.quantity == null ? '—' : shares(item.quantity)}</dd></div><div><dt>Cost basis</dt><dd>{money(item.cost)}</dd></div><div><dt>Average cost / share</dt><dd>{money(item.averageCost)}</dd></div><div><dt>Today</dt><dd><ReturnValue value={item.day} percent={item.dayPct} /></dd></div><div><dt>Total return</dt><dd><ReturnValue value={item.pnl} percent={item.pnlPct} /></dd></div></dl>{item.accounts.length > 0 && <p className="own-held-in">Held in {item.accounts.length === 1 ? 'account' : 'accounts'} <span>{item.accounts.join(' · ')}</span></p>}</div></td></tr>}
    </Fragment>)}</tbody></table>}
    {holdings.length > 8 && <button type="button" className="own-show-all" aria-expanded={showAll} onClick={() => { setShowAll(!showAll); setExpanded(null); setActive(null) }}><span>{showAll ? 'Show fewer holdings' : `View all ${holdings.length} holdings`}</span><span aria-hidden="true">{showAll ? '−' : '+'}</span></button>}
    {holdings.length > 0 && <p className="own-note">Total return is unrealized gain or loss versus cost basis. Today reflects the latest available daily quotes. Missing figures are shown as —.</p>}

    {accounts.length > 0 && accountItems.length > 0 && <details className="own-accounts"><summary><span><span className="own-account-icon" aria-hidden="true">▥</span>Across {accountItems.length} account{accountItems.length === 1 ? '' : 's'}</span><span className="own-account-cash">{money(scope.cash)} cash<span aria-hidden="true">⌄</span></span></summary><div className="own-accounts-body"><p>Account balances include investments and cash in {scope.currency}.</p>{accountItems.map((item) => <div className="own-account-row" key={item.accountNumber}><div><strong>{item.accountNumber}</strong><span>{accounts.find((account) => account.accountNumber === item.accountNumber)?.cashSource === 'inferred' ? 'Inferred cash' : 'Cash'} {money(item.cash)}</span></div><div className="own-account-track" aria-hidden="true"><span style={{ width: `${accountTotal > 0 ? Math.max(0, Math.min(100, item.value / accountTotal * 100)) : 0}%` }} /></div><div><strong>{money(item.value)}</strong><span>{accountTotal > 0 ? `${(item.value / accountTotal * 100).toFixed(1)}% of account balances` : '—'}</span></div></div>)}</div></details>}
  </section>
}
