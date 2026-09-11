import { digest } from './archive.js'
import { latestEvaluationJob } from './evaluationJob.js'
import { ARMS, COST_SCENARIOS, EVALUATION_ID, finalSealed } from './evaluationPolicy.js'

export const SECTOR_BENCHMARKS = Object.freeze({ Technology: 'XLK', Healthcare: 'XLV', 'Health Care': 'XLV',
  Financials: 'XLF', 'Financial Services': 'XLF', Energy: 'XLE', Industrials: 'XLI', Utilities: 'XLU',
  'Consumer Cyclical': 'XLY', 'Consumer Discretionary': 'XLY', 'Consumer Defensive': 'XLP',
  'Consumer Staples': 'XLP', 'Real Estate': 'XLRE', 'Communication Services': 'XLC', 'Basic Materials': 'XLB', Materials: 'XLB' })
const positive = (v) => Number.isFinite(v) && v > 0
const mean = (v) => v.length ? v.reduce((s, n) => s + n, 0) / v.length : null
const median = (v) => {
  if (!v.length) return null
  const ordered = [...v].sort((a, b) => a - b), middle = Math.floor(v.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}
const sessionEnd = (b) => b.timestamp + 6.5 * 3600000
const sorted = (bars) => [...new Map(bars.filter((b) => b.date && Number.isFinite(b.timestamp)).map((b) => [b.date, b])).values()]
  .sort((a, b) => a.timestamp - b.timestamp)

// SPY supplies the exchange calendar; a missing stock bar never shifts the exit
// to a later day. Returns are next executable open to exact session close.
export function evaluateObservation(observation, { stock = [], benchmark = [], sector = [], identityAvailable = true }, now) {
  const timestamp = new Date(now).getTime()
  const earliest = Math.max(Date.parse(observation.decisionAt), Date.parse(observation.earliestActionAt))
  const calendar = sorted(benchmark).filter((b) => b.timestamp >= earliest && sessionEnd(b) <= timestamp)
  const byDate = new Map(stock.map((b) => [b.date, b])), sectorByDate = new Map(sector.map((b) => [b.date, b]))
  const entry = byDate.get(calendar[0]?.date)
  const currencyMatches = observation.currency === 'USD' && (!entry?.currency || entry.currency === observation.currency)
  return observation.horizons.map((horizon) => {
    const base = { observationId: observation.id, horizon, availableAt: new Date(timestamp).toISOString(),
      evaluationVersion: 'matrix-next-open-v1', status: 'pending', reason: null,
      entryDate: calendar[0]?.date || null, exitDate: calendar[horizon - 1]?.date || null,
      entryPrice: null, exitPrice: null, grossReturn: null, netReturn: null, benchmarkReturn: null,
      excessReturn: null, sectorReturn: null, sectorExcessReturn: null, costBps: observation.costBps,
      adverseFillNetReturn: null,
      stressReturns: Object.fromEntries(COST_SCENARIOS.map((c) => [c, null])), path: [] }
    if (!identityAvailable) return { ...base, status: 'unavailable', reason: 'historical_security_identity_unavailable' }
    if (!Number.isFinite(earliest)) return { ...base, status: 'unavailable', reason: 'decision_time_unavailable' }
    if (!benchmark.length) return { ...base, status: 'unavailable', reason: 'exchange_calendar_unavailable' }
    if (!calendar.length) return base
    if (!positive(entry?.open) || !currencyMatches) return { ...base, status: 'unavailable', reason: 'entry_price_or_currency_unavailable' }
    base.entryPrice = entry.open
    base.path = calendar.slice(0, horizon).map((b) => {
      const bar = byDate.get(b.date)
      return { date: b.date, timestamp: b.timestamp, close: positive(bar?.close) ? bar.close : null,
        returnPercent: positive(bar?.close) ? (bar.close / entry.open - 1) * 100 : null }
    })
    if (calendar.length < horizon) return base
    const exit = byDate.get(calendar[horizon - 1].date)
    // A missing intermediate session could hide a halt or a corporate action.
    if (base.path.some((p) => !positive(p.close))) return { ...base, status: 'unavailable', reason: 'session_price_unavailable' }
    const stockReturn = (exit.close / entry.open - 1) * 100
    const comparison = (first, last) => positive(first?.open) && positive(last?.close) ? (last.close / first.open - 1) * 100 : null
    const benchmarkReturn = comparison(calendar[0], calendar[horizon - 1])
    const sectorReturn = comparison(sectorByDate.get(base.entryDate), sectorByDate.get(base.exitDate))
    const cost = Number.isFinite(observation.costBps) && observation.costBps >= 0 ? observation.costBps : null
    const net = cost === null ? null : stockReturn - cost / 100
    return { ...base, status: 'completed', exitPrice: exit.close, grossReturn: stockReturn, netReturn: net,
      adverseFillNetReturn: cost === null ? null : (exit.close * 0.9975 / (entry.open * 1.0025) - 1) * 100 - cost / 100,
      benchmarkReturn, excessReturn: net === null || benchmarkReturn === null ? null : net - benchmarkReturn,
      sectorReturn, sectorExcessReturn: net === null || sectorReturn === null ? null : net - sectorReturn,
      stressReturns: Object.fromEntries(COST_SCENARIOS.map((c) => [c, cost === null ? null : stockReturn - Math.max(cost, c) / 100])),
    }
  })
}

export function latestOutcomes(outcomes) {
  const map = new Map()
  for (const outcome of [...outcomes].sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt))) {
    const key = `${outcome.observationId}:${outcome.horizon}`
    // Completed prices are immutable even if a provider later revises history.
    if (map.get(key)?.status !== 'completed') map.set(key, outcome)
  }
  return map
}

