import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import '../components/landing/tokens.css'
import './ResearchLogs.css'
import {
  TIME_FILTERS, RUN_TYPES, cardIssue, duration, friendlyName, friendlyTime, isLegacyRun, jobName,
  publishedTickers, runFunnel, runIssues, runSummary, scheduleAlert, seconds, stageName, statusGlyph,
  statusName, statusTone, wasSent,
} from './researchLogsDisplay'

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

function Status({ status }) {
  return <span className={`logs-status logs-tone-${statusTone(status)}`}>
    <span className="logs-status-glyph" aria-hidden="true">{statusGlyph(status)}</span>{statusName(status)}
  </span>
}

/* ---------------------------------------------------------------- diagnostics */

function Stage({ stage }) {
  return <tr className={`logs-stage logs-stage-${stage.status}`}>
    <th scope="row">{stageName(stage.stage)}<code className="logs-subline">{stage.stage}</code></th>
    <td>{stage.status}</td>
    <td>{seconds(stage.durationMs)}</td>
    <td>{Object.entries(stage.metrics || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || '—'}</td>
    <td>{stage.error?.message || ''}</td>
  </tr>
}

function Funnel({ run }) {
  const steps = runFunnel(run)
  if (!steps) return null
  return <ol className="logs-funnel" aria-label="Research admission funnel">
    {steps.map(([label, value], index) => <li className="logs-funnel-step" key={label}>
      {index > 0 && <span className="logs-funnel-arrow" aria-hidden="true" />}
      <span className="logs-funnel-cell"><span className="logs-funnel-label">{label}</span><strong>{value}</strong></span>
    </li>)}
  </ol>
}

function StreamBreakdown({ streams = [] }) {
  if (!streams.length) return null
  return <>
    <div className="logs-table-wrap" tabIndex="0" role="region" aria-label="Admission by strategy"><table>
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
    {streams.some((stream) => stream.belowCutoff?.length) && <details className="logs-disclosure">
      <summary>Inspect candidates immediately below each cutoff</summary>
      <div className="logs-cutoff-grid">{streams.filter((stream) => stream.belowCutoff?.length).map((stream) => <section key={stream.strategy}>
        <h4>{title(stream.strategy)} cutoff</h4>
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

function Diagnostics({ run }) {
  const issues = runIssues(run)
  const waiting = run.admission?.funnel?.notReviewed
  return <div className="logs-panel-body">
    {issues.length > 0 && <section className="logs-block">
      <h3>Recorded issues</h3>
      <ul className="logs-issue-list" aria-label="Warnings and failures">
        {issues.map((issue, index) => <li key={index}>{issue.headline}{issue.detail ? `. ${issue.detail}` : ''}</li>)}
      </ul>
    </section>}

    <section className="logs-block">
      <h3>Run record</h3>
      <dl className="logs-facts">
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
      {isLegacyRun(run) && <p className="logs-note">Some detailed metrics were not recorded for this older run.</p>}
    </section>

    <section className="logs-block">
      <h3>Stages</h3>
      <div className="logs-table-wrap" tabIndex="0" role="region" aria-label="Stage diagnostics"><table>
        <caption className="logs-sr">Stages</caption>
        <thead><tr><th>Stage</th><th>Status</th><th>Duration</th><th>Counts</th><th>Error</th></tr></thead>
        <tbody>{(run.stages || []).map((s, index) => <Stage key={`${s.stage}:${index}`} stage={s} />)}</tbody>
      </table></div>
    </section>

    {run.admission && <section className="logs-block">
      <h3>Admission and cutoffs</h3>
      {Number.isFinite(waiting) && <p className="logs-note">
        <strong>{waiting}</strong> eligible candidate{waiting === 1 ? '' : 's'} passed identity and evidence eligibility but did not receive one of the
        configured review slots. This is a review-slot limit, not a cron-runtime timeout.
      </p>}
      {run.admission.priorityModel && <dl className="logs-facts">
        <div><dt>Priority model</dt><dd><code>{run.admission.priorityModel.version || friendlyName(run.admission.priorityModel)}</code></dd></div>
      </dl>}
      <StreamBreakdown streams={run.admission.streams} />
      {(run.admission.reallocations || []).length > 0 && <details className="logs-disclosure">
        <summary>Budget reallocations</summary>
        <pre>{JSON.stringify(run.admission.reallocations, null, 2)}</pre>
      </details>}
    </section>}
    {!run.admission && !isLegacyRun(run) && run.job === 'nightly-research' &&
      <p className="logs-note">Admission diagnostics were not recorded for this run.</p>}

    <details className="logs-disclosure"><summary>Complete run record</summary><pre>{JSON.stringify(run, null, 2)}</pre></details>
  </div>
}

/* ----------------------------------------------------------------- candidates */

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

function holdingPeriodOutcomes(candidate) {
  return Object.entries(candidate.outcomesByHorizon || {}).sort(([a], [b]) => Number(a) - Number(b))
}

function outcomeScoreLabel(outcome) {
  if (!Number.isFinite(outcome.score)) return null
  return `${outcome.scoreKind === 'composite' ? 'Final composite' : 'Model'} score ${outcome.score}`
}

function HoldingPeriodOutcomes({ candidate }) {
  const entries = holdingPeriodOutcomes(candidate)
  if (!entries.length) {
    if (!Number.isFinite(candidate.finalScore) && !candidate.rank && candidate.catalystVerified === undefined) return '—'
    return <span className="logs-subline">Holding period unavailable in this older log · {Number.isFinite(candidate.finalScore) ? `Recorded score ${candidate.finalScore}` : 'Score —'}
      {candidate.rank ? ` · Recorded rank #${candidate.rank}` : ''}
      {candidate.catalystVerified === undefined ? '' : ` · Catalyst ${candidate.catalystVerified ? 'verified' : 'unverified'}`}</span>
  }
  return <>{entries.map(([horizon, outcome]) => <span className="logs-subline" key={horizon}>
    {horizon} sessions · {outcome.status === 'accepted' ? 'Accepted' : outcome.status === 'rejected' ? 'Rejected' : outcome.status === 'not_sent' ? 'Not sent to model' : 'Reviewed'}
    {outcomeScoreLabel(outcome) ? ` · ${outcomeScoreLabel(outcome)}` : ''}
    {outcome.published ? Number.isFinite(outcome.rank) ? ` · Published #${outcome.rank}` : ' · Published (rank unavailable)' : ' · Not published'}
    {outcome.catalystVerified === undefined ? '' : ` · Catalyst ${outcome.catalystVerified ? 'verified' : 'unverified'}`}
  </span>)}</>
}

// The scannable line: only facts this candidate actually carries.
function candidateFacts(candidate) {
  const facts = []
  const strategies = (candidate.strategies || []).map(title).filter(Boolean)
  if (strategies.length) facts.push(strategies.join(' · '))
  if (Number.isFinite(candidate.priority)) facts.push(`priority ${candidate.priority}`)
  const outcomes = holdingPeriodOutcomes(candidate)
  if (outcomes.length) {
    for (const [horizon, outcome] of outcomes) {
      const parts = [outcomeScoreLabel(outcome), outcome.published && Number.isFinite(outcome.rank) ? `#${outcome.rank}` : null].filter(Boolean)
      if (parts.length) facts.push(`${horizon}s ${parts.join(' · ')}`)
    }
  } else {
    if (Number.isFinite(candidate.finalScore)) facts.push(`recorded score ${candidate.finalScore}`)
    if (candidate.rank) facts.push(`recorded #${candidate.rank}`)
  }
  return facts.join(' · ')
}

function Candidate({ candidate }) {
  const sentToClaude = wasSent(candidate)
  const claudeLabel = candidate.claudeStatus === 'accepted' || candidate.outcome === 'published' || candidate.outcome === 'accepted'
    ? 'Accepted'
    : candidate.claudeStatus === 'reviewed_not_selected' || (sentToClaude && candidate.outcome === 'reviewed_rejected')
      ? 'Reviewed, not selected'
      : sentToClaude ? 'Sent; result unavailable' : 'Not sent'
  const admitted = candidate.admitted === undefined ? (candidate.admission ? 'Yes' : 'Unknown') : candidate.admitted ? 'Yes' : 'No'
  const facts = candidateFacts(candidate)
  return <details className="logs-candidate">
    <summary>
      <span className="logs-candidate-identity">
        <span className="logs-symbol">{candidate.ticker || candidate.securityId || 'Unknown security'}</span>
        {candidate.name && <span className="logs-company">{candidate.name}</span>}
        {facts && <span className="logs-candidate-facts-line">{facts}</span>}
      </span>
      <span className="logs-candidate-outcome">{OUTCOME[candidate.outcome] || friendlyName(candidate.outcome)}</span>
    </summary>
    <dl className="logs-facts">
      <div><dt>Strategy / source</dt><dd>{(candidate.strategies || []).map(title).join(' · ') || '—'}<span className="logs-subline">{(candidate.sources || []).join(' · ') || '—'}</span>
        {candidate.horizons?.length > 0 && <span className="logs-subline">Declared evaluation: {candidate.horizons.join(', ')} sessions</span>}
        {candidate.duplicateAcrossStreams && <span className="logs-subline">One security across multiple streams</span>}</dd></div>
      <div><dt>Priority</dt><dd>{number(candidate.priority)}</dd></div>
      <div><dt>Admission rank</dt><dd><Rank candidate={candidate} /></dd></div>
      <div><dt>Admitted to review budget</dt><dd>{admitted}{candidate.admission && <span className="logs-subline">{title(candidate.admission.stream)} · {friendlyName(candidate.admission.kind)}</span>}</dd></div>
      <div><dt>Sent to model</dt><dd>{sentToClaude ? 'Yes' : 'No'}</dd></div>
      <div><dt>Review result</dt><dd>{claudeLabel}</dd></div>
      <div><dt>Holding-period outcomes</dt><dd><HoldingPeriodOutcomes candidate={candidate} /></dd></div>
      <div><dt>Published</dt><dd>{candidate.outcome === 'published' ? 'Yes' : 'No'}</dd></div>
      <div><dt>Evidence</dt><dd><Evidence candidate={candidate} /></dd></div>
    </dl>
    {candidate.reason === 'review_budget_exhausted' && <p className="logs-note">Eligible for review, but all configured model review slots were used. This is a review-slot limit, not a runtime timeout.</p>}
    <details className="logs-disclosure">
      <summary>Technical details</summary>
      <dl className="logs-facts">
        <div><dt>Security ID</dt><dd><code>{candidate.securityId || '—'}</code></dd></div>
        <div><dt>Reason</dt><dd>{holdingPeriodOutcomes(candidate).length
          ? holdingPeriodOutcomes(candidate).map(([horizon, outcome]) => <span className="logs-subline" key={horizon}>{horizon} sessions · {outcome.reason || '—'}</span>)
          : candidate.reason || '—'}</dd></div>
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
    {hidden.length > 0 && <details className="logs-disclosure"><summary>Show all {candidates.length} eligible candidates</summary>{rows(hidden)}</details>}
  </section>
}

function Candidates({ candidates, filtered }) {
  const byOutcome = {
    published: candidates.filter((candidate) => candidate.outcome === 'published'),
    accepted: candidates.filter((candidate) => candidate.outcome === 'accepted'),
    reviewed: candidates.filter((candidate) => candidate.outcome === 'reviewed_rejected'),
    waiting: candidates.filter((candidate) => candidate.outcome === 'not_reviewed'),
    discovered: candidates.filter((candidate) => !['published', 'accepted', 'reviewed_rejected', 'not_reviewed'].includes(candidate.outcome)),
  }
  return <div className="logs-panel-body">
    <CandidateGroup title="Published" candidates={byOutcome.published} filtered={filtered} />
    <CandidateGroup title="Reviewed, not published" candidates={byOutcome.accepted} filtered={filtered} />
    <CandidateGroup title="Reviewed but rejected" candidates={byOutcome.reviewed} filtered={filtered} />
    <CandidateGroup title="Eligible but not reviewed" candidates={byOutcome.waiting} compact filtered={filtered} />
    <CandidateGroup title="Discovered only / not eligible" candidates={byOutcome.discovered} filtered={filtered} />
  </div>
}

/* ------------------------------------------------------------------- overview */

function Evaluation({ run, now }) {
  if (run.job !== 'nightly-research') return null
  const evaluation = run.evaluation
  return <div className="logs-block" aria-label="Evaluation handoff">
    <h3>Evaluation handoff</h3>
    {!evaluation
      ? <p className="logs-muted">Evaluation input — not frozen (inputs unavailable or time budget).</p>
      : <dl className="logs-facts">
        <div><dt>Evaluation input</dt><dd>Frozen · <time dateTime={evaluation.frozenAt} title={evaluation.frozenAt}>{friendlyTime(evaluation.frozenAt, now)}</time></dd></div>
        <div><dt>Evaluation job</dt><dd className={`logs-tone-${evaluation.status === 'completed' ? 'positive' : evaluation.status === 'failed' ? 'negative' : 'neutral'}`}>{statusName(evaluation.status)}</dd></div>
      </dl>}
  </div>
}

function Overview({ run, now }) {
  const funnel = runFunnel(run)
  return <div className="logs-panel-body">
    <dl className="logs-facts">
      <div><dt>Started</dt><dd>{friendlyTime(run.startedAt, now)}</dd></div>
      <div><dt>Finished</dt><dd>{run.finishedAt ? friendlyTime(run.finishedAt, now) : '—'}</dd></div>
      <div><dt>Duration</dt><dd>{duration(run.durationMs) || '—'}</dd></div>
    </dl>
    {funnel && <section className="logs-block"><h3>Funnel</h3><Funnel run={run} /></section>}
    <Evaluation run={run} now={now} />
  </div>
}

/* ----------------------------------------------------------------------- tabs */

function Tabs({ tabs, initial, runId }) {
  const [active, setActive] = useState(initial)
  const refs = useRef({})
  const current = tabs.find((tab) => tab.id === active) ? active : tabs[0].id

  const onKeyDown = (event) => {
    const offset = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    const jump = { Home: 0, End: tabs.length - 1 }[event.key]
    const index = tabs.findIndex((tab) => tab.id === current)
    const next = offset !== undefined ? (index + offset + tabs.length) % tabs.length : jump
    if (next === undefined) return
    event.preventDefault()
    setActive(tabs[next].id)
    refs.current[tabs[next].id]?.focus()
  }

  return <>
    <div className="logs-tablist" role="tablist" aria-label="Run detail" onKeyDown={onKeyDown}>
      {tabs.map((tab) => <button
        key={tab.id} type="button" role="tab" id={`${runId}-tab-${tab.id}`}
        aria-selected={current === tab.id} aria-controls={`${runId}-panel-${tab.id}`}
        tabIndex={current === tab.id ? 0 : -1}
        ref={(node) => { refs.current[tab.id] = node }}
        onClick={() => setActive(tab.id)}
      >{tab.label}</button>)}
    </div>
    {tabs.map((tab) => current === tab.id && <div
      key={tab.id} role="tabpanel" id={`${runId}-panel-${tab.id}`}
      aria-labelledby={`${runId}-tab-${tab.id}`} tabIndex={0}
    >{tab.render()}</div>)}
  </>
}

/* ------------------------------------------------------------------ run card */

function Run({ run, ticker, now }) {
  const [expanded, setExpanded] = useState(false)
  const all = run.candidates || []
  const candidates = ticker ? all.filter((c) => (c.ticker || '').toLowerCase().includes(ticker)) : all
  const summary = runSummary(run)
  const issue = cardIssue(run)
  const issueCount = runIssues(run).length
  const published = publishedTickers(run)
  const runDuration = duration(run.durationMs)
  const open = expanded || Boolean(ticker)

  const tabs = [
    { id: 'overview', label: 'Overview', render: () => <Overview run={run} now={now} /> },
    ...(candidates.length ? [{ id: 'candidates', label: `Candidates · ${candidates.length}`, render: () => <Candidates candidates={candidates} filtered={Boolean(ticker)} /> }] : []),
    { id: 'diagnostics', label: 'Diagnostics', render: () => <Diagnostics run={run} /> },
  ]

  return <article className={`logs-run logs-run-${statusTone(run.status)}`} aria-label={`${jobName(run.job)} ${run.startedAt}`}>
    <div className="logs-run-head">
      <h2>{jobName(run.job)}</h2>
      <Status status={run.status} />
    </div>
    <p className="logs-run-meta">
      <time dateTime={run.startedAt} title={run.startedAt}>{friendlyTime(run.startedAt, now)}</time>
      {runDuration && <><span aria-hidden="true"> · </span><span title="Run duration">{runDuration}</span></>}
    </p>

    {summary.steps?.length > 0 && <p className="logs-chain" aria-label="Run summary">
      {summary.steps.map(([label, value], index) => <span className="logs-chain-step" key={label}>
        {index > 0 && <span className="logs-chain-arrow" aria-hidden="true">→</span>}
        <strong>{value}</strong> {label}
      </span>)}
    </p>}
    {summary.facts?.length > 0 && <p className="logs-chain" aria-label="Run summary">{summary.facts.join(' · ')}</p>}
    {summary.note && !issue && <p className="logs-muted">{summary.note}</p>}

    {published.length > 0 && <p className="logs-run-published">
      <span className="logs-muted">Published:</span> {published.join(' · ')}
    </p>}

    {issue && <div className="logs-run-issue">
      <p className="logs-issue">{issue.headline}</p>
      {issue.detail && <p className="logs-muted">{issue.detail}</p>}
      {issueCount > 1 && <p className="logs-muted">{issueCount - 1} additional issue{issueCount - 1 === 1 ? '' : 's'}</p>}
    </div>}

    {ticker && <p className="logs-muted">{candidates.length} matching candidate{candidates.length === 1 ? '' : 's'} · Summary counts describe the entire run.</p>}

    <div className="logs-run-foot">
      <button className="logs-expand" type="button" aria-expanded={open} aria-controls={`run-${run.runId}`}
        onClick={() => setExpanded(!expanded)} disabled={Boolean(ticker)}>
        {open ? 'Hide details' : 'View details'}<span aria-hidden="true">{open ? ' ↑' : ' →'}</span>
      </button>
    </div>

    {open && <div id={`run-${run.runId}`} className="logs-run-body">
      <Tabs tabs={tabs} initial={ticker ? 'candidates' : 'overview'} runId={run.runId} />
    </div>}
  </article>
}

const Eyebrow = () => <span className="logs-eyebrow">Private · Read only</span>

// Page-level, not a run card: a slot that produced nothing has no run to sit
// inside, and it outranks anything in the list below it. It takes the same
// restrained treatment as a warning run — neutral surface, amber accent only.
function ScheduleAlert({ scheduleHealth, now }) {
  const alert = scheduleAlert(scheduleHealth)
  if (!alert) return null
  return <section className="logs-alert" role="alert" aria-label="Schedule health warning">
    <div className="logs-alert-head">
      <span className="logs-status logs-tone-warning">
        <span className="logs-status-glyph" aria-hidden="true">⚠</span>Missed schedule
      </span>
    </div>
    <p className="logs-issue">{alert.headline}</p>
    <p className="logs-muted">{alert.detail}</p>
    <ul className="logs-alert-list">
      {alert.missing.map((item) => <li key={`${item.job}:${item.expectedAt}`}>
        <strong>{jobName(item.job)}</strong>
        <span className="logs-muted"> · expected {friendlyTime(item.expectedAt, now)}</span>
        {item.lastRunAt && <span className="logs-muted"> · last recorded {friendlyTime(item.lastRunAt, now)}</span>}
      </li>)}
    </ul>
  </section>
}

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
        if (!response.ok) {
          const error = new Error(data.error || 'Run history is unavailable')
          error.status = response.status
          throw error
        }
        if (!controller.signal.aborted) setState({ uid: user.uid, runs: data.runs || [], scheduleHealth: data.scheduleHealth, now: Date.now() })
      } catch (error) {
        if (!controller.signal.aborted) setState({ uid: user?.uid, error: error.message, errorStatus: error.status })
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
  // denial — the same redirect a truly unknown route would produce. That
  // applies only to an actual ownership denial (401/403) or a request that
  // never got a response at all. verifyOwner runs before any storage read,
  // so any other status (503 storage unavailable, 400 bad request) means the
  // caller already cleared the owner check — they should see why the page is
  // degraded, not be bounced out as though the page didn't exist.
  if (!current) return null
  const denied = current.error && (!current.errorStatus || current.errorStatus === 401 || current.errorStatus === 403)
  if (denied) return <Navigate to="/portfolio" replace />

  if (current.error) return <div className="wallai-system research-logs">
    <header className="logs-head">
      <Eyebrow />
      <h1>Research activity</h1>
    </header>
    <p className="logs-empty" role="alert">Logs are temporarily unavailable — {current.error} This page will work again once storage recovers.</p>
  </div>

  return <div className="wallai-system research-logs">
    <header className="logs-head">
      <Eyebrow />
      <h1>Research activity</h1>
      <p className="logs-lede">Research runs, reviews and pipeline health.</p>
      <div className="logs-toolbar">
        <div className="logs-segmented" role="group" aria-label="Time window">
          {Object.keys(TIME_FILTERS).map((label) => <button type="button" key={label}
            aria-pressed={timeWindow === label} onClick={() => setTimeWindow(label)}>{label}</button>)}
        </div>
        <label className="logs-sr" htmlFor="logs-run-type">Run type</label>
        <select id="logs-run-type" className="logs-select" value={runType} onChange={(event) => setRunType(event.target.value)}>
          {Object.keys(RUN_TYPES).map((label) => <option key={label} value={label}>{label === 'All' ? 'All run types' : label}</option>)}
        </select>
        <label className="logs-sr" htmlFor="logs-ticker">Search ticker</label>
        <input id="logs-ticker" className="logs-search" type="search" value={ticker}
          onChange={(event) => setTicker(event.target.value)} placeholder="Search ticker…" aria-describedby="logs-search-help" />
      </div>
      <p id="logs-search-help" className="logs-sr">Search covers all retained runs in the selected time window and run type, including collapsed candidates.</p>
    </header>

    <ScheduleAlert scheduleHealth={current.scheduleHealth} now={current.now} />
    <p className="logs-count" role="status">{runs.length} run{runs.length === 1 ? '' : 's'} · Last {timeWindow.toLowerCase()}</p>
    {current.runs.length === 0 && <p className="logs-empty">No research runs recorded in the last 30 days. The next scheduled run will appear here.</p>}
    {current.runs.length > 0 && runs.length === 0 && <p className="logs-empty">{search ? `No runs mention “${ticker.trim()}” in this time window and run type.` : 'No runs in this time window and run type.'}</p>}
    {runs.map((run) => <Run key={run.runId} run={run} ticker={search} now={current.now} />)}
  </div>
}
