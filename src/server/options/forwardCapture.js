import { digest } from '../research/archive.js'
import { OPTIONS_LATEST_POINTER_KEY, optionsAuditRecord } from './auditStore.js'
import { OPTIONS_CALENDAR_2026, marketDay, optionsLocalParts } from './calendar.js'
import {
  OPTIONS_OBSERVATION_POLICY, archiveObservationRecord, createObservationAuditRecord,
  outcomeAcquisitionJobs, runObservationAcquisition,
} from './observations.js'

// Executes the outcome-capture plans every publication already archives (#213).
// The evaluator (#214) only accepts an observation taken at, or at most 30s
// before, each scheduled instant, so a per-minute tick sleeps until just before
// each instant due in its minute and captures every contract due then in one
// batched option request plus one stock request.
export const OPTIONS_FORWARD_CAPTURE_POLICY = Object.freeze({
  version: 'options-forward-capture-v1',
  leadMs: 20_000,
  minimumMarginMs: 5_000,
  tickMs: 60_000,
  lookbackDays: 45,
  maxContractsPerRequest: 100,
  licenseId: 'alpaca-basic-indicative',
  endpoint: 'option-and-underlying-snapshot-batch',
  schedule: 'CRON_TZ=America/New_York * 9-15 * * 1-5',
})

export const OPTIONS_CAPTURE_ACTIVE_KEY = 'research:options:capture:active:v1'
const INSTANTS_PREFIX = 'research:options:capture:instants:v1'
const CHECKPOINT_PREFIX = 'research:options:capture:checkpoint:v1'
const TICK_PREFIX = 'research:options:capture:tick:v1'
const KILL_SWITCH_KEY = 'research:options:kill:v1'
const DAY_TTL_SECONDS = 3 * 86400

export const forwardCaptureScanId = (tradingDate) => `forward-capture:${tradingDate}`
const instantsKey = (tradingDate) => `${INSTANTS_PREFIX}:${tradingDate}`

function parse(value) {
  if (value == null) return null
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}

const quoteMid = (quote) => Number.isFinite(quote?.bid) && Number.isFinite(quote?.ask) && quote.bid > 0 && quote.ask >= quote.bid
  ? (quote.bid + quote.ask) / 2 : null

function uniquePlans(plans) {
  const byId = new Map()
  for (const plan of plans) if (plan?.planId && !byId.has(plan.planId)) byId.set(plan.planId, plan)
  return [...byId.values()]
}

/** Every contract due at each scheduled instant of one trading date. */
export function captureInstantsFor(plans, tradingDate) {
  const byInstant = new Map()
  for (const plan of uniquePlans(plans)) {
    const symbol = String(plan.contract?.contractId || '').replace(/^osi:/, '')
    if (!plan.contract?.contractId?.startsWith('osi:') || !plan.scanId) continue
    for (const job of outcomeAcquisitionJobs(plan)) {
      if (job.tradingDate !== tradingDate) continue
      const entry = byInstant.get(job.scheduledAt) || { scheduledAt: job.scheduledAt, tradingDate, contracts: [] }
      entry.contracts.push({
        planId: plan.planId, scanId: plan.scanId, contractId: plan.contract.contractId, symbol,
        securityId: plan.contract.securityId, issuerId: plan.contract.issuerId, ticker: plan.contract.ticker,
        purposes: job.purposes,
      })
      byInstant.set(job.scheduledAt, entry)
    }
  }
  return [...byInstant.values()]
    .map((entry) => ({ ...entry, contracts: entry.contracts.sort((a, b) => a.contractId.localeCompare(b.contractId) || a.planId.localeCompare(b.planId)) }))
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
}

/** Outcome plans from every published morning still inside the capture horizon. */
export async function publishedOutcomePlans({ archive, now, readRecord = optionsAuditRecord, policy = OPTIONS_FORWARD_CAPTURE_POLICY }) {
  const manifests = await archive.list('options-manifests', now, { since: now - policy.lookbackDays * 86400000 })
  const plans = []
  for (const manifest of manifests) {
    if (manifest?.publication?.result !== 'candidates') continue
    for (const ref of (manifest.records || []).filter((item) => item.type === 'outcome')) {
      const record = await readRecord(archive, 'outcome', ref.id)
      for (const plan of record?.payload?.outcomes || []) plans.push({ ...plan, scanId: record.scanId })
    }
  }
  return uniquePlans(plans)
}