export async function evaluationObservations(archive, now) {
  const [runs, receipts] = await Promise.all([archive.list('evaluation-runs', now), archive.list('evaluation-deliveries', now)])
  const delivered = new Map(receipts.map((r) => [r.runId, r]))
  const rows = runs.flatMap((r) => r.observations).filter((o) => o.cohort !== 'delivered' || delivered.has(o.runId))
    .map((o) => o.cohort !== 'delivered' ? o : { ...o, earliestActionAt: new Date(Math.max(Date.parse(o.earliestActionAt),
      Date.parse(delivered.get(o.runId).availableAt) + 60000)).toISOString() })
  return { runs, observations: [...new Map(rows.map((o) => [o.id, o])).values()] }
}

export async function trackEvaluation(archive, { master, candlesFor, now = Date.now() }) {
  const { observations } = await evaluationObservations(archive, now)
  const existing = latestOutcomes(await archive.list('evaluation-outcomes', now))
  const benchmark = await candlesFor('SPY')
  let tracked = 0
  for (const observation of observations) {
    if (observation.horizons.every((h) => existing.get(`${observation.id}:${h}`)?.status === 'completed')) continue
    // Keep rejected counterfactuals, too, but never include them in accepted
    // performance aggregates or learning feedback.
    const identity = master?.resolve({ ticker: observation.ticker, asOf: now }) || []
    const identityAvailable = identity.length === 1 && identity[0].securityId === observation.securityId
    const stock = identityAvailable ? await candlesFor(observation.ticker) : []
    const sectorTicker = SECTOR_BENCHMARKS[observation.sector]
    const sector = sectorTicker ? await candlesFor(sectorTicker) : []
    for (const result of evaluateObservation(observation, { stock, benchmark, sector, identityAvailable }, now)) {
      if (existing.get(`${observation.id}:${result.horizon}`)?.status === 'completed') continue
      const id = result.status === 'completed' ? digest([observation.id, result.horizon, 'completed']) : digest(result)
      await archive.put('evaluation-outcome', id, { ...result, id }, 'evaluation-outcomes', result.availableAt)
      tracked++
    }
  }
  return tracked
}

