import { useEffect, useRef, useState } from 'react'
import { OPTIONS_API } from './useOptionsResource'
import { iv, money, number, otmLabel, percent, timestamp, words } from './display'

function Table({ label, headings, children }) {
  return <div className="options-table-wrap" tabIndex={0} role="region" aria-label={label}><table><caption>{label}</caption><thead><tr>{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
}

function Scenarios({ set, contract }) {
  const [horizon, setHorizon] = useState('3_sessions')
  const [volatility, setVolatility] = useState('all')
  if (!set) return <p>Archived scenarios unavailable.</p>
  const rows = (set.scenarios || []).filter((row) => row.horizonId === horizon && (volatility === 'all' || row.ivMultiplier === Number(volatility)))
  const decay = set.timeOnlyDecay?.find((row) => row.horizonId === horizon)
  const costs = set.assumptions?.costs
  return <>
    <div className="options-filters"><label>Holding horizon <select value={horizon} onChange={(event) => setHorizon(event.target.value)}>
      {(set.horizons || []).map((item) => <option key={item.id} value={item.id} disabled={item.status !== 'available'}>{words(item.id)}{item.status !== 'available' ? ' · unavailable' : ''}</option>)}</select></label>
      <label>IV assumption <select value={volatility} onChange={(event) => setVolatility(event.target.value)}><option value="all">All IV cases</option><option value="0.9">IV down 10% relative</option><option value="1">Unchanged IV</option><option value="1.1">IV up 10% relative</option></select></label></div>
    <p>IV shocks are relative: 60% × 0.90 = 54%. These are model estimates; future bid prices are hypothetical.</p>
    <Table label="Archived scenario matrix" headings={['Stock move / price', 'IV start → end', 'Model / bid exit', 'Ask → bid return', 'Idealized mid return', 'Moneyness']}>
      {rows.map((row) => <tr key={`${row.movePct}:${row.ivMultiplier}`}><td>{percent(row.movePct)} / {money(row.underlyingPrice)}</td><td>{iv(row.startingImpliedVolatility)} → {iv(row.endingImpliedVolatility)}</td><td>{money(row.theoreticalValue)} / {money(row.modeledBid)}</td><td>{percent(row.askEntryModeledBidReturnPct)}</td><td>{percent(row.midReturnPct)}</td><td>{otmLabel(row, contract)}</td></tr>)}
    </Table>
    {!rows.length && <p>No archived scenarios for these assumptions.</p>}
    {rows[0] && <p>Exit {timestamp(rows[0].exitAt)} · {number(rows[0].calendarElapsedDays)} calendar days elapsed · {number(rows[0].remainingCalendarDays)} calendar days remain.</p>}
    <p>Time-only repricing, unchanged stock and IV: {percent(decay?.decayPctOfEntryPremium)} of entry midpoint ({money(decay?.decayPerShare)} / share). Theta is not subtracted again.</p>
    <details><summary>Premium targets and pricing assumptions</summary>
      <p>Targets are idealized midpoint-relative premium gains, not ask-to-bid returns or probabilities. Unsolved targets are unavailable within the archived search bound.</p>
      <Table label="Required stock move for a premium target" headings={['Premium target', 'IV start → end', 'Required stock move', 'Required stock price', 'Move / implied budget']}>
        {(set.premiumTargets || []).filter((row) => row.horizonId === horizon && (volatility === 'all' || row.ivMultiplier === Number(volatility))).map((row) => <tr key={`${row.targetPct}:${row.ivMultiplier}`}><td>{percent(row.targetPct)}</td><td>{iv(row.startingImpliedVolatility)} → {iv(row.endingImpliedVolatility)}</td><td>{row.solved ? percent(row.requiredMovePct) : 'No solution within search bound'}</td><td>{money(row.requiredUnderlyingPrice)}</td><td>{number(row.requiredMoveInImpliedMoves)}×</td></tr>)}
      </Table>
      <p>Ask entry {money(set.entry?.ask)} / share. Modeled bid = model value × (1 − assumed spread / 2); assumed full spread {number(set.entry?.spreadPct)}%. A wider future spread reduces returns.</p>
      <p>Multiplier {costs?.contractMultiplier ?? 'Unavailable'} · fees per side: commission {money(costs?.commissionPerContract)} + regulatory {money(costs?.regulatoryFeesPerContract)} per contract.</p>
      <p>Rate {iv(set.assumptions?.riskFreeRate)} · continuous dividend yield {iv(set.assumptions?.continuousDividendYield)} · borrow {iv(set.assumptions?.borrowRate)}.</p>
      <p>Discrete dividends: {set.assumptions?.dividends?.length ? set.assumptions.dividends.map((item) => `${item.exDate}: ${money(item.amount)}`).join(' · ') : 'None in archived assumptions'}.</p>
      <p>Model: {set.modelVersion} · last trade {timestamp(set.lastTradeAt)}. Assumptions held fixed except the stated stock, time and IV changes.</p>
    </details>
  </>
}

function Score({ score }) {
  if (!score) return <p>Archived score explanation unavailable.</p>
  return <><p>{number(score.componentPoints)} component points − {number(score.penaltyPoints)} penalty points, clipped to 0–100 = {number(score.score)}. A research score is not a probability.</p>
    {(score.components || []).map((component) => <details key={component.component}><summary>{words(component.component)} · {number(component.points)} / {component.max}</summary>
      <Table label={`${words(component.component)} evidence`} headings={['Feature', 'Value / units', 'Window', 'Transform', 'Points']}>
        {(component.features || []).map((feature) => <tr key={feature.feature}><th scope="row">{words(feature.feature)}</th><td>{feature.raw == null ? 'Unavailable' : String(feature.raw)} {feature.units}{feature.reason && <small>{words(feature.reason)}</small>}</td><td>{feature.window}</td><td>{feature.transform}<small>{Object.entries(feature.transformParams || {}).map(([key, value]) => `${key}: ${value}`).join(' · ')}</small></td><td>{number(feature.points)}</td></tr>)}
      </Table></details>)}
    <p>Penalties: {(score.penalties || []).map((item) => `${words(item.code)} −${number(item.points)}`).join(' · ') || 'None applied'}.</p>
    {score.missing?.length > 0 && <p>Unknown inputs: {score.missing.map((item) => words(item.reason)).join(' · ')}.</p>}
    <p>Policy {score.policyVersion}. Ties use tighter spread, then contract ID; display caps may hide other eligible contracts.</p>
  </>
}

function Contract({ detail, refresh, refreshing, refreshError, onRefresh }) {
  const contract = detail.contract
  const entry = detail.scenarioSet?.entry
  return <>
    <p>Frozen morning contract · {timestamp(contract?.quote?.marketAt)}. Calibrated model Greeks at {timestamp(detail.scenarioSet?.asOf)}:</p>
    <dl className="options-facts">{['delta', 'gamma', 'theta', 'vega', 'rho'].map((greek) => <div key={greek}><dt>{words(greek)}</dt><dd>{number(entry?.greeks?.[greek], 4)}</dd></div>)}
      <div><dt>Open interest</dt><dd>{contract?.openInterest ?? 'Unavailable'} <small>As of {contract?.openInterestDate || 'unknown'}</small></dd></div>
      <div><dt>Volume</dt><dd>{contract?.volume?.value ?? 'Unavailable'} <small>{contract?.volume?.sessionDate || 'Date unknown'} · {contract?.volume?.session || 'Session unknown'}</small></dd></div></dl>
    <p>Theta: dollars/share/calendar day. Vega and rho: dollars/share per 1 percentage point. Delta: premium change per $1 stock move; gamma: delta change per $1. Local sensitivities do not predict finite moves.</p>
    <p>Provider analytics time: {timestamp(contract?.analytics?.marketAt)}. Model IV: {iv(entry?.impliedVolatility)}. Underlying quote: {timestamp(detail.underlyingMarketAt)}.</p>
    <section className="options-refresh" aria-label="Separate detail observation"><h3>Later observation</h3><p>Opening any detail requests a separate quote check. It never replaces the morning score, quote or scenario.</p>
      <button type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Checking observation…' : 'Refresh detail observation'}</button>
      {refreshError && <p role="alert">Detail refresh unavailable. The morning record is unchanged.</p>}
      {refresh && <div role="status"><p>{refresh.status === 'accepted' ? 'New observation · passed data gates' : 'New observation unavailable · did not pass data gates'} · retrieved {timestamp(refresh.availableAt)}</p>
        {refresh.contract && <p>Separate observed bid {money(refresh.contract.quote?.bid)} / ask {money(refresh.contract.quote?.ask)} · quote {timestamp(refresh.contract.quote?.marketAt)} · {words(refresh.contract.quote?.semantics?.kind || 'feed status unknown')}. Not a live-fill promise.</p>}
      </div>}
    </section>
  </>
}

function Lineage({ lineage, detail }) {
  return <><p>Morning manifest <code>{lineage.manifestId}</code> · scan <code>{lineage.scanId}</code></p>
    <p>Contract <code>{detail.contract?.contractId}</code> · OSI <code>{detail.contract?.osiSymbol}</code> · raw reference <code>{detail.contract?.rawReferenceHash || 'Unavailable'}</code></p>
    {lineage.records.map((record) => <details key={record.recordId}><summary>{words(record.recordType)} · {timestamp(record.availableAt)}</summary>
      <p>Record <code>{record.recordId}</code></p><p>Provider {record.source?.provider} · feed {record.source?.feed} · session {record.source?.session}</p>
      <p>{Object.entries(record.versions || {}).map(([key, value]) => `${words(key)}: ${value}`).join(' · ')}</p>
      <p>Input hashes: {(record.inputHashes || []).map((hash) => <code key={hash}>{hash} </code>)}</p>
    </details>)}
  </>
}

export default function CandidateDetails({ candidate, manifestId, request }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const alive = useRef(true)
  const started = useRef(false)
  const refreshPending = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function refreshDetail() {
    if (refreshPending.current) return
    refreshPending.current = true
    setRefreshing(true); setRefreshError(false)
    try {
      const data = await request(OPTIONS_API, { manifestId, contractId: candidate.contractId })
      if (alive.current) setRefresh(data.detail.refresh)
    } catch { if (alive.current) setRefreshError(true) }
    finally { refreshPending.current = false; if (alive.current) setRefreshing(false) }
  }
  async function load() {
    if (started.current) return
    started.current = true; setLoading(true); setError(false)
    try {
      const data = await request(`${OPTIONS_API}&view=research&manifestId=${encodeURIComponent(manifestId)}&contractId=${encodeURIComponent(candidate.contractId)}`)
      if (alive.current) { setDetail(data.research); await refreshDetail() }
    } catch { if (alive.current) { setError(true); started.current = false } }
    finally { if (alive.current) setLoading(false) }
  }
  const sections = [
    ['View scenarios', () => <Scenarios set={detail.scenarioSet} contract={candidate.contract} />],
    ['Why it ranked', () => <Score score={detail.score} />],
    ['Contract details', () => <Contract detail={detail} refresh={refresh} refreshing={refreshing} refreshError={refreshError} onRefresh={refreshDetail} />],
    ['Chain comparison', () => <><p>Archived gated contracts from this chain. Scores retain their frozen ranking inputs; comparison quotes can have later timestamps. Unscored contracts remain unavailable.</p><Table label="Frozen chain comparison" headings={['Contract', 'Bid / ask', 'Score', 'Quote time']}>
      {detail.comparison.map((row) => <tr key={row.contractId}><th scope="row">{words(row.type)} {money(row.strikePrice)} · {row.expirationDate}{row.contractId === candidate.contractId ? ' · selected' : ''}</th><td>{money(row.bid)} / {money(row.ask)}</td><td>{number(row.score)}</td><td>{timestamp(row.marketAt)}</td></tr>)}
    </Table></>],
    ['Data lineage', () => <Lineage lineage={detail.lineage} detail={detail} />],
  ]
  return <div className="options-disclosures">{sections.map(([label, content]) => <details key={label} onToggle={(event) => { if (event.currentTarget.open) load() }}><summary>{label}</summary>
    {loading && !detail && <p role="status">Loading archived detail…</p>}
    {error && <p role="alert">Archived detail unavailable. <button type="button" onClick={load}>Retry detail</button></p>}
    {detail && content()}
  </details>)}</div>
}
