import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import '../components/landing/tokens.css'
import './ResearchLogs.css'
import { TIME_FILTERS, RUN_TYPES, friendlyName, friendlyTime, jobName, stageName, statusName, summaryCounts, runDescription, runWarnings, wasSent } from './researchLogsDisplay'

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
    <th scope="row">{stageName(stage.stage)}<code className="logs-subline">{stage.stage}</code></th>
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
    <span>Nightly research: {statusName(run.status)}</span>
    {!evaluation
      ? <span>Evaluation input — not frozen (inputs unavailable or time budget)</span>
      : <>
        <span>Evaluation input ✅ frozen · <time dateTime={evaluation.frozenAt} title={evaluation.frozenAt}>{when(evaluation.frozenAt)}</time></span>
        <span>Evaluation job {evaluation.status === 'completed' ? '✅' : evaluation.status === 'failed' ? '❌' : '⏳'} {evaluation.status}
          {evaluation.status === 'failed' && ' · needs attention'}
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
  return <><span className="logs-symbol">{symbol}</span>{candidate.name && <span className="logs-company">{candidate.name}</span>}</>
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

const PRIORITY_COMPONENTS = {
  evidenceQuality: 'Evidence quality',
  sourceIndependence: 'Independent sources',
  catalystSpecificity: 'Specific catalyst',
  technicalConfirmation: 'Technical confirmation',
  freshness: 'Freshness',
  crossChannelConfirmation: 'Multiple evidence channels',
  signalStrength: 'Original signal strength',
  repetitionPenalty: 'Repetition penalty',
  contextOnlyPenalty: 'Context-only penalty',
  routineInsiderPenalty: 'Routine insider-event penalty',
  hypePenalty: 'Unsourced hype penalty',
  negativeEvidencePenalty: 'Negative-evidence penalty',
}

function PriorityModel({ candidate }) {
  const model = candidate.priorityModel
  if (!model) return '—'
  const components = Object.entries(model.components || {}).filter(([, value]) => value !== 0)
  return <>{number(model.score)} <span className="logs-subline">Used for admission · {model.version}</span>
    {components.length > 0 && <span className="logs-subline">{components.map(([key, value]) => `${PRIORITY_COMPONENTS[key] || friendlyName(key)} ${value > 0 ? '+' : ''}${number(value)}`).join(' · ')}</span>}
  </>
}

function Evidence({ candidate }) {
  if (!candidate.evidence?.length) return Number.isFinite(candidate.evidenceCount) ? `${candidate.evidenceCount} evidence items (details unavailable)` : '—'
  return <details><summary>{candidate.evidenceCount ?? candidate.evidence.length} evidence item{(candidate.evidenceCount ?? candidate.evidence.length) === 1 ? '' : 's'}</summary>
    <ul className="logs-evidence">{candidate.evidence.map((item) => <li key={item.id}>{item.type || item.strategy || 'Evidence'}{item.horizon ? ` · ${item.horizon} sessions` : ''}{item.strategy && ` · ${title(item.strategy)}`}{typeof item.source === 'string' && ` · ${item.source}`}</li>)}</ul>
    {candidate.evidenceTruncated && <span className="logs-muted">Showing the ten highest-priority items.</span>}
  </details>
}

function Candidate({ candidate }) {
  const sentToClaude = wasSent(candidate)
  const claudeLabel = candidate.claudeStatus === 'accepted' || candidate.outcome === 'published' || candidate.outcome === 'accepted'
    ? 'Accepted'
    : candidate.claudeStatus === 'reviewed_not_selected' || (sentToClaude && candidate.outcome === 'reviewed_rejected')
      ? 'Reviewed, not selected'
      : sentToClaude ? 'Sent; result unavailable' : 'Not sent'
  const admitted = candidate.admitted === undefined ? (candidate.admission ? 'Yes' : 'Unknown') : candidate.admitted ? 'Yes' : 'No'
  return <details className="logs-candidate">
    <summary><span><Identity candidate={candidate} /></span><span className="logs-muted">{OUTCOME[candidate.outcome] || friendlyName(candidate.outcome)}</span></summary>
    <dl className="logs-candidate-facts">
      <div><dt>Strategy / source</dt><dd>{(candidate.strategies || []).map(title).join(' · ') || '—'}<span className="logs-subline">{(candidate.sources || []).join(' · ') || '—'}</span>
        {candidate.horizons?.length > 0 && <span className="logs-subline">{candidate.horizons.join(', ')} sessions</span>}
        {candidate.duplicateAcrossStreams && <span className="logs-subline">One security across multiple streams</span>}</dd></div>
      <div><dt>Priority</dt><dd>{number(candidate.priority)}</dd></div>
      <div><dt>Admission rank</dt><dd><Rank candidate={candidate} /></dd></div>
      <div><dt>Admitted to review budget</dt><dd>{admitted}{candidate.admission && <span className="logs-subline">{title(candidate.admission.stream)} · {friendlyName(candidate.admission.kind)}</span>}</dd></div>
      <div><dt>Sent to Claude</dt><dd>{sentToClaude ? 'Yes' : 'No'}</dd></div>
      <div><dt>Claude result / score</dt><dd>{claudeLabel}<span className="logs-subline">Score {number(candidate.finalScore)}</span></dd></div>
      <div><dt>Catalyst</dt><dd>{candidate.catalystVerified === undefined ? 'Unknown' : candidate.catalystVerified ? 'Verified' : 'Unverified'}</dd></div>
      <div><dt>Final rank</dt><dd>{candidate.rank ? `#${candidate.rank}` : '—'}</dd></div>
      <div><dt>Published</dt><dd>{candidate.outcome === 'published' ? 'Yes' : 'No'}</dd></div>
      <div><dt>Evidence</dt><dd><Evidence candidate={candidate} /></dd></div>
    </dl>
    {candidate.reason === 'review_budget_exhausted' && <p className="logs-candidate-note">Eligible for review, but all configured Claude review slots were used. This is a review-slot limit, not a runtime timeout.</p>}
    <details className="logs-technical">
      <summary>Technical details</summary>
      <dl className="logs-candidate-facts">
        <div><dt>Security ID</dt><dd><code>{candidate.securityId || '—'}</code></dd></div>
        <div><dt>Reason</dt><dd>{candidate.reason || '—'}</dd></div>
        <div><dt>Review priority model</dt><dd><PriorityModel candidate={candidate} /></dd></div>
        <div><dt>Legacy priority</dt><dd>{number(candidate.legacyPriority)}</dd></div>
        {candidate.legacyOverallRank && <div><dt>Legacy admission rank</dt><dd>Overall #{candidate.legacyOverallRank}<span className="logs-subline">{Object.entries(candidate.legacyStreamRanks || {}).map(([stream, rank]) => `${title(stream)} #${rank}`).join(' · ')}</span></dd></div>}
        <div><dt>Budget</dt><dd><Budget candidate={candidate} /></dd></div>
        <div><dt>Evidence IDs</dt><dd>{candidate.evidence?.map((item) => <code className="logs-subline" key={item.id}>{item.id}</code>) || '—'}</dd></div>
      </dl>
      <details><summary>Complete candidate record</summary><pre>{JSON.stringify(candidate, null, 2)}</pre></details>
    </details>
  </details>
}

function CandidateGroup({ title: groupTitle, candidates, compact = false, filtered = false }) {
  if (!candidates.length) return null
  const visible = compact && !filtered ? candidates.slice(0, 10) : candidates
  const hidden = compact && !filtered ? candidates.slice(10) : []
  const rows = (items) => items.map((candidate) => <Candidate key={candidate.securityId || candidate.ticker} candidate={candidate} />)
  return <section className="logs-candidate-group">
    <h3>{groupTitle} <span>{candidates.length}</span></h3>
    {rows(visible)}
    {hidden.length > 0 && <details className="logs-more"><summary>Show all {candidates.length} eligible candidates</summary>{rows(hidden)}</details>}
  </section>
}

function Run({ run, ticker, now }) {
  const [expanded, setExpanded] = useState(false)
  const candidates = (run.candidates || []).filter((c) => !ticker || (c.ticker || '').toLowerCase().includes(ticker))
  const byOutcome = {
    published: candidates.filter((candidate) => candidate.outcome === 'published'),
    accepted: candidates.filter((candidate) => candidate.outcome === 'accepted'),
    reviewed: candidates.filter((candidate) => candidate.outcome === 'reviewed_rejected'),
    waiting: candidates.filter((candidate) => candidate.outcome === 'not_reviewed'),
    discovered: candidates.filter((candidate) => !['published', 'accepted', 'reviewed_rejected', 'not_reviewed'].includes(candidate.outcome)),
  }
  const warnings = runWarnings(run)
  const counts = summaryCounts(run)
  const showCounts = run.job === 'nightly-research' || counts.some(([, value]) => value !== null)
  const open = expanded || Boolean(ticker)
  return <section className="logs-run" aria-label={`${jobName(run.job)} ${run.startedAt}`}>
    <div className="logs-run-head">
      <h2>{jobName(run.job)}</h2>
      <span className={`logs-status logs-status-${run.status}`}>{statusName(run.status)}</span>
      <time dateTime={run.startedAt} title={run.startedAt}>{friendlyTime(run.startedAt, now)}</time>
      <span title="Run duration">{seconds(run.durationMs)}</span>
    </div>
    {runDescription(run) && <p className="logs-muted">{runDescription(run)}</p>}
    {showCounts && <dl className="logs-summary" aria-label="Run summary">
      {counts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value === null ? 'Not recorded for this run' : undefined}>{number(value)}</dd></div>)}
    </dl>}
    {showCounts && counts.some(([, value]) => value === null) && <p className="logs-search-note">— = not recorded for this run.</p>}
    {warnings.length > 0 && <ul className="logs-warnings" aria-label="Warnings and failures">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    {ticker && <p className="logs-search-note">{candidates.length} matching candidate{candidates.length === 1 ? '' : 's'} · Summary counts describe the entire run.</p>}
    <button className="logs-expand" type="button" aria-expanded={open} aria-controls={`run-${run.runId}`} onClick={() => setExpanded(!expanded)} disabled={Boolean(ticker)}>
      {open ? 'Run details' : 'View run details'}<span aria-hidden="true">{open ? ' −' : ' +'}</span>
    </button>
    {open && <div id={`run-${run.runId}`} className="logs-run-body">
      <EvaluationHandoff run={run} />
      <details className="logs-candidates" open={ticker ? true : undefined}>
        <summary>View candidates <span className="logs-muted">· {candidates.length}</span></summary>
        {!candidates.length && <p className="logs-muted">No candidate details were recorded for this run.</p>}
        <CandidateGroup title="Published" candidates={byOutcome.published} filtered={Boolean(ticker)} />
        <CandidateGroup title="Reviewed, not published" candidates={byOutcome.accepted} filtered={Boolean(ticker)} />
        <CandidateGroup title="Reviewed but rejected" candidates={byOutcome.reviewed} filtered={Boolean(ticker)} />
        <CandidateGroup title="Eligible but not reviewed" candidates={byOutcome.waiting} compact filtered={Boolean(ticker)} />
        <CandidateGroup title="Discovered only / not eligible" candidates={byOutcome.discovered} filtered={Boolean(ticker)} />
        <details className="logs-technical"><summary>Technical details · admission and cutoffs</summary>
          <Funnel admission={run.admission} />
          <StreamBreakdown streams={run.admission?.streams} />
        </details>
      </details>
      <details className="logs-technical">
        <summary>Technical details</summary>
        <dl className="logs-candidate-facts">
          <div><dt>Run ID</dt><dd><code>{run.runId}</code></dd></div>
          <div><dt>Internal job / status</dt><dd><code>{run.job} · {run.status}</code></dd></div>
          <div><dt>Started</dt><dd>{run.startedAt || '—'}</dd></div>
          <div><dt>Finished</dt><dd>{run.finishedAt || '—'}</dd></div>
          {run.evaluation && <>
            <div><dt>Evaluation job ID</dt><dd><code>{run.evaluation.jobId}</code></dd></div>
            <div><dt>Evaluation status</dt><dd>{run.evaluation.status}</dd></div>
            <div><dt>Evaluation error</dt><dd>{run.evaluation.error || '—'}</dd></div>
            <div><dt>Evaluation retry state</dt><dd>{run.evaluation.retryState || '—'}</dd></div>
          </>}
        </dl>
        <div className="logs-table-wrap" tabIndex="0" role="region" aria-label="Stage diagnostics"><table>
          <caption>Stages</caption>
          <thead><tr><th>Stage</th><th>Status</th><th>Duration</th><th>Counts</th><th>Error</th></tr></thead>
          <tbody>{(run.stages || []).map((s, index) => <Stage key={`${s.stage}:${index}`} stage={s} />)}</tbody>
        </table></div>
        <details><summary>Complete run record</summary><pre>{JSON.stringify(run, null, 2)}</pre></details>
      </details>
    </div>}
  </section>
}

const Eyebrow = () => <span className="logs-eyebrow">Private · Read only</span>

export default function ResearchLogs() {
  const { user } = useAuth()
  const [state, setState] = useState(null)
  const [ticker, setTicker] = useState('')
  const [timeWindow, setTimeWindow] = useState('24H')
  const [runType, setRunType] = useState('All')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        if (!user?.getIdToken) throw new Error('Owner sign-in required')
        const token = await user.getIdToken()
        const response = await fetch('/api/get-research?runs=1&hours=720', {
          method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Run history is unavailable')
        if (!controller.signal.aborted) setState({ uid: user.uid, runs: data.runs || [], now: Date.now() })
      } catch (error) {
        if (!controller.signal.aborted) setState({ uid: user?.uid, error: error.message })
      }
    }
    load()
    return () => controller.abort()
  }, [user])

  const current = state?.uid === user?.uid ? state : null
  const search = ticker.trim().toLowerCase()
  const runs = useMemo(() => (current?.runs || []).filter((run) => {
    const started = Date.parse(run.startedAt)
    return started >= current.now - TIME_FILTERS[timeWindow] * 3600000 && started <= current.now
      && (runType === 'All' || run.job === RUN_TYPES[runType])
      && (!search || (run.candidates || []).some((c) => (c.ticker || '').toLowerCase().includes(search)))
  }).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)), [current, search, timeWindow, runType])

  // A non-owner must never learn this page exists: no title, no "Private ·
  // Read only" framing, nothing while loading, and an immediate exit on
  // denial — the same redirect a truly unknown route would produce.
  if (!current) return null
  if (current.error) return <Navigate to="/portfolio" replace />

  return <div className="wallai-system research-logs">
    <header className="logs-head"><Eyebrow /><h1>Research logs</h1>
      <p className="logs-lede">See what research found, what Claude reviewed, and what reached the board. Open a run to follow any candidate’s path.</p>
      <div className="logs-filters">
        <fieldset><legend>Time window</legend><div className="logs-filter-options">{Object.keys(TIME_FILTERS).map((label) => <button type="button" key={label} aria-pressed={timeWindow === label} onClick={() => setTimeWindow(label)}>{label}</button>)}</div></fieldset>
        <fieldset><legend>Run type</legend><div className="logs-filter-options">{Object.keys(RUN_TYPES).map((label) => <button type="button" key={label} aria-pressed={runType === label} onClick={() => setRunType(label)}>{label}</button>)}</div></fieldset>
        <div className="logs-ticker-filter"><label htmlFor="logs-ticker">Search ticker</label>
          <input id="logs-ticker" type="search" value={ticker} onChange={(event) => setTicker(event.target.value)} placeholder="e.g. RKLB" aria-describedby="logs-search-help" />
        </div>
      </div>
      <p id="logs-search-help" className="logs-muted">Search covers all retained runs in the selected time window and run type, including collapsed candidates. History is limited to retained records.</p>
    </header>
    {current.runs.length === 0 && <p className="logs-empty">No research runs recorded in the last 30 days. The next scheduled run will appear here.</p>}
    {current.runs.length > 0 && runs.length === 0 && <p className="logs-empty">{search ? `No runs mention “${ticker.trim()}” in this time window and run type.` : 'No runs in this time window and run type.'}</p>}
    <p className="logs-muted" role="status">{runs.length} run{runs.length === 1 ? '' : 's'} · Last {timeWindow.toLowerCase()}</p>
    {runs.map((run) => <Run key={run.runId} run={run} ticker={search} now={current.now} />)}
  </div>
}