export function horizonSummary(observations, outcomes, horizon) {
  const eligible = observations.filter((o) => o.status === 'accepted' && o.horizons.includes(horizon))
  const completed = eligible.map((o) => ({ observation: o, outcome: outcomes.get(`${o.id}:${horizon}`) }))
    .filter((r) => r.outcome?.status === 'completed')
  const values = (field) => completed.map((r) => r.outcome[field]).filter(Number.isFinite)
  const dates = new Map()
  for (const row of completed) {
    if (!Number.isFinite(row.outcome.excessReturn)) continue
    const date = row.observation.decisionAt.slice(0, 10)
    if (!dates.has(date)) dates.set(date, [])
    dates.get(date).push(row.outcome.excessReturn)
  }
  const daily = [...dates.values()].map(mean), dailyMean = mean(daily)
  const variance = daily.length > 1 ? daily.reduce((s, v) => s + (v - dailyMean) ** 2, 0) / (daily.length - 1) : null
  const uncertainty = variance === null ? null : 2 * Math.sqrt(variance / daily.length)
  const net = values('netReturn'), unavailable = eligible.filter((o) => outcomes.get(`${o.id}:${horizon}`)?.status === 'unavailable').length
  return { horizon, completed: completed.length, pending: eligible.length - completed.length - unavailable, unavailable,
    sampleSize: completed.length, benchmarkSampleSize: values('excessReturn').length, sectorSampleSize: values('sectorExcessReturn').length,
    meanReturn: mean(values('grossReturn')), medianReturn: median(values('grossReturn')),
    meanNetReturn: mean(net), medianNetReturn: median(net), benchmarkRelative: mean(values('excessReturn')),
    adverseFillNetReturn: mean(values('adverseFillNetReturn')),
    sectorRelative: mean(values('sectorExcessReturn')), wins: net.length ? net.filter((v) => v > 0).length : null,
    losses: net.length ? net.filter((v) => v < 0).length : null, flat: net.length ? net.filter((v) => v === 0).length : null,
    worstLoss: net.length ? Math.min(...net) : null,
    worstStocks: completed.filter((r) => Number.isFinite(r.outcome.netReturn)).sort((a, b) => a.outcome.netReturn - b.outcome.netReturn)
      .slice(0, 5).map((r) => ({ observationId: r.observation.id, ticker: r.observation.ticker, return: r.outcome.netReturn })),
    distribution: net.length ? { belowMinus10: net.filter((v) => v < -10).length, minus10To0: net.filter((v) => v >= -10 && v < 0).length,
      zeroTo10: net.filter((v) => v >= 0 && v <= 10).length, above10: net.filter((v) => v > 10).length } : null,
    distinctDates: daily.length, dailyMeanExcess: dailyMean,
    lowerBound: uncertainty === null ? null : dailyMean - uncertainty, upperBound: uncertainty === null ? null : dailyMean + uncertainty,
    stressReturns: Object.fromEntries(COST_SCENARIOS.map((cost) => [cost, mean(completed.map((r) => r.outcome.stressReturns[cost]).filter(Number.isFinite))])),
    status: !completed.length ? 'Insufficient data' : 'Preliminary' }
}

