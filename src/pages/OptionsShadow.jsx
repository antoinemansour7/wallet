import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { OPTIONS_API, useOptionsResource } from './options/useOptionsResource'
import { money, number, percent, iv, stateLabel, timestamp, words } from './options/display'
import CandidateDetails from './options/CandidateDetails'
import { DTE_COHORTS, ROW_STATUSES, SCORE_BANDS, checkpointFor, filterShadowRows, summarizeShadowRows } from './options/shadowSummary'
import '../components/landing/tokens.css'
import './Options.css'

const ROW_STATUS_LABELS = { open: 'Open', completed: 'Completed · +10 sessions observed', expired: 'Expired', missing: 'Outcome data missing' }
const DAY_STATUS_LABELS = { candidates: 'Candidates', empty: 'Valid empty', degraded: 'Degraded', missing: 'No scan recorded', pending: 'Not yet published' }
const UNKNOWN = {
  unexpired_horizon: 'Not yet due', missing_exit_quote: 'Not captured', provider_snapshot_absent: 'Provider omitted the quote',
  stale_quote: 'Quote too old', zero_bid: 'Zero bid', insufficient_size: 'No displayed size', invalid_quote: 'Invalid quote',
  contract_expired_before_endpoint: 'Contract expired first', unknown_expiry_session: 'Expiry session unknown', unavailable: 'Unavailable',
}

function outcomeText(point) {
  if (!point) return 'No observed checkpoint yet'
  if (Number.isFinite(point.returnPct)) return <><strong>{percent(point.returnPct)}</strong> ask entry → observed bid</>
  return `${UNKNOWN[point.status] || words(point.status)} · unknown`
}

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

