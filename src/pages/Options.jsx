import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { OPTIONS_API, useOptionsResource } from './options/useOptionsResource'
import { lifecycle, money, number, otmLabel, percent, iv, stateLabel, timestamp, words } from './options/display'
import CandidateDetails from './options/CandidateDetails'
import '../components/landing/tokens.css'
import './Options.css'

function Candidate({ candidate: row, manifestId, request, mode }) {
  const scenario = row.selectedScenario
  return <article className="options-candidate" aria-label={`${row.ticker} ${row.direction} candidate`}>
    <div className="options-row">
      <div className="options-identity"><span className="options-label">#{row.rank} · {words(row.direction)}</span><h2>{row.ticker}</h2>
        <p>{row.contract ? <>{money(row.contract.strikePrice)} · <span className="options-expiry">{row.contract.expirationDate}</span></> : 'Contract details unavailable'}</p>
        <p><strong>{number(row.score, 1)}</strong> / 100 <span className="options-muted">research score</span></p>
      </div>
      <div className="options-observed"><span className="options-label">Observed · {stateLabel(mode)}</span>
        <p><strong>{money(row.observed.mid)}</strong> mid <span className="options-muted">USD / share</span></p>
        <p>Bid {money(row.observed.bid)} · Ask {money(row.observed.ask)}</p>
        <p>Spread {Number.isFinite(row.observed.spreadPct) ? `${number(row.observed.spreadPct, 1)}%` : 'Unavailable'}</p>
        <time dateTime={row.observed.marketAt}>{timestamp(row.observed.marketAt)}</time>
      </div>
      <div className="options-modeled"><span className="options-label">Selected scenario · modeled</span>
        {scenario ? <><p><strong>{percent(scenario.askEntryModeledBidReturnPct)}</strong> ask entry → modeled bid exit</p>
          <p>Stock {percent(scenario.movePct)} · {scenario.sessions} sessions ({number(scenario.calendarElapsedDays, 2)} calendar days)</p>
          <p>IV {iv(scenario.startingImpliedVolatility)} → {iv(scenario.endingImpliedVolatility)} · stock {money(scenario.underlyingPrice)}</p>
          <p>{otmLabel(scenario, row.contract)}</p></> : <p>Selected scenario unavailable</p>}
        <p className="options-risk">Worst in matrix {percent(row.worstReturnPct)} · {money(row.premiumAtRisk)} at risk / contract</p>
      </div>
    </div>
    <div className="options-drivers"><p><span className="options-label">Drivers</span> {row.drivers.map((driver) => words(driver.component)).join(' · ') || 'Unavailable'}</p>
      <p><span className="options-label">Main risk</span> {words(row.risk)}</p></div>
    <CandidateDetails candidate={row} manifestId={manifestId} request={request} />
  </article>
}

function Workspace({ user }) {
  const [params, setParams] = useSearchParams()
  const manifestId = params.get('morning')
  const url = `${OPTIONS_API}&view=research${manifestId ? `&manifestId=${encodeURIComponent(manifestId)}` : ''}`
  const { verified, denied, busy, data: response, loadedUrl, error, request, reload } = useOptionsResource(user, url)
  const [now, setNow] = useState(Date.now)
  const [filter, setFilter] = useState('all')
  const data = response?.research
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!manifestId && data?.manifestId && loadedUrl === url && !busy) setParams({ morning: data.manifestId }, { replace: true })
  }, [manifestId, data?.manifestId, setParams, loadedUrl, url, busy])
  if (denied) return <Navigate to="/portfolio" replace />
  if (!verified) return error ? <Navigate to="/portfolio" replace /> : null
  const currentState = lifecycle(data, now)
  const morning = data?.morning
  const candidates = (data?.candidates || []).filter((row) => filter === 'all' || row.direction === filter)
  return <div className="wallai-system options-workspace">
    <header className="options-header"><div><span className="options-label">Private research · Options</span><h1>Morning opportunities</h1>
      <p>Compare the morning record. Explore the assumptions.</p></div>
      <nav aria-label="Options pages"><Link to="/options/testing">Shadow test ↗</Link><Link to="/options/operations">Operations ↗</Link></nav></header>
    <div className="options-status" aria-live="polite"><span className="options-badge">{stateLabel(currentState)}</span>
      {morning && <>{currentState !== morning.observationMode && <span>Observation: {stateLabel(morning.observationMode)}</span>}<span>{words(morning.completeness)} coverage</span></>}
      {data?.evidenceStatus === 'partial' && <span>Partial archived detail</span>}
      <span>{morning ? `Morning ${morning.tradingDate} · revision ${morning.revision}` : 'No morning record available'}</span>
    </div>
    <div className="options-toolbar"><p>{morning ? <>Published <time dateTime={morning.availableAt}>{timestamp(morning.availableAt)}</time></> : <>Checked {timestamp(data?.summary.checkedAt)}</>}</p>
      <div><button type="button" onClick={reload} disabled={busy}>{busy ? 'Loading…' : 'Reload record'}</button>
        {manifestId && <button type="button" disabled={busy} onClick={() => { setParams({}); }}>Latest morning</button>}</div>
    </div>
    {morning && morning.tradingDate !== data.summary.tradingDate && <p className="options-notice" role="status">Archived morning from {morning.tradingDate}. This is not today’s scan.</p>}
    {currentState === 'stale' && <p className="options-notice">Morning quotes are stale. The frozen scores and scenarios still describe their original inputs.</p>}
    {error && <p className="options-notice" role="alert">{error.message} {data && 'The morning record remains below.'}{error.referenceId && <small>Reference: {error.referenceId}</small>}</p>}
    <div className="options-intro"><p>Scores are not probabilities. Modeled returns are conditional, not forecasts. Full premium and costs are at risk.</p>
      <p>Default scenario: stock +5% for calls / −5% for puts, 3 sessions, unchanged IV. Returns use ask entry and a hypothetical modeled bid exit.</p></div>
    <div className="options-list-head"><h2>{candidates.length} candidate{candidates.length === 1 ? '' : 's'}</h2>
      <label>Direction <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Calls & puts</option><option value="call">Calls</option><option value="put">Puts</option></select></label></div>
    {!candidates.length && !busy && <div className="options-empty"><h2>{morning?.result === 'empty' ? 'No contracts passed this scan' : filter !== 'all' ? 'No candidates in this direction' : 'No candidates available'}</h2>
      <p>{morning?.result === 'empty' ? 'A valid empty result is part of the research record.' : 'Availability is unknown until a morning scan and its evidence can be read.'}</p></div>}
    {candidates.map((row) => <Candidate key={`${data.manifestId}:${row.contractId}`} candidate={row} manifestId={data.manifestId} request={request} mode={morning.observationMode} />)}
  </div>
}

export default function Options() {
  const { user } = useAuth()
  return <Workspace key={user?.uid || 'signed-out'} user={user} />
}