export function selectionTurnover(observations) {
  const sessions = new Map()
  for (const o of observations) {
    if (!sessions.has(o.runId)) sessions.set(o.runId, { at: o.decisionAt, securities: new Set() })
    if (o.status === 'accepted') sessions.get(o.runId).securities.add(o.securityId)
  }
  const lists = [...sessions.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const changes = lists.slice(1).map((next, index) => {
    const previous = lists[index].securities
    const union = new Set([...previous, ...next.securities])
    return union.size ? [...union].filter((id) => previous.has(id) !== next.securities.has(id)).length / union.size : 0
  })
  return mean(changes)
}

// A funded, fixed-dollar book. Every accepted order reserves $10k for 20
// sessions, including across runs. Mark all open positions on the SAME date.
// A missing mark makes the portfolio metric unavailable, never a zero return.
export function portfolioSummary(observations, outcomes) {
  const positions = observations.filter((o) => o.arm === 'constrained' && o.status === 'accepted' && o.portfolio)
    .map((o) => ({ ...o, outcome: outcomes.get(`${o.id}:20`) }))
  const empty = { drawdown: null, concurrentExposure: null, sectorConcentration: null, turnover: null, equity: null, status: 'unavailable' }
  if (!positions.length || positions.some((p) => !p.outcome?.entryDate || !p.outcome.path.length)) return empty
  const days = [...new Set(positions.flatMap((p) => p.outcome.path.map((b) => b.date)))].sort()
  let peak = 100000, drawdown = 0, maxExposure = 0, maxSector = 0, equity = 100000, traded = 0
  for (const date of days) {
    equity = 100000
    let gross = 0
    const sectors = new Map()
    for (const p of positions) {
      const o = p.outcome
      if (o.entryDate > date) continue
      const closed = o.status === 'completed' && o.exitDate <= date
      const mark = closed ? o.grossReturn : o.path.find((b) => b.date === date)?.returnPercent
      if (!Number.isFinite(mark) || !Number.isFinite(o.costBps)) return empty
      const cost = o.costBps / 100 * (closed ? 1 : 0.5)
      equity += p.portfolio.orderSize * (mark - cost) / 100
      if (o.entryDate === date) traded += p.portfolio.orderSize
      if (closed && o.exitDate === date) traded += p.portfolio.orderSize * (1 + mark / 100)
      if (!closed) {
        const value = p.portfolio.orderSize * (1 + mark / 100)
        gross += value
        sectors.set(p.sector, (sectors.get(p.sector) || 0) + value)
      }
    }
    peak = Math.max(peak, equity)
    drawdown = Math.min(drawdown, (equity / peak - 1) * 100)
    maxExposure = Math.max(maxExposure, gross / equity * 100)
    maxSector = Math.max(maxSector, ...[...sectors.values()].map((v) => v / equity * 100))
  }
  return { drawdown, concurrentExposure: maxExposure, sectorConcentration: maxSector, turnover: traded / 100000,
    equity, status: 'Preliminary' }
}

export async function evaluationReport(archive, now = Date.now()) {
  const [definition, { runs, observations }, results, currentJob] = await Promise.all([
    archive.get('evaluation-definition', EVALUATION_ID), evaluationObservations(archive, now), archive.list('evaluation-outcomes', now),
    latestEvaluationJob(archive, now),
  ])
  const sealed = finalSealed(definition, now)
  const hidden = new Set(observations.filter((o) => sealed && o.period === 'final-untouched').map((o) => o.id))
  const outcomes = latestOutcomes(results.filter((r) => !hidden.has(r.observationId)))
  const groups = [...ARMS.map((arm) => ({ ...arm, cohort: 'shadow' })), { id: 'delivered', name: 'WallAI delivered', cohort: 'delivered' }]
    .map((arm) => {
      const rows = observations.filter((o) => o.arm === arm.id && o.cohort === arm.cohort)
      const periods = [...new Set(rows.map((r) => r.period))]
      return { ...arm, observations: rows.length, accepted: rows.filter((r) => r.status === 'accepted').length,
        rejected: rows.filter((r) => r.status === 'rejected').length,
        // Versions and periods are never pooled. Delivered model versions may change.
        cohorts: [...new Set(rows.map((r) => r.armVersion))].flatMap((version) => periods.map((period) => {
          const sample = rows.filter((r) => r.period === period && r.armVersion === version)
          return { version, period, observations: sample.length, accepted: sample.filter((r) => r.status === 'accepted').length,
            sealed: sealed && period === 'final-untouched', turnover: selectionTurnover(sample),
            horizons: [5, 20].map((h) => horizonSummary(sample, outcomes, h)),
            portfolio: arm.id === 'constrained' ? portfolioSummary(sample, outcomes) : null }
        }).filter((c) => c.observations)),
        emptyHorizons: [5, 20].map((h) => horizonSummary([], outcomes, h)) }
    })
  return { experimentId: EVALUATION_ID, definition: definition || null, variantsTried: definition?.variantsTried || 6,
    status: runs.length ? 'Collecting data' : 'Insufficient data', latestRun: runs.at(-1) ? {
      id: runs.at(-1).id, availableAt: runs.at(-1).availableAt, status: runs.at(-1).status, failures: runs.at(-1).failures,
    } : null, finalSealed: sealed, arms: groups,
    // A job that already completed is already reflected in latestRun/arms
    // above; only surface it here while it is still pending, in progress or
    // failed, so /research/evaluation shows why nothing new has appeared yet.
    currentJob: currentJob && currentJob.status !== 'completed' ? currentJob : null,
    // The API provides stock-level inspection, including retained rejections.
    observations: observations.map((o) => ({ ...o, outcomes: o.horizons.map((h) => hidden.has(o.id)
      ? { horizon: h, status: 'sealed', reason: 'Untouched evaluation' }
      : outcomes.get(`${o.id}:${h}`) || { horizon: h, status: 'pending' }) })) }
}
