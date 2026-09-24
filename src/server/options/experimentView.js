import { evaluateOptionsOutcome } from './evaluation.js'
import { STEP1_EXPERIMENTS, STEP1_EXPERIMENT_POLICY } from './step1Experiments.js'

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function latestExperimentRuns(runs) {
  const byDate = new Map()
  for (const run of [...runs].sort((a, b) => a.availableAt.localeCompare(b.availableAt))) {
    const key = `${run.policyVersion}:${run.tradingDate}`
    if (!byDate.has(key)) byDate.set(key, run)
  }
  return [...byDate.values()]
}

function observationResult(item, observations, asOf) {
  try {
    const evaluated = evaluateOptionsOutcome({ plan: item.plan, entry: item.entry, observations, asOf })
    const primary = evaluated.endpoints.find((point) => point.key === '3')
    const days = (Date.parse(primary?.at) - Date.parse(item.plan.entryAt)) / 86400000
    const impliedMovePct = item.entry.iv > 0 && days > 0 ? item.entry.iv * 100 * Math.sqrt(days / 365) : null
    return { status: primary?.status || 'unavailable', returnPct: primary?.returnPct ?? null,
      stockMovePct: primary?.underlyingMovePct ?? null, ivChange: primary?.ivChange ?? null, impliedMovePct,
      absoluteMoveVsImplied: impliedMovePct && Number.isFinite(primary?.underlyingMovePct) ? Math.abs(primary.underlyingMovePct) / impliedMovePct : null,
      checkpoints: evaluated.endpoints.map(({ key, status, returnPct }) => ({ key, status, returnPct })) }
  } catch { return { status: 'evaluation_unavailable', returnPct: null, checkpoints: [] } }
}

export function buildExperimentComparison({ runs, observationsByPlan, asOf }) {
  const frozenRuns = latestExperimentRuns(runs)
  const days = frozenRuns.map((run) => {
    const outcomes = new Map((run.observations || []).map((item) => [item.observationId,
      { ...observationResult(item, observationsByPlan.get(item.plan.planId) || [], asOf), contractId: item.contract.contractId,
        entryAt: item.plan.entryAt, ask: item.entry.quote.ask, score: item.score, iv: item.entry.iv }]))
    const arms = run.arms.map((arm) => {
      const rows = arm.rows.map((row) => ({ ...row, outcome: row.observationId ? outcomes.get(row.observationId) : null }))
      const selected = rows.filter((row) => row.status === 'selected')
      const returns = selected.map((row) => row.outcome?.returnPct).filter(Number.isFinite)
      const matured = Date.parse(run.exitAt) <= Date.parse(asOf)
      const complete = run.status === 'complete' && !rows.some((row) => row.status === 'unavailable')
        && selected.length > 0 && returns.length === selected.length
      return { id: arm.id, requested: rows.length, selected: selected.length,
        ineligible: rows.filter((row) => row.status === 'ineligible').length,
        unavailable: rows.filter((row) => row.status === 'unavailable').length,
        observed: returns.length, unknown: matured ? selected.length - returns.length : 0, pending: matured ? 0 : selected.length,
        complete, matured, meanReturnPct: mean(returns), medianReturnPct: median(returns), signalCoverage: arm.signalCoverage,
        // Rows retained internally for aggregates, only recent selections sent.
        rows }
    })
    return { tradingDate: run.tradingDate, policyVersion: run.policyVersion, status: run.status, availableAt: run.availableAt,
      experimentId: run.experimentId, elapsedMs: run.metrics.elapsedMs, attempts: run.metrics.attempt ?? 1, arms }
  })
  const versions = [...new Set(frozenRuns.map((run) => run.policyVersion))]
  const summaries = versions.flatMap((policyVersion) => STEP1_EXPERIMENTS.map((definition) => {
    const sessions = days.filter((day) => day.policyVersion === policyVersion)
    const arms = sessions.map((day) => day.arms.find((arm) => arm.id === definition.id)).filter(Boolean)
    const returns = arms.flatMap((arm) => arm.rows.map((row) => row.outcome?.returnPct).filter(Number.isFinite))
    const deltas = []
    for (const day of sessions) {
      const arm = day.arms.find((item) => item.id === definition.id), control = day.arms.find((item) => item.id === definition.control)
      if (arm?.complete && control?.complete) deltas.push(arm.meanReturnPct - control.meanReturnPct)
    }
    const sorted = [...returns].sort((a, b) => a - b)
    const total = (key) => arms.reduce((sum, arm) => sum + arm[key], 0)
    return { ...definition, policyVersion, sessions: arms.length, completeSessions: arms.filter((arm) => arm.complete).length,
      requested: total('requested'), selected: total('selected'), ineligible: total('ineligible'), unavailable: total('unavailable'),
      observed: returns.length, unknown: total('unknown'), pending: total('pending'),
      meanReturnPct: mean(returns), medianReturnPct: median(returns), meanWithoutTop5Pct: returns.length > 5 ? mean(sorted.slice(0, -5)) : null,
      worstReturnPct: sorted[0] ?? null, terminal25Pct: returns.length ? returns.filter((value) => value >= 25).length / returns.length * 100 : null,
      positivePct: returns.length ? returns.filter((value) => value > 0).length / returns.length * 100 : null,
      sessionMeanReturnPct: mean(arms.filter((arm) => arm.complete).map((arm) => arm.meanReturnPct)),
      pairedSessions: deltas.length, pairedDeltaPct: mean(deltas) }
  }))
  const latest = [...days].sort((a, b) => b.tradingDate.localeCompare(a.tradingDate))[0]
  return { policy: STEP1_EXPERIMENT_POLICY, definitions: STEP1_EXPERIMENTS, summaries,
    latest: latest || null,
    days: days.map((day) => ({ ...day, arms: day.arms.map(({ rows: _rows, ...arm }) => arm) })),
    limitations: [
      'Every arm uses the separate 9:36–9:50 scan, including the current-score controls. Results are not a replay of the 9:31 live entries.',
      'One best eligible Step 2 contract per stock and direction. Both-direction arms hold equal-premium call and put observations; no claim that direction was predicted.',
      'Primary outcome: ask entry to observed bid at the close three sessions later, including fees and slippage. Missing quotes stay unknown.',
      'The +25% rate is the scheduled exit return, not an intraday target-hit rate. These experiments capture only close checkpoints.',
      'Paired differences require complete observations in both arms on the same session. Daily means use equal premium per selected contract; they are not a capital-constrained portfolio backtest.',
      'Stocks, overlapping holds and experiment arms are correlated. Multiple exploratory comparisons and a small number of sessions cannot establish an edge.',
      'Movement scores are uncalibrated hypotheses. IV-scaled moves use a simple square-root-of-time approximation, not a trade valuation or probability.',
    ] }
}
