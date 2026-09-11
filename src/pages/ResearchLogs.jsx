import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import '../components/landing/tokens.css'
import './ResearchLogs.css'

const OUTCOME = {
  published: 'Published',
  accepted: 'Reviewed, not published',
  reviewed_rejected: 'Reviewed, not selected',
  not_reviewed: 'Eligible, not reviewed',
  discovered: 'Discovered only',
  rejected: 'Not eligible',
  board: 'Discovered only',
}

const STRATEGY = {
  attention: 'Attention', fundamentals: 'Fundamentals', filing_changes: 'Filing changes', insider: 'Insider',
}

const title = (value) => STRATEGY[value] || String(value || '').replaceAll('_', ' ')
const number = (value) => Number.isFinite(value) ? value : '—'

const seconds = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : 'Unknown')
const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'Unknown')

function Stage({ stage }) {
  return <tr className={`logs-stage logs-stage-${stage.status}`}>
    <th scope="row">{stage.stage}</th>
    <td>{stage.status}</td>
    <td>{seconds(stage.durationMs)}</td>
    <td>{Object.entries(stage.metrics || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || '—'}</td>
    <td>{stage.error?.message || ''}</td>
  </tr>
}

function EvaluationHandoff({ run }) {
  if (run.job !== 'nightly-research') return null
  const evaluation = run.evaluation
  return <div className="logs-handoff" aria-label="Evaluation handoff">
    <span>Nightly research {run.status === 'failed' ? '❌' : '✅'} {run.status}</span>
    {!evaluation
      ? <span>Evaluation input — not frozen (inputs unavailable or time budget)</span>
      : <>
        <span>Evaluation input ✅ frozen · {when(evaluation.frozenAt)}</span>
        <span>Evaluation job {evaluation.status === 'completed' ? '✅' : evaluation.status === 'failed' ? '❌' : '⏳'} {evaluation.status}
          {evaluation.status === 'failed' && ` · ${evaluation.error} · retry: ${evaluation.retryState}`}
        </span>
      </>}
  </div>
}

function Funnel({ admission }) {
  if (!admission?.funnel) return <p className="logs-legacy">Admission funnel unavailable for this legacy run.</p>
  const items = [
    ['Discovered', admission.funnel.discovered],
    ['Eligible', admission.funnel.eligible],
    ['Admitted', admission.funnel.admitted],
    ['Sent to Claude', admission.funnel.sentToClaude],
    ['Claude accepted', admission.funnel.claudeAccepted],
    ['Published', admission.funnel.published],
    ['Budget exhausted', admission.funnel.notReviewed],
  ]
  return <><div className="logs-funnel" aria-label="Research admission funnel">
    {items.map(([label, value]) => <div className="logs-funnel-step" key={label}><span>{label}</span><strong>{number(value)}</strong></div>)}
  </div><p className="logs-funnel-note"><strong>Budget exhausted</strong> means the candidate passed identity and evidence eligibility but did not receive one of the configured review slots. It is not a cron-runtime timeout.</p></>
}

function StreamBreakdown({ streams = [] }) {
  if (!streams.length) return null
  return <>
    <div className="logs-table-wrap"><table>
      <caption>Admission by strategy</caption>
      <thead><tr><th>Strategy</th><th>Eligible</th><th>Reserved budget</th><th>Actually selected</th><th>Reallocation</th><th>Waiting</th><th>Discovery sources</th><th>Cutoff</th></tr></thead>
      <tbody>{streams.map((stream) => <tr key={stream.strategy}>
        <th scope="row">{title(stream.strategy)} <span className="logs-muted">· {stream.horizon} sessions</span></th>
        <td>{number(stream.eligible)}</td>
        <td>{number(stream.reservedUsed)} / {number(stream.configured)} used</td>
        <td>{number(stream.selected)}</td>
        <td>{stream.reallocatedIn || stream.reallocatedOut
          ? `${stream.reallocatedIn ? `+${stream.reallocatedIn} in` : ''}${stream.reallocatedIn && stream.reallocatedOut ? ' · ' : ''}${stream.reallocatedOut ? `−${stream.reallocatedOut} out` : ''}`
          : 'None'}</td>
        <td>{number(stream.waiting)}</td>
        <td>{(stream.sources || []).map((source) => `${source.source} ${source.count}`).join(' · ') || '—'}</td>
        <td>{stream.lowestAdmitted
          ? `#${stream.lowestAdmitted.streamRanks?.[stream.strategy] || '—'} ${stream.lowestAdmitted.ticker || stream.lowestAdmitted.securityId} · priority ${number(stream.lowestAdmitted.priority)}`
          : 'No admitted candidate'}</td>
      </tr>)}</tbody>
    </table></div>
    {streams.some((stream) => stream.belowCutoff?.length) && <details className="logs-cutoffs">
      <summary>Inspect candidates immediately below each cutoff</summary>
      <div className="logs-cutoff-grid">{streams.filter((stream) => stream.belowCutoff?.length).map((stream) => <section key={stream.strategy}>
        <h3>{title(stream.strategy)} cutoff</h3>
        {stream.lowestAdmitted && <p>Lowest admitted: #{stream.lowestAdmitted.streamRanks?.[stream.strategy]} {stream.lowestAdmitted.ticker || stream.lowestAdmitted.securityId} · priority {number(stream.lowestAdmitted.priority)}</p>}
        <ol>{stream.belowCutoff.map((candidate) => <li key={candidate.securityId || candidate.ticker}>
          <strong>#{candidate.streamRanks?.[stream.strategy]} {candidate.ticker || candidate.securityId}</strong>
          {candidate.name ? ` — ${candidate.name}` : ''} · priority {number(candidate.priority)}
          {Number.isFinite(candidate.priorityGap) ? ` · gap ${candidate.priorityGap}` : ''}
          <span>{(candidate.sources || []).join(' · ')} · {(candidate.evidence || []).map((item) => item.type || item.strategy).filter(Boolean).join(' · ')}</span>
        </li>)}</ol>
      </section>)}</div>
    </details>}
  </>
}

function Identity({ candidate }) {
  const symbol = candidate.ticker || candidate.securityId || 'Unknown security'
  return <><span className="logs-symbol">{symbol}</span>{candidate.name && <span className="logs-company">{candidate.name}</span>}
    {candidate.ticker && candidate.securityId && <code className="logs-security-id">{candidate.securityId}</code>}</>
}

function Rank({ candidate }) {
  const streams = Object.entries(candidate.streamRanks || {})
  return <>{candidate.overallRank ? <span>Overall #{candidate.overallRank}</span> : '—'}
    {streams.length > 0 && <span className="logs-subline">{streams.map(([stream, rank]) => `${title(stream)} #${rank}`).join(' · ')}</span>}</>
}

function Budget({ candidate }) {
  const usage = Object.entries(candidate.budgetUsage || {})
  if (!usage.length) return '—'
  return <>{usage.map(([stream, item]) => <span className="logs-subline" key={stream}>
    {title(stream)}: {item.reservedUsed}/{item.configured} reserved · {item.selected} selected
    {item.reallocatedIn ? ` · +${item.reallocatedIn} in` : ''}{item.reallocatedOut ? ` · −${item.reallocatedOut} out` : ''}
  </span>)}</>
}

function Evidence({ candidate }) {
  if (!candidate.evidence?.length) return '—'
  return <details><summary>{candidate.evidenceCount || candidate.evidence.length} evidence item{(candidate.evidenceCount || candidate.evidence.length) === 1 ? '' : 's'}</summary>
    <ul className="logs-evidence">{candidate.evidence.map((item) => <li key={item.id}>{item.type || item.strategy || 'Evidence'}{item.horizon ? ` · ${item.horizon} sessions` : ''}<code>{item.id}</code></li>)}</ul>
    {candidate.evidenceTruncated && <span className="logs-muted">Showing the ten highest-priority items.</span>}
  </details>
}

function Candidate({ candidate }) {
  const sentToClaude = candidate.sentToClaude ?? candidate.reviewed ?? false
  const claudeLabel = candidate.claudeStatus === 'accepted' || candidate.outcome === 'published' || candidate.outcome === 'accepted'
    ? 'Accepted'
    : candidate.claudeStatus === 'reviewed_not_selected' || (sentToClaude && candidate.outcome === 'reviewed_rejected')
      ? 'Reviewed, not selected'
      : sentToClaude ? 'Sent' : 'Not sent'
  return <tr>
    <th scope="row"><Identity candidate={candidate} /></th>
    <td>{OUTCOME[candidate.outcome] || candidate.outcome}</td>
    <td>{(candidate.sources || []).join(' · ') || '—'}</td>
    <td>{(candidate.strategies || []).map(title).join(' · ') || '—'}{candidate.horizons?.length > 0 && <span className="logs-subline">{candidate.horizons.join(', ')} sessions</span>}
      {candidate.duplicateAcrossStreams && <span className="logs-subline">One security across multiple streams</span>}</td>
    <td>{number(candidate.priority)}</td>
    <td><Rank candidate={candidate} /></td>
    <td><Budget candidate={candidate} /></td>
    <td><strong className={sentToClaude ? 'logs-yes' : 'logs-no'}>{sentToClaude ? 'YES' : 'NO'}</strong>
      <span className="logs-subline">{claudeLabel}</span></td>
    <td>{candidate.rank ? `Final #${candidate.rank}` : '—'}{Number.isFinite(candidate.finalScore) && <span className="logs-subline">Score {candidate.finalScore}</span>}
      {candidate.catalystVerified !== undefined && <span className="logs-subline">Catalyst {candidate.catalystVerified ? 'verified' : 'unverified'}</span>}</td>
    <td><Evidence candidate={candidate} /></td>
    <td>{candidate.reason || ''}</td>
  </tr>
}

function CandidateTable({ title: groupTitle, candidates, compact = false, filtered = false }) {
  if (!candidates.length) return null
  const visible = compact && !filtered ? candidates.slice(0, 10) : candidates
  const hidden = compact && !filtered ? candidates.slice(10) : []
  const table = (rows, caption) => <div className="logs-table-wrap"><table>
    <caption>{caption}</caption>
    <thead><tr><th>Security</th><th>Outcome</th><th>Source</th><th>Strategy</th><th>Priority</th><th>Admission rank</th><th>Budget</th><th>Claude</th><th>Result</th><th>Evidence</th><th>Reason</th></tr></thead>
    <tbody>{rows.map((candidate) => <Candidate key={candidate.securityId || candidate.ticker} candidate={candidate} />)}</tbody>
  </table></div>
  return <section className="logs-candidate-group">
    <h3>{groupTitle} <span>{candidates.length}</span></h3>
    {table(visible, groupTitle)}
    {hidden.length > 0 && <details className="logs-more"><summary>Show all {candidates.length} eligible candidates</summary>{table(hidden, `${groupTitle}, remaining ${hidden.length}`)}</details>}
  </section>
}

function Run({ run, ticker }) {
  const candidates = (run.candidates || []).filter((c) => !ticker || (c.ticker || '').toLowerCase().includes(ticker))
  const byOutcome = {
    published: candidates.filter((candidate) => candidate.outcome === 'published'),
    accepted: candidates.filter((candidate) => candidate.outcome === 'accepted'),
    reviewed: candidates.filter((candidate) => candidate.outcome === 'reviewed_rejected'),
    waiting: candidates.filter((candidate) => candidate.outcome === 'not_reviewed'),
    discovered: candidates.filter((candidate) => !['published', 'accepted', 'reviewed_rejected', 'not_reviewed'].includes(candidate.outcome)),
  }
  return <section className="logs-run" aria-label={`${run.job} ${run.startedAt}`}>
    <div className="logs-run-head">
      <h2>{run.job}</h2>
      <span className={`logs-status logs-status-${run.status}`}>{run.status}</span>
      <span>{when(run.startedAt)}</span>
      <span>{seconds(run.durationMs)}</span>
    </div>
    <EvaluationHandoff run={run} />
    <Funnel admission={run.admission} />
    <StreamBreakdown streams={run.admission?.streams} />
    <div className="logs-table-wrap"><table>
      <caption>Stages</caption>
      <thead><tr><th>Stage</th><th>Status</th><th>Duration</th><th>Counts</th><th>Error</th></tr></thead>
      <tbody>{(run.stages || []).map((s) => <Stage key={`${run.runId}:${s.stage}`} stage={s} />)}</tbody>
    </table></div>
    <CandidateTable title="Published" candidates={byOutcome.published} filtered={Boolean(ticker)} />
    <CandidateTable title="Reviewed, not published" candidates={byOutcome.accepted} filtered={Boolean(ticker)} />
    <CandidateTable title="Reviewed but rejected" candidates={byOutcome.reviewed} filtered={Boolean(ticker)} />
    <CandidateTable title="Eligible but not reviewed" candidates={byOutcome.waiting} compact filtered={Boolean(ticker)} />
    <CandidateTable title="Discovered only / not eligible" candidates={byOutcome.discovered} filtered={Boolean(ticker)} />
  </section>
}

const Eyebrow = () => <span className="logs-eyebrow">Private · Read only</span>

export default function ResearchLogs() {
  const { user } = useAuth()
  const [state, setState] = useState(null)
  const [ticker, setTicker] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        if (!user?.getIdToken) throw new Error('Owner sign-in required')
        const token = await user.getIdToken()
        const response = await fetch('/api/get-research?runs=1', {
          method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Run history is unavailable')
        if (!controller.signal.aborted) setState({ uid: user.uid, runs: data.runs || [] })
      } catch (error) {
        if (!controller.signal.aborted) setState({ uid: user?.uid, error: error.message })
      }
    }
    load()
    return () => controller.abort()
  }, [user])

  const current = state?.uid === user?.uid ? state : null
  const search = ticker.trim().toLowerCase()
  // A ticker filter that hid whole runs would answer "where is RKLB" with an
  // empty page. Runs stay; their candidate lists narrow.
  const runs = useMemo(() => (current?.runs || []).filter((run) => !search
    || (run.candidates || []).some((c) => (c.ticker || '').toLowerCase().includes(search))), [current, search])

  // A non-owner must never learn this page exists: no title, no "Private ·
  // Read only" framing, nothing while loading, and an immediate exit on
  // denial — the same redirect a truly unknown route would produce.
  if (!current) return null
  if (current.error) return <Navigate to="/portfolio" replace />

  return <div className="wallai-system research-logs">
    <header className="logs-head"><Eyebrow /><h1>Research logs</h1>
      <p className="logs-lede">What each research run did, how long each stage took, and why a candidate did or did not reach the board.</p>
      <div className="logs-filters">
        <label htmlFor="logs-ticker">Ticker</label>
        <input id="logs-ticker" value={ticker} onChange={(event) => setTicker(event.target.value)} placeholder="RKLB" />
      </div>
    </header>
    {current.runs.length === 0 && <p className="logs-empty">No research runs recorded yet. The next scheduled run will appear here.</p>}
    {current.runs.length > 0 && runs.length === 0 && <p className="logs-empty">No run in this history mentions that ticker.</p>}
    {runs.map((run) => <Run key={run.runId} run={run} ticker={search} />)}
  </div>
}
