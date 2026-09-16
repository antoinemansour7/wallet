import { HORIZON_POLICY_VERSION, strategyPolicy, declaredHorizons, assertDeclaredHorizon } from './research/policy.js'
// Versioned, forward-observed evaluation. These are hypothetical fills, not
// executed trades; changing this policy must start a new comparison cohort.
// v5 changes the primary-review packet from first-N filing characters to
// cited, topic-selected filing/exhibit passages. Keep its outcomes out of the
// v4 cohort because the model had materially different evidence available.
export const RESEARCH_MODEL_VERSION = 'evidence-v5-gpt-5.4-mini'
export const LEGACY_EVALUATION_VERSION = 'next-open-5-session-v1'
export const EVALUATION_VERSION = 'next-open-strategy-session-v2'
export const ROUND_TRIP_COST_BPS = 20
const positive = (value) => Number.isFinite(value) && value > 0

export function sessionCheckpoints(candles, generatedAt, now = Date.now(), benchmark = [], costBps = ROUND_TRIP_COST_BPS, policy = {}) {
  if (policy.strategyFamily && (policy.horizon !== strategyPolicy(policy.strategyFamily).horizon || policy.horizonPolicyVersion !== HORIZON_POLICY_VERSION)) throw new Error('Stored horizon policy mismatch; do not relabel a cohort')
  const issued = Math.max(Date.parse(generatedAt), Date.parse(policy.earliestActionAt || generatedAt))
  if (!Number.isFinite(issued) || !Number.isFinite(costBps) || costBps < 0) return []
  // Daily Yahoo timestamps identify the regular-session open. Requiring the
  // full 6.5 hours also conservatively delays early-close sessions.
  const sessions = [...new Map((candles || [])
    .filter((bar) => Number.isFinite(bar.timestamp) && bar.timestamp >= issued)
    .map((bar) => [bar.timestamp, bar])).values()].sort((a, b) => a.timestamp - b.timestamp)
  const entry = sessions[0]
  if (!entry || !positive(entry.open)) return []
  const byDate = new Map(benchmark.map((bar) => [bar.date, bar]))
  const benchmarkEntry = byDate.get(entry.date)
  const returns = []
  // Checkpoints below the ranking horizon are measured for visibility, but only
  // the ones the strategy predeclared may be evaluated. Marking them here keeps
  // that distinction in the data instead of in a reader's memory.
  const declared = policy.strategyFamily ? declaredHorizons(policy.strategyFamily) : [policy.horizon].filter(Boolean)
  for (const horizon of [1, 3, 5, 10, 20, 60].filter((h) => !policy.horizon || h <= policy.horizon)) {
    const exit = sessions[horizon - 1]
    if (!exit || exit.timestamp + 6.5 * 3600000 > now || !positive(exit.close)) continue
    // Missing price bars are not skipped to substitute a later trading day.
    if (sessions.slice(0, horizon).some((bar) => !positive(bar.open) || !positive(bar.close))) continue
    const grossReturn = (exit.close / entry.open - 1) * 100
    const netReturn = grossReturn - costBps / 100
    const benchmarkExit = byDate.get(exit.date)
    const benchmarkReturn = positive(benchmarkEntry?.open) && positive(benchmarkExit?.close)
      ? (benchmarkExit.close / benchmarkEntry.open - 1) * 100 : null
    returns.push({
      horizon, declared: declared.includes(horizon),
      entryPrice: entry.open, exitPrice: exit.close,
      entryDate: entry.date, exitDate: exit.date,
      grossReturn, netReturn, costBps, benchmarkReturn,
      excessReturn: benchmarkReturn === null ? null : netReturn - benchmarkReturn,
      day1High: positive(entry.high) ? entry.high : null,
      evaluationVersion: policy.evaluationVersion || EVALUATION_VERSION,
    })
  }
  return returns
}

