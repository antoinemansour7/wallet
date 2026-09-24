import { useEffect, useId, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { OPTIONS_API, useOptionsResource } from './options/useOptionsResource'
import { clock, day, driverText, iv, money, morningStatus, move, number, otmLabel, percent, quoteMode, riskLabel, strike, timestamp, words } from './options/display'
import CandidateDetails from './options/CandidateDetails'
import '../components/landing/tokens.css'
import './Options.css'

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const DIRECTIONS = [['all', 'All'], ['call', 'Calls'], ['put', 'Puts']]

function Reference({ error }) {
  return error?.referenceId ? <small>Reference {error.referenceId}</small> : null
}

// One scannable line per contract; everything else waits behind Details.
function CandidateRow({ candidate: row, manifestId, request }) {
  const [open, setOpen] = useState(false)
  const detailId = useId()
  const scenario = row.selectedScenario
  const spread = Number.isFinite(row.observed.spreadPct) ? `${number(row.observed.spreadPct, 1)}%` : 'unavailable'
  return <article className="om-row" aria-label={`${row.ticker} ${row.direction} candidate`}>
    <div className="om-line">
      <span className="om-rank">#{row.rank}</span>
      <div className="om-contract"><h3>{row.ticker} <span className="om-type">{words(row.direction)}</span></h3>
        <p className="om-sub">{row.contract ? `${day(row.contract.expirationDate)} · ${strike(row.contract.strikePrice)} strike` : 'Contract details unavailable'}</p></div>
      <div className="om-quote"><span className="om-k">Observed</span><p><strong>{money(row.observed.ask)}</strong> ask</p><p className="om-sub">Spread {spread}</p></div>
      <div className="om-scenario"><span className="om-k">Modeled</span>
        {scenario ? <><p><strong>{percent(scenario.askEntryModeledBidReturnPct)}</strong></p><p className="om-sub">if stock {move(scenario.movePct)} in {plural(scenario.sessions, 'session')}</p></>
          : <p className="om-sub">Scenario unavailable</p>}</div>
      <div className="om-why"><p>{driverText(row.drivers)}</p><p className="om-risk" data-penalty={row.risk !== 'full_premium_at_risk'}>Risk: {riskLabel(row.risk, row.riskReason)}</p></div>
      <p className="om-score"><strong>{number(row.score, 1)}</strong><span className="om-sub">score</span></p>
      <button type="button" className="om-toggle" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((value) => !value)}>
        Details<span className="om-sr"> for {row.ticker} {row.direction}</span></button>
    </div>
    <div id={detailId} className="om-detail" hidden={!open}>
      <dl className="om-facts">
        <div><dt>Observed quote</dt><dd>Bid {money(row.observed.bid)} · Mid {money(row.observed.mid)} · Ask {money(row.observed.ask)}<small>{timestamp(row.observed.marketAt)}</small></dd></div>
        <div><dt>Modeled scenario</dt><dd>{scenario ? <>Stock {money(scenario.underlyingPrice)} after {number(scenario.calendarElapsedDays, 1)} calendar days · IV {iv(scenario.startingImpliedVolatility)} → {iv(scenario.endingImpliedVolatility)}<small>{otmLabel(scenario, row.contract)} · ask entry, modeled bid exit</small></> : 'Unavailable'}</dd></div>
        <div><dt>Downside</dt><dd>Worst case in the scenario matrix {percent(row.worstReturnPct)}<small>{money(row.premiumAtRisk)} at risk per contract</small></dd></div>
      </dl>
      <CandidateDetails candidate={row} manifestId={manifestId} request={request} />
    </div>
  </article>
}

