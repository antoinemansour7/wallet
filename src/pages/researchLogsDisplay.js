// Presentation only: persisted jobs, stages and candidate traces stay untouched.
// Every function here reads a run record and returns display copy. Nothing
// invents a number, a cause or a zero that the record does not contain.
export const TIME_FILTERS = { '12H': 12, '24H': 24, '3D': 72, '7D': 168, '30D': 720 }
export const RUN_TYPES = {
  All: null, 'Nightly Research': 'nightly-research', Reports: 'research-reports', 'SEC Ingestion': 'research-foundation',
  Evaluation: 'research-evaluation', Performance: 'track-performance',
}
const STAGE_LABELS = {
  x_discovery: 'X discovery', foundation_sync: 'SEC ingestion', foundation_load: 'Load SEC research',
  foundation_followup: 'SEC follow-up', claude_review: 'Candidate review',
  evaluation_input_freeze: 'Save evaluation snapshot', performance_tracking: 'Performance tracking',
}
export const friendlyName = (value) => {
  const text = String(value || 'Unknown').replaceAll('_', ' ').replaceAll('-', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
export const stageName = (value) => STAGE_LABELS[value] || friendlyName(value)
export const jobName = (value) => Object.entries(RUN_TYPES).find(([, job]) => job === value)?.[0] || friendlyName(value)

// "Completed with gaps" read healthier than the warning it carried. A partial
// run is named for what it is, and the tone drives one small accent — never the
// whole card.
export const statusName = (value) => ({
  success: 'Completed', partial: 'Partial', failed: 'Failed', skipped: 'Skipped',
  degraded: 'Needs attention', running: 'Running',
})[value] || friendlyName(value)

export const statusTone = (value) => ({
  success: 'positive', partial: 'warning', degraded: 'warning', failed: 'negative',
  skipped: 'muted', running: 'neutral',
})[value] || 'neutral'

// Glyphs are decorative: the status word is always rendered beside them, so a
// screen reader and a monochrome display both still get the state.
export const statusGlyph = (value) => ({
  success: '✓', partial: '⚠', degraded: '⚠', failed: '✕', skipped: '–', running: '•',
})[value] || '•'

/** Exact stage timings stay precise; run headers get a human duration. */
export const seconds = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : 'Unknown')

export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null
  const total = Math.round(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${total % 60}s`
  return `${total}s`
}

export function friendlyTime(iso, now) {
  const date = new Date(iso)
  if (!iso || !Number.isFinite(date.getTime())) return 'Time unavailable'
  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const day = date.toDateString() === today.toDateString() ? 'Today'
    : date.toDateString() === yesterday.toDateString() ? 'Yesterday'
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() && { year: 'numeric' }) })
  return `${day} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
}

export const wasSent = (candidate) => candidate.sentToClaude ?? candidate.reviewed ?? false

const SKIP_REASONS = {
  time_budget: 'there was not enough time left in this run',
  inputs_unavailable: 'the required inputs were unavailable',
  source_errors: 'some data sources reported errors',
}

// Stage + reason pairs the pipeline actually emits, phrased the way an operator
// would say them. Anything unmapped falls back to the stage's own name rather
// than to a guessed cause.
const SKIP_HEADLINES = {
  'evaluation_input_freeze:time_budget': 'Evaluation snapshot was not saved because the run ran out of time',
  'evaluation_input_freeze:inputs_unavailable': 'Evaluation snapshot was not saved because its inputs were unavailable',
  'evaluation_snapshot:time_budget': 'Evaluation snapshot was not saved because the run ran out of time',
}

const skipHeadline = (stage) => {
  const mapped = SKIP_HEADLINES[`${stage.stage}:${stage.metrics?.reason}`]
  if (mapped) return mapped
  const reason = SKIP_REASONS[stage.metrics?.reason]
  return `${stageName(stage.stage)} was skipped${reason ? ` because ${reason}` : ''}`
}

// Only claims the record supports. A caught failure mid-run says nothing about
// what came after it, so only a fatal run gets the "stopped here" sentence.
function failureDetail(run, stage, isLast) {
  if (stage.stage === 'claude_review' && !(run.candidates || []).length) return 'Research stopped before candidate review.'
  if (run.status === 'failed' && isLast) return 'The run stopped here; later steps did not run.'
  return null
}

/**
 * Every problem this run recorded, most important first. One list feeds both
 * the card's single primary message and the full Diagnostics list, so the two
 * can never drift into saying the same thing twice in different words.
 */
export function runIssues(run) {
  const issues = []
  const stages = run.stages || []
  const candidates = run.candidates || []

  stages.forEach((stage, index) => {
    const name = stageName(stage.stage)
    const errors = Number.isFinite(stage.metrics?.errors) ? stage.metrics.errors : null
    if (stage.status === 'failed') {
      issues.push({ severity: 3, headline: `${name} failed`, detail: failureDetail(run, stage, index === stages.length - 1) })
    } else if (stage.status === 'degraded') {
      issues.push({ severity: 2, headline: `${name} completed with reduced coverage` })
    } else if (stage.status === 'skipped') {
      issues.push({ severity: 2, headline: skipHeadline(stage) })
    } else if (stage.stage === 'report_generation' && run.job === 'research-reports' && stage.metrics?.outcome === 'partial') {
      const missing = (stage.metrics.candidates ?? 0) - (stage.metrics.reports ?? 0)
      issues.push({ severity: 2, headline: `${missing} of ${stage.metrics.candidates} reports were not written`, detail: 'Those picks stay published without a report.' })
    } else if (errors > 0) {
      issues.push({ severity: 2, headline: `${name} completed with ${errors} source error${errors === 1 ? '' : 's'}` })
    } else if (stage.error) {
      issues.push({ severity: 2, headline: `${name} reported an error` })
    }
  })

  // A fatal run with no failing stage recorded still has to say so.
  if (run.status === 'failed' && !issues.some((issue) => issue.severity === 3)) {
    issues.push({ severity: 3, headline: 'The run stopped because of a failure', detail: 'No failing step was recorded. The complete record is in Diagnostics.' })
  }
  if (run.evaluation?.status === 'failed') {
    issues.push({ severity: 1, headline: 'The separate evaluation job failed', detail: 'Research results and evaluation status are tracked separately.' })
  }
  const waiting = run.admission?.funnel?.notReviewed ?? candidates.filter((candidate) => candidate.reason === 'review_budget_exhausted').length
  if (waiting > 0) {
    issues.push({
      severity: 1,
      headline: `${waiting} eligible candidate${waiting === 1 ? '' : 's'} did not receive a model review slot`,
      detail: 'The review budget was full. This is a review-slot limit, not a runtime timeout.',
    })
  }
  return issues.sort((a, b) => b.severity - a.severity)
}

export const primaryIssue = (run) => runIssues(run)[0] || null

/**
 * The single message a run card may show. Severity 1 entries are routine
 * bookkeeping — a full review budget is how the pipeline is meant to behave —
 * so they stay in Diagnostics rather than dressing a healthy run as a problem.
 */
export const cardIssue = (run) => runIssues(run).find((issue) => issue.severity >= 2) || null

const count = (value) => (Number.isFinite(value) ? value : null)

/**
 * The compact funnel. Unrecorded steps are dropped rather than rendered as a
 * dash, and a recorded zero is kept as zero.
 */
export function runFunnel(run) {
  const funnel = run.admission?.funnel
  if (!funnel) return null
  const steps = [
    ['Discovered', count(funnel.discovered)],
    ['Eligible', count(funnel.eligible)],
    ['Admitted', count(funnel.admitted)],
    ['Reviewed', count(funnel.sentToClaude)],
    ['Accepted', count(funnel.claudeAccepted)],
    ['Published', count(funnel.published)],
  ].filter(([, value]) => value !== null)
  return steps.length ? steps : null
}

const plural = (value, one, many = `${one}s`) => `${value} ${value === 1 ? one : many}`

/**
 * A job-shaped summary line. Nightly research gets its funnel; ingestion,
 * evaluation and performance get the units they actually record. Nothing is
 * borrowed from another job's vocabulary.
 */
export function runSummary(run) {
  const stages = run.stages || []
  if (run.job === 'research-foundation') {
    const sync = stages.find((stage) => stage.stage === 'foundation_sync')?.metrics || {}
    const facts = []
    if (Number.isFinite(sync.completed)) facts.push(plural(sync.completed, 'company', 'companies') + ' processed')
    if (sync.pending > 0) facts.push(`${plural(sync.pending, 'filing')} pending`)
    if (sync.errors > 0) facts.push(plural(sync.errors, 'source error'))
    return { facts, note: facts.length ? null : 'SEC filing ingestion. Candidate reviews appear in Nightly Research runs.' }
  }
  if (run.job === 'research-evaluation') {
    const snapshots = stages.filter((stage) => stage.stage === 'evaluation_snapshot' && Number.isFinite(stage.metrics?.observations))
    if (!snapshots.length) return { facts: [], note: 'Evaluates saved research snapshots in a separate job.' }
    const observations = snapshots.reduce((sum, stage) => sum + stage.metrics.observations, 0)
    return { facts: [`${plural(observations, 'observation')} across ${plural(snapshots.length, 'snapshot')}`], note: null }
  }
  if (run.job === 'research-reports') {
    const reports = stages.find((stage) => stage.stage === 'report_generation')?.metrics || {}
    if (reports.candidates > 0) return { facts: [`${reports.reports ?? 0} of ${reports.candidates} reports written`], note: null }
    return { facts: [], note: 'No new picks needed a report. Writes reports for the picks each nightly run publishes.' }
  }
  if (run.job === 'track-performance') {
    return { facts: [], note: 'Tracks outcomes for previously published research and evaluation candidates.' }
  }

  const funnel = run.admission?.funnel
  const candidates = run.candidates || []
  const steps = funnel
    ? [['discovered', count(funnel.discovered)], ['reviewed', count(funnel.sentToClaude)], ['accepted', count(funnel.claudeAccepted)], ['published', count(funnel.published)]]
    : candidates.length
      ? [['discovered', candidates.length], ['reviewed', candidates.filter(wasSent).length], ['published', candidates.filter((c) => c.outcome === 'published').length]]
      : []
  return { steps: steps.filter(([, value]) => value !== null), facts: [], note: null }
}

export const publishedTickers = (run) => (run.candidates || [])
  .filter((candidate) => candidate.outcome === 'published')
  .map((candidate) => candidate.ticker || candidate.securityId)
  .filter(Boolean)

/** Older records predate admission and candidate tracing; say so once, quietly. */
export const isLegacyRun = (run) => run.job === 'nightly-research' && !run.admission && !(run.candidates || []).length

/**
 * A scheduled slot whose grace period expired with nothing recorded. Reported
 * separately from run issues on purpose: the evidence here is the *absence* of
 * a run, so there is no run record to hang it on.
 */
export function scheduleAlert(scheduleHealth) {
  const missing = scheduleHealth?.missing || []
  if (!missing.length) return null
  return {
    headline: missing.length === 1
      ? 'A scheduled research run did not arrive'
      : `${missing.length} scheduled research runs did not arrive`,
    detail: Number.isFinite(scheduleHealth.graceMinutes)
      ? `Nothing was recorded ${scheduleHealth.graceMinutes} minutes after the scheduled slot.`
      : 'Nothing was recorded after the scheduled slot.',
    missing,
  }
}