function chunks(items, size) {
  const out = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

async function captureInstant(job, { adapter, now, sleep, policy }, attempt) {
  const scheduledAt = job.scheduledAt
  const target = Date.parse(scheduledAt)
  const wait = target - policy.leadMs - now()
  if (wait > 0) await sleep(wait)
  const contracts = job.parameters.contracts
  const requestedAt = new Date(now()).toISOString()
  const securities = [...new Map(contracts.map((item) => [item.securityId, { securityId: item.securityId, issuerId: item.issuerId, ticker: item.ticker }])).values()]
  const [optionBatches, stockBatches] = await Promise.all([
    Promise.all(chunks([...new Set(contracts.map((item) => item.symbol))], policy.maxContractsPerRequest)
      .map((symbols) => adapter.contractSnapshots(symbols, { deadline: scheduledAt }))),
    Promise.all(chunks(securities, policy.maxContractsPerRequest)
      .map((items) => adapter.underlyingSnapshots(items, { deadline: scheduledAt }))),
  ])
  const receivedAt = new Date(now()).toISOString()
  const options = new Map(optionBatches.flatMap((batch) => batch.observations).map((item) => [item.symbol, item]))
  const optionGaps = new Map(optionBatches.flatMap((batch) => batch.missing).map((item) => [item.symbol, item.reason]))
  const stocks = new Map(stockBatches.flatMap((batch) => batch.observations).map((item) => [item.securityId, item]))
  const observations = contracts.map((item) => {
    const option = options.get(item.symbol)
    const stock = stocks.get(item.securityId)
    const at = option?.fetchedAt || receivedAt
    const quote = option?.quote ? {
      bid: option.quote.bid, ask: option.quote.ask, bidSize: option.quote.bidSize, askSize: option.quote.askSize,
      marketAt: option.quote.marketAt, availableAt: option.fetchedAt,
    } : null
    // A snapshot that lands after its instant is kept, but labelled: the
    // evaluator must not treat it as the observation that instant scheduled.
    const status = !quote ? optionGaps.get(item.symbol) || 'missing_exit_quote'
      : Date.parse(at) > target ? 'late_observation' : 'observed'
    return {
      planId: item.planId, scanId: item.scanId, contractId: item.contractId, securityId: item.securityId, issuerId: item.issuerId,
      scheduledAt, purposes: item.purposes, at, availableAt: at, status, quote,
      underlyingPrice: quoteMid(stock?.quote), underlyingMarketAt: stock?.quote?.marketAt ?? null,
      iv: option?.impliedVolatility ?? null, volume: option?.volume ?? null,
    }
  })
  const bodyChecksum = digest({
    options: optionBatches.flatMap((batch) => batch.observations.map((item) => item.rawReferenceHash)).sort(),
    stocks: stockBatches.flatMap((batch) => batch.observations.map((item) => item.rawReferenceHash)).sort(),
    missing: [...optionGaps].sort(),
  })
  const record = createObservationAuditRecord({
    scanId: forwardCaptureScanId(job.tradingDate), availableAt: receivedAt,
    request: { endpoint: job.endpoint, parametersHash: digest(job.parameters), requestedAt, receivedAt, attempt, bodyChecksum,
      providerRequests: [...optionBatches, ...stockBatches].reduce((sum, batch) => sum + (batch.requestCount || 0), 0) },
    observations,
    source: { provider: 'alpaca', feed: 'indicative', session: 'regular', entitlement: 'basic-free' },
    licenseId: policy.licenseId,
    inputHashes: [...new Set(contracts.map((item) => item.planId))],
  })
  return { record }
}

function captureJob(entry, policy) {
  return {
    pool: 'forward', provider: 'alpaca', endpoint: policy.endpoint, tradingDate: entry.tradingDate, scheduledAt: entry.scheduledAt,
    parameters: { scheduledAt: entry.scheduledAt, contracts: entry.contracts },
  }
}

/**
 * Compacts one finished trading day's immutable observation batches into a
 * single immutable rollup, so the dashboard reads one object per past day
 * instead of every five-minute batch. Content is derived only from the source
 * records, so rebuilding from the same records is idempotent.
 */
export async function rollUpObservationDay(archive, tradingDate) {
  const records = await archive.list(`options-records:scan:${forwardCaptureScanId(tradingDate)}`, Date.parse(`${tradingDate}T23:59:59.999Z`),
    { since: Date.parse(`${tradingDate}T00:00:00.000Z`) })
  const batches = records.filter((record) => record?.recordType === 'observation')
    .sort((a, b) => a.recordId.localeCompare(b.recordId))
  if (!batches.length) return null
  const rollup = {
    schemaVersion: 'options-forward-observation-day-v1', tradingDate,
    sourceRecordIds: batches.map((record) => record.recordId),
    availableAt: batches.map((record) => record.availableAt).sort().at(-1),
    observations: batches.flatMap((record) => record.payload.observations.map((item) => ({ ...item, sourceRecordId: record.recordId }))),
  }
  const id = digest(rollup)
  return archive.put('options-observation-day', id, { ...rollup, rollupId: id },
    [{ name: 'options-observation-days', score: Date.parse(`${tradingDate}T12:00:00.000Z`) }])
}

export async function runOptionsForwardCaptureTick({
  redis, archive, adapter,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  enabled = true,
  readRecord = optionsAuditRecord,
  calendar = OPTIONS_CALENDAR_2026,
  policy = OPTIONS_FORWARD_CAPTURE_POLICY,
  observationPolicy = OPTIONS_OBSERVATION_POLICY,
} = {}) {
  if (!enabled) return { status: 'disabled' }
  if (!redis || !archive) throw new Error('Forward capture requires Redis and the archive')
  const startedAt = now()
  const tradingDate = optionsLocalParts(new Date(startedAt).toISOString()).date
  const day = marketDay(tradingDate, calendar)
  if (!day.known || !day.open) return { status: 'closed', tradingDate }

  // The idle path is this single read: most minutes have nothing due.
  const [activeRaw, pointerRaw, killed] = await redis.mget(OPTIONS_CAPTURE_ACTIVE_KEY, OPTIONS_LATEST_POINTER_KEY, KILL_SWITCH_KEY)
  if (killed) return { status: 'disabled', tradingDate }
  const active = parse(activeRaw)
  const latestManifestId = parse(pointerRaw)?.manifestId ?? null
  let instants = active?.instants || []
  let rebuilt = false
  if (!active || active.tradingDate !== tradingDate || active.latestManifestId !== latestManifestId) {
    const schedule = captureInstantsFor(await publishedOutcomePlans({ archive, now: startedAt, readRecord, policy }), tradingDate)
    if (schedule.length) {
      await redis.hset(instantsKey(tradingDate), Object.fromEntries(schedule.map((entry) => [String(Date.parse(entry.scheduledAt)), JSON.stringify(entry)])))
      await redis.expire(instantsKey(tradingDate), DAY_TTL_SECONDS)
    }
    instants = schedule.map((entry) => Date.parse(entry.scheduledAt))
    await redis.set(OPTIONS_CAPTURE_ACTIVE_KEY, JSON.stringify({
      schemaVersion: 'options-capture-active-v1', policyVersion: policy.version, tradingDate, latestManifestId,
      builtAt: new Date(startedAt).toISOString(), instants,
    }), { ex: DAY_TTL_SECONDS })
    rebuilt = true
    // A new trading date means the previous one is finished: compact it once.
    // Compaction is an optimization; the raw batches stay authoritative.
    if (active?.tradingDate && active.tradingDate < tradingDate) {
      try { await rollUpObservationDay(archive, active.tradingDate) }
      catch (error) { console.error(JSON.stringify({ service: 'options-forward-capture', event: 'rollup_failed', tradingDate: active.tradingDate, message: error.message })) }
    }
  }

  const bucket = Math.floor(startedAt / policy.tickMs) * policy.tickMs
  const due = instants.filter((instant) => instant - policy.leadMs >= bucket && instant - policy.leadMs < bucket + policy.tickMs
    && instant - now() >= policy.minimumMarginMs)
  if (!due.length) return { status: 'idle', tradingDate, rebuilt }
  // QStash delivery is at-least-once; one tick owns each minute.
  if (!await redis.set(`${TICK_PREFIX}:${bucket}`, '1', { nx: true, ex: 300 })) return { status: 'duplicate', tradingDate, rebuilt }

  const entries = (await Promise.all(due.map((instant) => redis.hget(instantsKey(tradingDate), String(instant))))).map(parse).filter(Boolean)
  const checkpointKey = `${CHECKPOINT_PREFIX}:forward:${tradingDate}`
  const result = await runObservationAcquisition({
    jobs: entries.map((entry) => captureJob(entry, policy)),
    pool: 'forward', day: tradingDate, maxAttempts: 1, policy: observationPolicy,
    // A retry after its instant has passed could never satisfy the evaluator.
    fetchJob: (job, { attempt }) => captureInstant(job, { adapter, now, sleep, policy }, attempt),
    archiveRecord: (record) => archiveObservationRecord(archive, record),
    loadCheckpoint: async () => parse(await redis.get(checkpointKey)),
    saveCheckpoint: (state) => redis.set(checkpointKey, JSON.stringify(state), { ex: DAY_TTL_SECONDS }),
  })
  return {
    status: result.failed.length ? 'partial' : 'captured', tradingDate, rebuilt,
    instants: entries.map((entry) => entry.scheduledAt), recordIds: result.recordIds, failed: result.failed,
  }
}