function Contracts({ candidates, manifestId, request }) {
  const [filter, setFilter] = useState('all')
  const counts = { all: candidates.length, call: 0, put: 0 }
  for (const row of candidates) counts[row.direction] += 1
  // A filter only earns its place when there is something to filter.
  const filterable = counts.call > 0 && counts.put > 0
  const active = filterable ? filter : 'all'
  const rows = candidates.filter((row) => active === 'all' || row.direction === active)
  return <section aria-label="Contracts">
    {filterable && <div className="om-filter" role="group" aria-label="Direction">{DIRECTIONS.map(([id, label]) =>
      <button key={id} type="button" aria-pressed={active === id} onClick={() => setFilter(id)}>{label} <span className="om-count">{counts[id]}</span></button>)}</div>}
    <div className="om-list">
      <div className="om-cols" aria-hidden="true"><span /><span>Contract</span><span>Ask · observed</span><span>Scenario · modeled</span><span>Why it ranked</span><span>Score</span><span /></div>
      {rows.map((row) => <CandidateRow key={`${manifestId}:${row.contractId}`} candidate={row} manifestId={manifestId} request={request} />)}
    </div>
    <p className="om-foot">Scores rank contracts from 0 to 100; they are not probabilities. Modeled returns buy at the ask and sell at a modeled bid after the stated stock move, with IV unchanged. The full premium is at risk.</p>
  </section>
}

function Morning({ data, status, busy, error, pinned, reload, latest, request }) {
  const { morning, candidates = [] } = data
  const scan = status.archived ? `the ${day(morning.tradingDate)} scan` : 'today’s scan'
  const headline = status.kind === 'empty' ? `No contracts passed ${scan}.` : `${plural(candidates.length, 'contract')} passed ${scan}`
  const partialScan = morning.completeness !== 'complete', partialDetail = data.evidenceStatus === 'partial'
  const gaps = partialScan && partialDetail ? 'Part of the watchlist couldn’t be scanned and some saved details are missing, so this list may be incomplete.'
    : partialScan ? 'Part of the watchlist couldn’t be scanned, so this list may be missing contracts.'
      : partialDetail ? 'Some saved details are missing, so a few contracts show less.' : null
  return <>
    <div className="om-status" aria-live="polite">
      <div><h2>{headline}</h2>
        <p className="om-meta">{day(morning.tradingDate)} · <time dateTime={morning.availableAt}>{clock(morning.availableAt)}</time> · {quoteMode(morning.observationMode)} · {morning.completeness === 'complete' ? 'Complete' : 'Partial scan'}{morning.revision > 1 ? ` · Revision ${morning.revision}` : ''}</p>
        {status.kind === 'empty' && <p className="om-meta">Nothing cleared the liquidity, pricing and risk filters.</p>}</div>
      <div className="om-actions">
        <button type="button" className="om-quiet" onClick={reload} disabled={busy}>{busy ? 'Loading…' : 'Reload'}</button>
        {pinned && <button type="button" className="om-quiet" onClick={latest} disabled={busy}>{status.archived ? 'Back to today' : 'Latest scan'}</button>}
      </div>
    </div>
    {status.archived && <p className="om-notice" role="status">You’re viewing an earlier scan; its quotes are from {day(morning.tradingDate)}.</p>}
    {status.kind === 'today' && status.lifecycle === 'stale' && <p className="om-notice" data-tone="warn" role="status">Quotes are now stale; showing the {clock(morning.availableAt)} record.</p>}
    {status.kind === 'today' && status.lifecycle === 'closed' && <p className="om-notice" role="status">Market closed; showing this morning’s {clock(morning.availableAt)} record.</p>}
    {gaps && <p className="om-notice" data-tone="warn">{gaps}</p>}
    {error && <p className="om-notice" data-tone="warn" role="alert">Couldn’t reload. The scan below is the one already loaded. <Reference error={error} /></p>}
    {status.kind !== 'empty' && candidates.length > 0 && <Contracts candidates={candidates} manifestId={data.manifestId} request={request} />}
  </>
}