function aggregate(records) {
  if (!records.length) return { total: 0, distinctDates: 0 }
  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length
  // Same-day picks share market exposure; do not treat them as independent
  // evidence when estimating the uncertainty of their excess returns.
  const dates = new Map()
  for (const record of records) {
    if (!dates.has(record.pickDate)) dates.set(record.pickDate, [])
    dates.get(record.pickDate).push(record.excess_return_day5)
  }
  const daily = [...dates.values()].map(average)
  const dailyMean = average(daily)
  const variance = daily.length > 1 ? daily.reduce((sum, value) => sum + (value - dailyMean) ** 2, 0) / (daily.length - 1) : null
  const uncertainty = variance === null ? null : 2 * Math.sqrt(variance / daily.length)
  return {
    total: records.length, distinctDates: dates.size,
    avgNetReturn: average(records.map((r) => r.net_return_day5)),
    avgExcessReturn: dailyMean,
    lowerBound: uncertainty === null ? null : dailyMean - uncertainty,
    upperBound: uncertainty === null ? null : dailyMean + uncertainty,
    worstReturn: Math.min(...records.map((r) => r.net_return_day5)),
  }
}

export function computeLearningStats(records, now = Date.now(), { horizon = 5, strategyFamily } = {}) {
  if (![5, 20, 60].includes(horizon)) throw new Error('Unsupported learning horizon')
  // Asking a strategy how it did at a horizon it never declared is the
  // retrospective pick the policy exists to prevent, so it fails loudly rather
  // than quietly returning a number someone can quote.
  if (strategyFamily) assertDeclaredHorizon(strategyFamily, horizon)
  const seen = new Set()
  const eligible = records.filter((record) => {
    const key = record.candidateId || `${record.pickDate}:${record.securityId || record.ticker}:${record.strategyFamily || 'attention'}`
    // A record is evaluable at every horizon its strategy predeclared, not only
    // at the one it is ranked on. Without this a fundamentals pick could never
    // be read at 5 even though the 5-session checkpoint was measured and stored
    // beside the 20 — which is the whole point of declaring both.
    const recordHorizons = Array.isArray(record.horizons) && record.horizons.length ? record.horizons : [record.horizon || 5]
    if (!recordHorizons.includes(horizon) || (strategyFamily && (record.strategyFamily || 'attention') !== strategyFamily)) return false
    if (record.horizon && record.horizonPolicyVersion !== HORIZON_POLICY_VERSION) return false
    if (seen.has(key) || record.shadow || record.modelVersion !== RESEARCH_MODEL_VERSION
      || record.evaluationVersion !== EVALUATION_VERSION
      || !Number.isFinite(record[`net_return_day${horizon}`]) || !Number.isFinite(record[`excess_return_day${horizon}`])
      || !record[`exit_date_day${horizon}`] || !(Date.parse(record[`exit_date_day${horizon}`]) <= now)) return false
    seen.add(key)
    return true
  }).map((record) => ({ ...record, net_return_day5: record[`net_return_day${horizon}`], excess_return_day5: record[`excess_return_day${horizon}`] }))
  const group = (keys) => {
    const groups = new Map()
    for (const record of eligible) for (const key of new Set(keys(record))) {
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(record)
    }
    return Object.fromEntries([...groups].map(([key, values]) => [key, aggregate(values)]))
  }
  return {
    modelVersion: RESEARCH_MODEL_VERSION, evaluationVersion: EVALUATION_VERSION,
    horizon, strategyFamily: strategyFamily || null, horizonPolicyVersion: HORIZON_POLICY_VERSION, costBps: ROUND_TRIP_COST_BPS,
    ...aggregate(eligible),
    byStrategy: group((r) => [r.strategyFamily || 'attention']),
    bySetup: group((r) => [r.setupType || 'unknown']),
    bySource: group((r) => r.sources || []),
  }
}

export function evidenceAdjustment(stats) {
  if (!stats || stats.total < 20 || stats.distinctDates < 10
    || !Number.isFinite(stats.avgNetReturn) || !Number.isFinite(stats.avgExcessReturn)
    || !Number.isFinite(stats.lowerBound) || !Number.isFinite(stats.upperBound)) return 0
  const positiveEvidence = stats.lowerBound > 0 && stats.avgNetReturn > 0
  const negativeEvidence = stats.upperBound < 0
  if (!positiveEvidence && !negativeEvidence) return 0
  const shrunk = stats.avgExcessReturn * stats.total / (stats.total + 40)
  return Number(Math.max(-1, Math.min(1, shrunk)).toFixed(2))
}
