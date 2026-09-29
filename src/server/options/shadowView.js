import { optionsAuditRecord } from './auditStore.js'
import { OPTIONS_CALENDAR_2026, marketDay, optionsLocalParts } from './calendar.js'
import { OPTIONS_EVALUATION_POLICY, evaluateOptionsOutcome } from './evaluation.js'
import { forwardCaptureScanId } from './forwardCapture.js'
import { recoveredOutcomePlans } from './outcomeRecovery.js'
import { buildExperimentComparison } from './experimentView.js'

// Observational only: every value below is read from frozen morning records and
// archived forward observations, then passed through #214's evaluator on read.
// Nothing here writes, rescores or replaces a published record.
export const OPTIONS_SHADOW_POLICY = Object.freeze({
  version: 'options-shadow-dashboard-v1',
  targetSessions: 20,
  lookbackDays: 90,
})

export const OPTIONS_SHADOW_CHECKPOINTS = Object.freeze([
  { key: '0', label: 'Same-day close' }, { key: '1', label: '+1 session' }, { key: '3', label: '+3 sessions' },
  { key: '5', label: '+5 sessions' }, { key: '10', label: '+10 sessions' }, { key: 'expiry', label: 'Expiry' },
])

export const OPTIONS_SHADOW_LIMITATIONS = Object.freeze([
  'Observed returns are historical research outcomes from indicative quotes, not live recommendations, fills or proof of profitability.',
  'Returns use the frozen ask at selection and a later observed bid, with the evaluation policy\'s fees and slippage.',
  'Unobserved or late checkpoints stay unknown. They are never counted as zero, as a loss or as worthless.',
  'Paths are sampled every five minutes: true intraday peaks and in-the-money crossings between samples are unknown.',
  'Twenty sessions from a fixed watchlist cannot establish a statistical edge.',
])

const DAY_MS = 86400000
const quoteMid = (quote) => Number.isFinite(quote?.bid) && Number.isFinite(quote?.ask) && quote.bid > 0 && quote.ask >= quote.bid
  ? (quote.bid + quote.ask) / 2 : null