function NoScan({ data, status, busy, error, reload }) {
  const deadline = clock(data?.opening?.deadlineAt)
  const at = clock(data?.opening?.at)
  const operations = <><Link to="/options/operations">Operations</Link> has the details.</>
  const [title, body] = {
    pending: ['No scan yet today.', `The opening scan normally publishes around ${deadline}.`],
    due: ['No scan yet today.', `It should publish by ${deadline}.`],
    overdue: ['No scan published today.', <>It was due by {deadline}. {operations}</>],
    failed: ['Today’s scan failed.', <>It stopped at {at} without publishing. {operations}</>],
    late: ['Today’s scan finished too late.', <>It ended at {at}, after the {deadline} cutoff, so nothing was published. {operations}</>],
    missed: ['Scan missed the opening window.', <>It didn’t start before the {deadline} cutoff. {operations}</>],
    unreadable: ['Today’s scan ran, but it couldn’t be loaded.', 'Try reloading in a moment.'],
    closed: ['Markets are closed today.', 'The next scan runs at the next market open.'],
    unavailable: ['No scan available.', 'Today isn’t in the market calendar, so no scan is scheduled.'],
  }[status.kind]
  const previous = data?.morning
  return <section className="om-card" aria-live="polite"><h2>{title}</h2><p>{body}</p>
    {error && <p role="alert">Couldn’t reload. Try again in a moment. <Reference error={error} /></p>}
    <div className="om-actions"><button type="button" onClick={reload} disabled={busy}>{busy ? 'Loading…' : 'Reload'}</button>
      {previous && <Link to={{ search: `?morning=${encodeURIComponent(data.manifestId)}` }}>{day(previous.tradingDate)} scan · {plural(data.candidates?.length || 0, 'contract')} →</Link>}</div>
  </section>
}

function Workspace({ user }) {
  const [params, setParams] = useSearchParams()
  const manifestId = params.get('morning')
  const url = `${OPTIONS_API}&view=research${manifestId ? `&manifestId=${encodeURIComponent(manifestId)}` : ''}`
  const { verified, denied, busy, data: response, loadedUrl, error, request, reload } = useOptionsResource(user, url)
  const [now, setNow] = useState(Date.now)
  const data = response?.research
  const today = Boolean(data?.morning && data.morning.tradingDate === data.summary?.tradingDate)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  // Pin only today's record. An earlier morning shown while today's scan is
  // pending must not stop Reload from finding today's once it publishes.
  useEffect(() => {
    if (!manifestId && today && data?.manifestId && loadedUrl === url && !busy) setParams({ morning: data.manifestId }, { replace: true })
  }, [manifestId, today, data?.manifestId, setParams, loadedUrl, url, busy])
  if (denied) return <Navigate to="/portfolio" replace />
  if (!verified) return error ? <Navigate to="/portfolio" replace /> : null
  // Data for a different request (e.g. leaving an earlier morning) is not shown as the answer.
  const current = data && (loadedUrl === url || (manifestId && data.manifestId === manifestId))
  const status = morningStatus(data, now, { selected: Boolean(manifestId) })
  const latest = () => setParams({})
  let body
  if (!current) {
    body = busy || !error ? <p className="om-card" role="status">Loading today’s scan…</p>
      : <section className="om-card" role="alert"><h2>Couldn’t load today’s scan.</h2><p>Try again in a moment. <Reference error={error} /></p>
        <div className="om-actions"><button type="button" onClick={reload}>Try again</button></div></section>
  } else if (['today', 'empty', 'archived'].includes(status.kind)) {
    body = <Morning data={data} status={status} busy={busy} error={error} pinned={Boolean(manifestId)} reload={reload} latest={latest} request={request} />
  } else {
    body = <NoScan data={data} status={status} busy={busy} error={error} reload={reload} />
  }
  return <div className="wallai-system options-workspace">
    <header className="om-header"><div className="om-top"><span className="options-label">Options</span>
      <nav aria-label="Options pages"><Link to="/options/testing">Testing</Link><Link to="/options/operations">Operations</Link></nav></div>
      <h1>Morning opportunities</h1></header>
    {body}
  </div>
}

export default function Options() {
  const { user } = useAuth()
  return <Workspace key={user?.uid || 'signed-out'} user={user} />
}
