// Presentation only: persisted jobs, stages and candidate traces stay untouched.
export const TIME_FILTERS = { '12H': 12, '24H': 24, '3D': 72, '7D': 168, '30D': 720 }
export const RUN_TYPES = {
  All: null, 'Nightly Research': 'nightly-research', 'SEC Ingestion': 'research-foundation',
  Evaluation: 'research-evaluation', Performance: 'track-performance',
}
const STAGE_LABELS = {
  x_discovery: 'X discovery', foundation_sync: 'SEC ingestion', foundation_load: 'Load SEC research',
  foundation_followup: 'SEC follow-up', claude_review: 'Claude review',
  evaluation_input_freeze: 'Save evaluation snapshot', performance_tracking: 'Performance tracking',
}
export const friendlyName = (value) => {
  const text = String(value || 'Unknown').replaceAll('_', ' ').replaceAll('-', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
export const stageName = (value) => STAGE_LABELS[value] || friendlyName(value)
export const jobName = (value) => Object.entries(RUN_TYPES).find(([, job]) => job === value)?.[0] || friendlyName(value)
export const statusName = (value) => ({ success: 'Completed', partial: 'Completed with gaps', failed: 'Failed', skipped: 'Skipped', degraded: 'Needs attention' })[value] || friendlyName(value)

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

export function runDescription(run) {
  if (run.job === 'research-foundation') {
    const completed = run.stages?.find((s) => s.stage === 'foundation_sync')?.metrics?.completed
    return Number.isFinite(completed)
      ? `SEC filings processed for ${completed} compan${completed === 1 ? 'y' : 'ies'}. Candidate reviews appear in Nightly Research runs.`
      : 'SEC filing ingestion. Candidate reviews appear in Nightly Research runs.'
  }
  if (run.job === 'research-evaluation') {
    const snapshots = (run.stages || []).filter((s) => s.stage === 'evaluation_snapshot' && Number.isFinite(s.metrics?.observations))
    return snapshots.length
      ? `Evaluation recorded ${snapshots.reduce((sum, s) => sum + s.metrics.observations, 0)} observations across ${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}.`
      : 'Evaluates saved research snapshots in a separate job.'
  }
  if (run.job === 'track-performance') return 'Tracks outcomes for previously published research and evaluation candidates.'
  return null
}

export function summaryCounts(run) {
  const candidates = run.candidates || []
  const funnel = run.admission?.funnel
  const hasCandidates = candidates.length > 0
  return [
    ['Discovered', funnel?.discovered ?? (hasCandidates ? candidates.length : null)],
    ['Sent to Claude', funnel?.sentToClaude ?? (hasCandidates ? candidates.filter(wasSent).length : null)],
    ['Published', funnel?.published ?? (hasCandidates ? candidates.filter((c) => c.outcome === 'published').length : null)],
    ['SEC / fundamental candidates reviewed', hasCandidates ? candidates.filter((c) => wasSent(c) && (
      c.sources?.includes('SEC') || c.strategies?.some((s) => ['fundamentals', 'filing_changes', 'insider'].includes(s))
    )).length : funnel?.sentToClaude === 0 ? 0 : null],
  ]
}

export function runWarnings(run) {
  const warnings = []
  if (run.status === 'failed') warnings.push('This run stopped because of a failure. Some work may be incomplete.')
  if (run.status === 'partial') warnings.push('This run finished, but some steps were skipped, failed, or completed with reduced coverage. See the notes below for what was affected.')
  for (const stage of run.stages || []) {
    const name = stageName(stage.stage)
    if (stage.status === 'failed') warnings.push(`${name} failed. See Technical details for the error.`)
    else if (stage.status === 'skipped') {
      const reason = { time_budget: 'there was not enough time left in this run', inputs_unavailable: 'the required inputs were unavailable', source_errors: 'some data sources reported errors' }[stage.metrics?.reason]
      warnings.push(`${name} was skipped${reason ? ` because ${reason}` : ''}.`)
    } else if (stage.status === 'degraded') warnings.push(`${name} completed with reduced coverage.`)
    else if (stage.error || stage.metrics?.errors > 0) warnings.push(`${name} reported ${stage.metrics?.errors || 'an'} error${stage.metrics?.errors > 1 ? 's' : ''}. See Technical details.`)
  }
  const waiting = run.admission?.funnel?.notReviewed ?? (run.candidates || []).filter((c) => c.reason === 'review_budget_exhausted').length
  if (waiting > 0) warnings.push(`${waiting} eligible candidate${waiting === 1 ? '' : 's'} did not receive a Claude review slot because the review budget was full.`)
  if (run.evaluation?.status === 'failed') warnings.push('The separate evaluation job failed. Research results and evaluation status are tracked separately.')
  return warnings
}