function Checkpoints({ row }) {
  return <div className="options-table-wrap" tabIndex={0} role="region" aria-label={`${row.ticker} checkpoints`}><table>
    <caption>Observed checkpoints. Unknown checkpoints are never counted as zero.</caption>
    <thead><tr>{['Checkpoint', 'Scheduled', 'Ask → bid return', 'Stock move', 'IV change'].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
    <tbody>{row.checkpoints.map((point) => <tr key={point.key}><th scope="row">{point.label}</th><td>{point.scheduledAt ? timestamp(point.scheduledAt) : 'Not scheduled'}</td>
      <td>{Number.isFinite(point.returnPct) ? percent(point.returnPct) : `${UNKNOWN[point.status] || words(point.status)} · unknown`}</td>
      <td>{percent(point.underlyingMovePct)}</td><td>{Number.isFinite(point.ivChange) ? `${point.ivChange > 0 ? '+' : ''}${(point.ivChange * 100).toFixed(1)} pts` : 'Unavailable'}</td></tr>)}</tbody>
  </table></div>
}

function Tracked({ row, horizon }) {
  if (row.status === 'missing') return <p>Outcome unavailable: {words(row.reason)}. The pick stays in every count.</p>
  const focus = horizon === 'latest' ? (row.latest && checkpointFor(row, row.latest.key)) : checkpointFor(row, horizon)
  const hits = row.targets.filter((target) => target.state === 'observed_hit')
  return <>
    <p>{horizon === 'latest' ? (row.latest ? `Latest · ${row.latest.label}` : 'Latest') : focus?.label}: {outcomeText(focus)}</p>
    {focus && Number.isFinite(focus.returnPct) && <p>Stock {percent(focus.underlyingMovePct)} · IV {Number.isFinite(focus.ivChange) ? `${focus.ivChange > 0 ? '+' : ''}${(focus.ivChange * 100).toFixed(1)} pts` : 'change unavailable'}</p>}
    <p>Best observed return {percent(row.path.maximumObservedReturnPct)} · largest observed drawdown {percent(row.path.maximumAdverseExcursionPct)}</p>
    <p>{hits.length ? hits.map((target) => `+${target.targetPct}% target ${number(target.minutesToTarget / 60, 1)} h after entry${target.whileOtm === true ? ' while OTM' : ''}`).join(' · ') : 'No premium target observed'}</p>
    <p>{row.gainedWhileOtm === true ? 'Gained while still OTM' : row.gainedWhileOtm === false ? 'No observed gain while OTM' : 'Gain while OTM unknown'} · ITM crossing {row.path.itmCrossing === 'observed_itm' ? 'observed' : 'unknown'}</p>
    <p className="options-muted">{row.path.observed} of {row.path.scheduled} scheduled samples observed so far · every {row.path.resolutionMinutes} minutes</p>
  </>
}

function ShadowRow({ row, horizon, request }) {
  const contract = { type: row.direction, strikePrice: row.strikePrice, expirationDate: row.expirationDate }
  return <article className="options-candidate" aria-label={`${row.ticker} ${row.direction} from ${row.tradingDate}`}>
    <div className="options-row">
      <div className="options-identity"><span className="options-label">{row.tradingDate} · #{row.rank} · {words(row.direction)}</span><h2>{row.ticker}</h2>
        <p>{money(row.strikePrice)} · <span className="options-expiry">{row.expirationDate || 'Expiry unavailable'}</span></p>
        <p>{row.dteAtSelection ?? 'Unknown'} DTE at selection</p>
        <p><strong>{number(row.score, 1)}</strong> / 100 <span className="options-muted">research score</span></p>
      </div>
      <div className="options-observed"><span className="options-label">Frozen at selection · {stateLabel(row.frozen.dataState)}</span>
        <p><strong>{money(row.frozen.ask)}</strong> ask <span className="options-muted">entry, USD / share</span></p>
        <p>Mid {money(row.frozen.mid)} · Bid {money(row.frozen.bid)}</p>
        <p>Stock {money(row.frozen.underlyingPrice)} · IV {iv(row.frozen.iv)}</p>
        <time dateTime={row.frozen.quoteMarketAt}>{timestamp(row.frozen.quoteMarketAt)}</time>
      </div>
      <div className="options-modeled options-tracked"><span className="options-label">Tracked outcome · {ROW_STATUS_LABELS[row.status]}</span>
        <Tracked row={row} horizon={horizon} />
      </div>
    </div>
    <CandidateDetails candidate={{ contractId: row.contractId, contract }} manifestId={row.manifestId} request={request} refreshable={false}
      leading={row.status === 'missing' ? [] : [['Checkpoints', () => <Checkpoints row={row} />]]} />
  </article>
}

function Summary({ summary, horizon }) {
  return <section className="options-summary" aria-label="Shadow cohort summary">
    <h2>Cohort summary · {plural(summary.published, 'pick')} in view</h2>
    <div className="options-table-wrap" tabIndex={0} role="region" aria-label="Outcomes by checkpoint"><table>
      <caption>Denominator: picks whose checkpoint has passed. Unknown outcomes are excluded from medians and means, never counted as zero.</caption>
      <thead><tr>{['Checkpoint', 'Observed / passed', 'Positive · negative', 'Median', 'Mean', 'Best', 'Worst'].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>{summary.horizons.map((item) => <tr key={item.key} className={item.key === horizon ? 'options-focus' : undefined}>
        <th scope="row">{item.label}</th>
        <td>{item.observed} of {item.matured}{item.unknown ? <small>{item.unknown} unknown</small> : null}</td>
        <td>{item.observed ? `${item.positive} · ${item.negative}` : '—'}</td>
        <td>{item.observed ? percent(item.medianReturnPct) : '—'}</td><td>{item.observed ? percent(item.meanReturnPct) : '—'}</td>
        <td>{item.best ? `${item.best.ticker} ${words(item.best.direction)} ${percent(item.best.returnPct)}` : '—'}</td>
        <td>{item.worst ? `${item.worst.ticker} ${words(item.worst.direction)} ${percent(item.worst.returnPct)}` : '—'}</td>
      </tr>)}</tbody>
    </table></div>
    <p>{summary.targets.length ? summary.targets.map((target) => `+${target.targetPct}% premium target: ${target.hits} of ${plural(target.covered, 'pick')} with observed paths (${target.hitsWhileOtm} while OTM)`).join(' · ') : 'No premium targets observed yet.'}</p>
    <p>Gained while still OTM: {summary.gainedWhileOtm.count} of {plural(summary.gainedWhileOtm.determinable, 'pick')} where it can be determined.</p>
    <p className="options-muted">{ROW_STATUSES.map((status) => `${summary.statusCounts[status]} ${ROW_STATUS_LABELS[status].split(' · ')[0].toLowerCase()}`).join(' · ')}</p>
  </section>
}

function Progress({ data }) {
  const { window: progress, days, targetSessions } = data
  return <section className="options-progress" aria-label="Shadow-test progress">
    <p className="options-progress-count"><strong>{progress.completed ? `${progress.session} sessions` : `Session ${progress.session} of ${targetSessions}`}</strong>
      {progress.completed ? ' · validation window complete' : ''}</p>
    <dl className="options-facts">
      <div><dt>Started</dt><dd>{progress.startDate}</dd></div>
      <div><dt>Latest observation</dt><dd>{progress.latestObservationDate || 'None captured yet'}</dd></div>
      <div><dt>Published picks</dt><dd>{progress.publishedCandidates}</dd></div>
      <div><dt>Scan days</dt><dd>{progress.dayCounts.candidates} with picks · {progress.dayCounts.empty} empty · {progress.dayCounts.degraded} degraded · {progress.dayCounts.missing} missing</dd></div>
    </dl>
    <details className="options-operation"><summary>Every session in the window</summary>
      <ol className="options-days" aria-label="Sessions in the window">{days.map((day) => <li key={day.tradingDate} data-status={day.status}><span>{day.tradingDate}</span> {DAY_STATUS_LABELS[day.status]}{day.candidates ? ` · ${plural(day.candidates, 'pick')}` : ''}</li>)}</ol>
    </details>
  </section>
}

function Select({ label, value, onChange, options }) {
  return <label>{label} <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
}

function Dashboard({ user }) {
  const { verified, denied, busy, data: response, error, request, reload } = useOptionsResource(user, `${OPTIONS_API}&view=shadow`)
  const [filters, setFilters] = useState({ date: 'all', ticker: 'all', direction: 'all', score: 'all', dte: 'all', horizon: 'latest', status: 'all' })
  const data = response?.shadow
  const rows = useMemo(() => filterShadowRows(data?.rows || [], filters), [data, filters])
  const summary = useMemo(() => summarizeShadowRows(rows, data?.checkpoints || []), [rows, data])
  if (denied) return <Navigate to="/portfolio" replace />
  if (!verified) return error ? <Navigate to="/portfolio" replace /> : null
  const set = (key) => (value) => setFilters((old) => ({ ...old, [key]: value }))
  const tickers = [...new Set((data?.rows || []).map((row) => row.ticker))].sort()
  return <div className="wallai-system options-workspace">
    <header className="options-header"><div><span className="options-label">Private research · Options · Shadow test · Experimental</span><h1>Shadow test</h1>
      <p>How published picks performed afterwards, observed without trading.</p></div>
      <nav aria-label="Options pages"><Link to="/options">Morning opportunities ↗</Link></nav></header>
    <p className="options-notice" role="note">Experimental. Observed returns are historical research outcomes from indicative quotes. They are not live recommendations, fills or proof of profitability, and {data?.targetSessions || 20} sessions cannot establish an edge.</p>
    <div className="options-toolbar"><p>Checked {timestamp(data?.checkedAt)} · read-only</p><button type="button" onClick={reload} disabled={busy}>{busy ? 'Loading…' : 'Reload'}</button></div>
    {error && <p className="options-notice" role="alert">{error.message}{error.referenceId && <small>Reference: {error.referenceId}</small>}</p>}
    {data && !data.window && <div className="options-empty"><h2>The shadow test has not started</h2><p>No published morning is archived yet. Progress, outcomes and summaries appear after the first published scan.</p></div>}
    {data?.window && <>
      <Progress data={data} />
      <div className="options-filters options-shadow-filters">
        <Select label="Trading date" value={filters.date} onChange={set('date')} options={[['all', 'All dates'], ...data.days.map((day) => [day.tradingDate, day.tradingDate])]} />
        <Select label="Ticker" value={filters.ticker} onChange={set('ticker')} options={[['all', 'All tickers'], ...tickers.map((ticker) => [ticker, ticker])]} />
        <Select label="Direction" value={filters.direction} onChange={set('direction')} options={[['all', 'Calls & puts'], ['call', 'Calls'], ['put', 'Puts']]} />
        <Select label="Score band" value={filters.score} onChange={set('score')} options={[['all', 'All scores'], ...SCORE_BANDS.map((band) => [band.id, band.label])]} />
        <Select label="DTE at selection" value={filters.dte} onChange={set('dte')} options={[['all', 'All DTE'], ...DTE_COHORTS.map((cohort) => [cohort.id, cohort.label])]} />
        <Select label="Outcome horizon" value={filters.horizon} onChange={set('horizon')} options={[['latest', 'Latest observed'], ...data.checkpoints.map((point) => [point.key, point.label])]} />
        <Select label="Status" value={filters.status} onChange={set('status')} options={[['all', 'All statuses'], ...ROW_STATUSES.map((status) => [status, ROW_STATUS_LABELS[status].split(' · ')[0]])]} />
      </div>
      <Summary summary={summary} horizon={filters.horizon} />
      <div className="options-list-head"><h2>{plural(rows.length, 'published pick')}</h2></div>
      {!rows.length && <div className="options-empty"><h2>No picks match these filters</h2><p>Empty and degraded scan days are listed under progress; they published no picks.</p></div>}
      {rows.map((row) => <ShadowRow key={row.id} row={row} horizon={filters.horizon} request={request} />)}
      <details className="options-operation"><summary>Limitations</summary><ul>{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>
    </>}
  </div>
}

export default function OptionsShadow() {
  const { user } = useAuth()
  return <Dashboard key={user?.uid || 'signed-out'} user={user} />
}