const nextDate = (date) => new Date(Date.parse(`${date}T12:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10)

function openDates(from, through, calendar) {
  const dates = []
  for (let cursor = from; cursor <= through; cursor = nextDate(cursor)) {
    const day = marketDay(cursor, calendar)
    if (!day.known) break
    if (day.open) dates.push(cursor)
  }
  return dates
}

function latestPerTradingDate(manifests) {
  const byDate = new Map()
  for (const manifest of manifests) {
    const publication = manifest?.publication
    if (!publication?.tradingDate) continue
    const current = byDate.get(publication.tradingDate)
    if (!current || publication.revision > current.publication.revision
      || (publication.revision === current.publication.revision && manifest.availableAt > current.availableAt)) byDate.set(publication.tradingDate, manifest)
  }
  return byDate
}

function dayStatus(publication) {
  if (publication.completeness !== 'complete' || publication.state === 'partial') return 'degraded'
  return publication.result === 'empty' ? 'empty' : 'candidates'
}

async function observationsByPlan(archive, dates) {
  const rollups = await archive.list('options-observation-days', Date.parse(`${dates.at(-1)}T23:59:59.999Z`),
    { since: Date.parse(`${dates[0]}T00:00:00.000Z`) })
  const rolledUp = new Map()
  for (const rollup of rollups) {
    const current = rolledUp.get(rollup.tradingDate)
    if (!current || rollup.sourceRecordIds.length > current.sourceRecordIds.length) rolledUp.set(rollup.tradingDate, rollup)
  }
  const points = [...rolledUp.values()].flatMap((rollup) => rollup.observations)
  // Normally only today lacks a rollup; a day whose compaction failed is read
  // from its raw batches instead of disappearing.
  for (const date of dates.filter((value) => !rolledUp.has(value))) {
    const batches = await archive.list(`options-records:scan:${forwardCaptureScanId(date)}`, Date.parse(`${date}T23:59:59.999Z`),
      { since: Date.parse(`${date}T00:00:00.000Z`) })
    points.push(...batches.filter((record) => record?.recordType === 'observation').flatMap((record) => record.payload.observations))
  }
  const byPlan = new Map()
  for (const point of points) {
    const list = byPlan.get(point.planId) || []
    if (!list.some((item) => item.at === point.at)) list.push(point)
    byPlan.set(point.planId, list)
  }
  return byPlan
}

const otm = (contract, underlyingPrice) => Number.isFinite(underlyingPrice)
  ? contract.type === 'call' ? underlyingPrice < contract.strikePrice : underlyingPrice > contract.strikePrice
  : null

function dteBetween(tradingDate, expirationDate) {
  return Math.round((Date.parse(`${expirationDate}T12:00:00.000Z`) - Date.parse(`${tradingDate}T12:00:00.000Z`)) / DAY_MS)
}

function evaluatedRow({ manifest, selected, contract, underlyingPrice, plan, observations, asOf, today }) {
  const publication = manifest.publication
  const identity = contract || plan?.contract || {}
  const expirationDate = identity.expirationDate || null
  const frozen = {
    selectedAt: publication.availableAt, revision: publication.revision, dataState: publication.state,
    completeness: publication.completeness, quoteMarketAt: selected.quoteMarketAt,
    bid: contract?.quote?.bid ?? null, ask: contract?.quote?.ask ?? null, mid: selected.observedMid ?? null,
    spreadPct: selected.spreadPct ?? null, underlyingPrice,
    iv: contract?.analytics?.impliedVolatility ?? null,
  }
  const row = {
    id: `${manifest.manifestId}:${selected.contractId}`, manifestId: manifest.manifestId, tradingDate: publication.tradingDate,
    contractId: selected.contractId, ticker: selected.ticker, direction: selected.direction, rank: selected.rank, score: selected.score,
    strikePrice: identity.strikePrice ?? null, expirationDate,
    dteAtSelection: Number.isFinite(contract?.dte) ? contract.dte : expirationDate ? dteBetween(publication.tradingDate, expirationDate) : null,
    frozen,
  }
  const missing = (reason) => ({ ...row, status: 'missing', reason, checkpoints: [], latest: null, path: null, targets: [], gainedWhileOtm: null })
  if (!plan) return missing('outcome_plan_unavailable')
  if (!contract?.quote) return missing('frozen_entry_quote_unavailable')

  let outcome
  try {
    outcome = evaluateOptionsOutcome({ plan, asOf, observations, includeSamples: true,
      entry: { quote: contract.quote, underlyingPrice, iv: frozen.iv, volume: contract.volume?.value ?? null } })
  } catch (error) {
    return missing(/entry requires/i.test(error.message) ? 'frozen_entry_quote_invalid' : 'evaluation_unavailable')
  }
  const stockAt = new Map(observations.map((point) => [point.at, point.underlyingPrice]))
  const checkpoints = OPTIONS_SHADOW_CHECKPOINTS.map(({ key, label }) => {
    const point = outcome.endpoints.find((item) => item.key === key)
    return {
      key, label, scheduledAt: point?.at || null, status: point?.status || 'unavailable',
      returnPct: point?.returnPct ?? null, underlyingMovePct: point?.underlyingMovePct ?? null, ivChange: point?.ivChange ?? null,
    }
  })
  // Judged only on samples the evaluator itself counted, joined back to the
  // stock price observed with them. An unknown stock price keeps it unknown.
  const gains = outcome.samples.filter((sample) => sample.returnPct > 0).map((sample) => otm(identity, stockAt.get(sample.at)))
  const counted = outcome.samples.some((sample) => sample.returnPct != null)
  const gainedWhileOtm = gains.includes(true) ? true : gains.includes(null) || !counted ? null : false
  const targets = outcome.path.targets.map((target) => ({
    targetPct: target.targetPct, state: target.state, minutesToTarget: target.minutesToTarget,
    whileOtm: target.state === 'observed_hit' ? otm(identity, stockAt.get(target.at)) : null,
  }))
  const sessions = checkpoints.filter((item) => item.key !== 'expiry' && item.status !== 'unavailable' && item.status !== 'contract_expired_before_endpoint')
  const latestObserved = [...checkpoints].reverse().find((item) => item.returnPct != null)
  const status = expirationDate && today > expirationDate ? 'expired'
    : sessions.length && sessions.every((item) => item.status !== 'unexpired_horizon') ? 'completed' : 'open'
  return {
    ...row, status, checkpoints,
    latest: latestObserved ? { key: latestObserved.key, label: latestObserved.label, returnPct: latestObserved.returnPct,
      underlyingMovePct: latestObserved.underlyingMovePct, ivChange: latestObserved.ivChange } : null,
    path: {
      maximumObservedReturnPct: outcome.path.maximumObservedReturnPct, maximumAdverseExcursionPct: outcome.path.maximumAdverseExcursionPct,
      itmCrossing: outcome.path.itmCrossing, scheduled: outcome.path.scheduled, observed: outcome.path.observed,
      resolutionMinutes: outcome.path.resolutionMinutes,
    },
    targets, gainedWhileOtm,
    expiry: { fullyFollowed: outcome.expiry.fullyFollowed, expiredWorthless: outcome.expiry.expiredWorthless },
  }
}

export async function buildOptionsShadowView({
  archive, now = Date.now, readRecord = optionsAuditRecord,
  calendar = OPTIONS_CALENDAR_2026, policy = OPTIONS_SHADOW_POLICY,
} = {}) {
  const at = now()
  const asOf = new Date(at).toISOString()
  const today = optionsLocalParts(asOf).date
  const manifests = await archive.list('options-manifests', at, { since: at - policy.lookbackDays * DAY_MS })
  const experimentRuns = await archive.list('options-experiments', at, { since: at - policy.lookbackDays * DAY_MS })
  const byDate = latestPerTradingDate(manifests)
  const base = { policyVersion: policy.version, evaluationPolicyVersion: OPTIONS_EVALUATION_POLICY.version,
    checkedAt: asOf, targetSessions: policy.targetSessions, checkpoints: OPTIONS_SHADOW_CHECKPOINTS, limitations: OPTIONS_SHADOW_LIMITATIONS }
  if (!byDate.size && !experimentRuns.length) return { ...base, window: null, days: [], rows: [],
    experiments: buildExperimentComparison({ runs: [], observationsByPlan: new Map(), asOf }) }

  const startDate = [...byDate.keys(), ...experimentRuns.map((run) => run.tradingDate)].sort()[0]
  const sessions = openDates(startDate, today, calendar)
  const days = sessions.map((date) => {
    const manifest = byDate.get(date)
    if (!manifest) return { tradingDate: date, status: date === today ? 'pending' : 'missing', candidates: 0, manifestId: null }
    return { tradingDate: date, status: dayStatus(manifest.publication), candidates: manifest.publication.selected?.length || 0,
      manifestId: manifest.manifestId, revision: manifest.publication.revision }
  })
  const plansByPlanDates = sessions.length ? await observationsByPlan(archive, sessions) : new Map()

  const rows = []
  for (const manifest of [...byDate.values()].sort((a, b) => b.publication.tradingDate.localeCompare(a.publication.tradingDate))) {
    const publication = manifest.publication
    if (!publication.selected?.length) continue
    const refs = manifest.records || []
    const read = async (type) => (await Promise.all(refs.filter((ref) => ref.type === type).map((ref) => readRecord(archive, type, ref.id)))).filter(Boolean)
    const [chains, outcomes] = await Promise.all([read('chain'), read('outcome')])
    const plans = [...outcomes.flatMap((record) => record.payload.outcomes || []), ...await recoveredOutcomePlans(archive, manifest.scanId, at)]
    for (const selected of [...publication.selected].sort((a, b) => a.rank - b.rank)) {
      const chain = selected.revalidation?.chainRecordId
        ? chains.find((record) => record.recordId === selected.revalidation.chainRecordId)
        : chains.find((record) => record.payload.contracts.some((item) => item.contractId === selected.contractId))
      const contract = chain?.payload.contracts.find((item) => item.contractId === selected.contractId) || null
      const plan = plans.find((item) => item.contract.contractId === selected.contractId) || null
      rows.push(evaluatedRow({
        manifest, selected, contract, plan, asOf, today,
        underlyingPrice: quoteMid(chain?.payload.underlying?.observation?.quote),
        observations: plan ? (plansByPlanDates.get(plan.planId) || []) : [],
      }))
    }
  }
  const observedDates = [...plansByPlanDates.values()].flat().filter((point) => point.status === 'observed')
    .map((point) => optionsLocalParts(point.at).date).sort()
  return {
    ...base,
    experiments: buildExperimentComparison({ runs: experimentRuns, observationsByPlan: plansByPlanDates, asOf }),
    window: {
      startDate, today, session: sessions.length, completed: sessions.length >= policy.targetSessions,
      latestObservationDate: observedDates.at(-1) || null,
      publishedCandidates: rows.length,
      dayCounts: Object.fromEntries(['candidates', 'empty', 'degraded', 'missing', 'pending'].map((status) => [status, days.filter((day) => day.status === status).length])),
    },
    days, rows,
  }
}
