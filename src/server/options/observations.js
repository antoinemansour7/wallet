import { digest } from '../research/archive.js'
import { createOptionsAuditRecord, createOptionsRetention, validateOptionsAuditRecord } from './audit.js'
import { OPTIONS_CALENDAR_2026, marketDay, regularSessionClose, zonedMarketInstant } from './calendar.js'

export const OPTIONS_OBSERVATION_POLICY_VERSION = 'options-observation-acquisition-v1'
export const OPTIONS_OBSERVATION_POLICY = Object.freeze({
  version: OPTIONS_OBSERVATION_POLICY_VERSION,
  endpointSessions: Object.freeze([0, 1, 3, 5, 10]),
  pathSampleMinutes: 5,
  pools: Object.freeze({
    historical: Object.freeze({ maxRequestsPerDay: 1500, maxBytesPerDay: 250_000_000, maxConcurrency: 2 }),
    // Routine path samples may spend all but the reserve; only close and
    // expiry captures, which grade every pick, may draw on it.
    forward: Object.freeze({ maxRequestsPerDay: 520, reservedRequests: 20, maxBytesPerDay: 100_000_000, maxConcurrency: 2 }),
    opening: Object.freeze({ reserved: true }),
  }),
})

export const OPTIONS_OBSERVATION_LICENSES = Object.freeze({
  'alpaca-basic-indicative': Object.freeze({
    normalizedRetention: true,
    rawPayloadRetention: false,
    audience: 'owner-only-research',
    historicalFrom: '2024-02-01',
  }),
  'test-fixture': Object.freeze({
    normalizedRetention: true,
    rawPayloadRetention: true,
    audience: 'automated-test',
    historicalFrom: null,
  }),
})

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const checksumPattern = /^[a-f0-9]{64}$/
const STATES = new Set(['observed', 'reconstructed', 'missing'])

function instant(value, field) {
  const parsed = new Date(value).getTime()
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid instant`)
  return new Date(parsed).toISOString()
}

function date(value, field) {
  if (!datePattern.test(value || '') || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be an ISO date`)
  }
  return value
}

function findNulls(value, path = 'payload', found = []) {
  if (value === null) { found.push({ path, reason: 'source_value_not_available' }); return found }
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) findNulls(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, found)
  return found
}

export function observationLicense(licenseId, { rawPayload = false } = {}) {
  const license = OPTIONS_OBSERVATION_LICENSES[licenseId]
  if (!license || !license.normalizedRetention) {
    return { allowed: false, reason: 'normalized_retention_not_authorized', license: license || null }
  }
  if (rawPayload && !license.rawPayloadRetention) {
    return { allowed: false, reason: 'raw_payload_retention_not_authorized', license }
  }
  return { allowed: true, reason: null, license }
}

function normalizeCoverageField(field, { tradingDate, freezeAt }) {
  if (!field?.path || !STATES.has(field.status)) throw new Error('Coverage fields require path and observed/reconstructed/missing status')
  const expectedDate = date(field.expectedDate || tradingDate, `coverage ${field.path} expectedDate`)
  const base = { path: field.path, expectedDate, status: field.status }
  if (field.status === 'missing') {
    if (!field.reason) throw new Error(`Missing coverage field ${field.path} requires a reason`)
    return { ...base, replayEligible: false, reason: field.reason }
  }
  if (field.status === 'reconstructed') {
    if (!field.method || !Array.isArray(field.inputHashes) || !field.inputHashes.length
      || field.inputHashes.some((value) => !checksumPattern.test(value))) {
      throw new Error(`Reconstructed coverage field ${field.path} requires a method and input hashes`)
    }
    return { ...base, replayEligible: true, method: field.method, inputHashes: field.inputHashes, reason: field.reason || 'explicit_reconstruction' }
  }

  const marketAt = instant(field.marketAt, `coverage ${field.path} marketAt`)
  const publicAt = field.publicAt == null ? null : instant(field.publicAt, `coverage ${field.path} publicAt`)
  const acquiredAt = instant(field.acquiredAt, `coverage ${field.path} acquiredAt`)
  if (!checksumPattern.test(field.sourceChecksum || '')) throw new Error(`Observed coverage field ${field.path} requires a source checksum`)
  const marketDateMatches = marketAt.slice(0, 10) === expectedDate
  const availableAtFreeze = publicAt != null && Date.parse(publicAt) <= Date.parse(freezeAt)
  const replayEligible = marketDateMatches && availableAtFreeze
  const reason = !replayEligible ? !marketDateMatches ? 'observation_date_mismatch'
    : publicAt == null ? 'publication_time_unknown' : 'published_after_historical_freeze' : null
  return {
    ...base, marketAt, publicAt, acquiredAt, sourceChecksum: field.sourceChecksum,
    replayEligible,
    ...(reason ? { reason } : {}),
  }
}

// Coverage is deliberately field-granular. A late current snapshot can be
// retained as evidence, but replayEligible remains false and it cannot silently
// stand in for an historical IV, Greek, OI or event version.
export function createOptionsCoverageManifest({
  scanId,
  ticker,
  securityId,
  issuerId,
  tradingDate,
  freezeAt,
  availableAt = new Date().toISOString(),
  fields = [],
  contractEnumerationId = null,
  identitySnapshotId,
  source = { provider: 'wallai', feed: 'coverage-manifest', session: 'historical', entitlement: 'internal' },
} = {}) {
  if (!scanId || !ticker || !securityId || !issuerId || !identitySnapshotId) throw new Error('Coverage manifest requires scan and dated security identity')
  date(tradingDate, 'tradingDate')
  const frozen = instant(freezeAt, 'freezeAt')
  const acquired = instant(availableAt, 'availableAt')
  if (!Array.isArray(fields) || !fields.length) throw new Error('Coverage manifest requires fields')
  const normalized = fields.map((field) => normalizeCoverageField(field, { tradingDate, freezeAt: frozen }))
  if (new Set(normalized.map((field) => field.path)).size !== normalized.length) throw new Error('Coverage manifest contains duplicate field paths')
  const counts = Object.freeze({
    observed: normalized.filter((field) => field.status === 'observed').length,
    reconstructed: normalized.filter((field) => field.status === 'reconstructed').length,
    missing: normalized.filter((field) => field.status === 'missing').length,
    replayEligible: normalized.filter((field) => field.replayEligible).length,
  })
  const payload = {
    ticker: String(ticker).toUpperCase(), securityId, issuerId, tradingDate, freezeAt: frozen,
    identitySnapshotId, contractEnumerationId, fields: normalized, counts,
  }
  return createOptionsAuditRecord({
    type: 'coverage', scanId, availableAt: acquired, source,
    versions: { code: OPTIONS_OBSERVATION_POLICY_VERSION, model: 'deterministic-no-model', policy: OPTIONS_OBSERVATION_POLICY_VERSION },
    inputHashes: [...new Set(normalized.flatMap((field) => field.inputHashes || []).concat(normalized.map((field) => field.sourceChecksum).filter(Boolean)))],
    payload, missing: findNulls(payload),
  })
}

export function replayCoverageDecision(manifests = [], requiredPaths = []) {
  if (!Array.isArray(manifests) || !Array.isArray(requiredPaths) || !requiredPaths.length) throw new Error('Replay coverage requires manifests and required paths')
  const fields = manifests.flatMap((record) => record?.payload?.fields || [])
  const missing = [], reconstructed = [], retrospective = []
  for (const path of requiredPaths) {
    const matches = fields.filter((field) => field.path === path)
    if (!matches.length || matches.every((field) => field.status === 'missing')) missing.push(path)
    else if (matches.some((field) => field.status === 'observed' && field.replayEligible)) continue
    else if (matches.some((field) => field.status === 'reconstructed' && field.replayEligible)) reconstructed.push(path)
    else retrospective.push(path)
  }
  const mode = missing.length || retrospective.length ? 'forward_only'
    : reconstructed.length ? 'restricted_replay' : 'point_in_time_replay'
  return { mode, requiredPaths: [...requiredPaths], missing, reconstructed, retrospective,
    fullHistoricalCoverageClaimAllowed: mode === 'point_in_time_replay' }
}

export function createHistoricalContractVersion({
  contractId, rawId, securityId, issuerId, ticker, validFrom, validThrough,
  expirationDate, status, deliverable, corporateActionIds = [], provider, observedAt,
} = {}) {
  if (!contractId || !rawId || !securityId || !issuerId || !ticker || !provider) throw new Error('Historical contract version requires provider and issuer-bound identity')
  const from = instant(validFrom, 'validFrom')
  const through = validThrough == null ? null : instant(validThrough, 'validThrough')
  if (through && Date.parse(through) < Date.parse(from)) throw new Error('Historical contract validity interval is inverted')
  date(expirationDate, 'expirationDate')
  if (!['active', 'expired', 'delisted', 'halted'].includes(status)) throw new Error('Unsupported historical contract status')
  if (!deliverable || !Number.isFinite(deliverable.multiplier) || !Array.isArray(deliverable.components) || !deliverable.components.length) {
    throw new Error('Historical contract version requires its actual deliverable')
  }
  const version = {
    schemaVersion: 'options-historical-contract-v1', contractId, rawId, provider,
    securityId, issuerId, ticker: String(ticker).toUpperCase(), validFrom: from, validThrough: through,
    expirationDate, status,
    deliverable: { ...deliverable, adjusted: deliverable.adjusted === true },
    corporateActionIds: [...corporateActionIds], observedAt: instant(observedAt, 'observedAt'),
  }
  return { ...version, versionId: digest(version) }
}

export function contractVersionAt(versions, { contractId, securityId, issuerId, at } = {}) {
  const time = new Date(at).getTime()
  if (!Number.isFinite(time)) throw new Error('Contract availability lookup requires a valid instant')
  const matches = (versions || []).filter((version) => version.contractId === contractId
    && (!securityId || version.securityId === securityId) && (!issuerId || version.issuerId === issuerId)
    && Date.parse(version.validFrom) <= time && (!version.validThrough || Date.parse(version.validThrough) >= time))
  if (matches.length !== 1) return { available: false, reason: matches.length ? 'ambiguous_contract_version' : 'contract_not_available_at_scan' }
  return { available: true, version: matches[0] }
}

function addLocalMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString()
}

function sessionDates(tradingDate, count, calendar) {
  const values = []
  let cursor = new Date(`${tradingDate}T12:00:00.000Z`)
  for (let checked = 0; values.length <= count && checked < 370; checked += 1) {
    const candidate = cursor.toISOString().slice(0, 10)
    const day = marketDay(candidate, calendar)
    if (!day.known) throw new Error(`Outcome schedule exceeds calendar coverage at ${candidate}`)
    if (day.open) values.push(candidate)
    cursor = new Date(cursor.getTime() + 86400000)
  }
  if (!values.length || values[0] !== tradingDate) throw new Error('Outcome plan must start on an open trading date')
  return values
}

export function createOutcomeCapturePlan({ scanId, contract, tradingDate, entryAt, calendar = OPTIONS_CALENDAR_2026,
  policy = OPTIONS_OBSERVATION_POLICY } = {}) {
  if (!scanId || !contract?.contractId || !contract.securityId || !contract.issuerId) throw new Error('Outcome plan requires scan and contract identity')
  date(tradingDate, 'tradingDate')
  date(contract.expirationDate, 'contract expirationDate')
  const entry = instant(entryAt, 'entryAt')
  const requestedDates = sessionDates(tradingDate, Math.max(...policy.endpointSessions), calendar)
  const targets = []
  for (const offset of policy.endpointSessions) {
    const targetDate = requestedDates[offset]
    if (targetDate > contract.expirationDate) {
      targets.push({ kind: 'endpoint_close', sessionOffset: offset, tradingDate: targetDate, status: 'unavailable', reason: 'contract_expired_before_endpoint' })
    } else {
      targets.push({ kind: 'endpoint_close', sessionOffset: offset, tradingDate: targetDate, scheduledAt: regularSessionClose(targetDate, calendar), status: 'pending' })
    }
  }
  const expiryTradingDate = contract.lastTradingAt ? instant(contract.lastTradingAt, 'contract lastTradingAt').slice(0, 10) : contract.expirationDate
  const expiryDay = marketDay(expiryTradingDate, calendar)
  targets.push(expiryDay.known && expiryDay.open
    ? { kind: 'expiry_close', tradingDate: expiryTradingDate, scheduledAt: regularSessionClose(expiryTradingDate, calendar), status: 'pending' }
    : { kind: 'expiry_close', tradingDate: expiryTradingDate, status: 'unavailable', reason: expiryDay.reason || 'unknown_expiry_session' })

  const pathSamples = []
  const pathThrough = requestedDates.at(-1) < expiryTradingDate ? requestedDates.at(-1) : expiryTradingDate
  for (let cursor = tradingDate; cursor <= pathThrough;) {
    const day = marketDay(cursor, calendar)
    if (!day.known) throw new Error(`Path schedule exceeds calendar coverage at ${cursor}`)
    if (day.open) {
      let sample = zonedMarketInstant(cursor, day.openTime, calendar.timeZone)
      const close = regularSessionClose(cursor, calendar)
      // Every plan samples on the same grid, so one request covers all picks
      // due at an instant instead of one request per pick's entry second.
      if (cursor === tradingDate) while (Date.parse(sample) < Date.parse(entry)) sample = addLocalMinutes(sample, policy.pathSampleMinutes)
      while (Date.parse(sample) < Date.parse(close)) {
        pathSamples.push({ kind: 'path_sample', tradingDate: cursor, scheduledAt: sample, resolutionMinutes: policy.pathSampleMinutes, status: 'pending' })
        sample = addLocalMinutes(sample, policy.pathSampleMinutes)
      }
    }
    cursor = new Date(Date.parse(`${cursor}T12:00:00.000Z`) + 86400000).toISOString().slice(0, 10)
  }
  const base = {
    schemaVersion: 'options-outcome-capture-plan-v1', policyVersion: policy.version, scanId,
    contract: { contractId: contract.contractId, rawId: contract.rawId, securityId: contract.securityId,
      issuerId: contract.issuerId, ticker: contract.underlyingTicker || contract.ticker, type: contract.type,
      strikePrice: contract.strikePrice, expirationDate: contract.expirationDate },
    tradingDate, entryAt: entry, endpointTargets: targets, pathSampling: {
      resolutionMinutes: policy.pathSampleMinutes, through: pathThrough, samples: pathSamples,
      limitation: `Observations are sampled every ${policy.pathSampleMinutes} minutes; unsampled intraday maxima and ITM crossings remain unknown.`,
    },
  }
  return { ...base, planId: digest(base) }
}

export function outcomeAcquisitionJobs(plan, { provider = 'alpaca', endpoint = 'option-and-underlying-snapshot' } = {}) {
  if (!plan?.planId || !plan?.contract?.contractId) throw new Error('Forward acquisition jobs require an outcome capture plan')
  const scheduled = [
    ...plan.endpointTargets.filter((target) => target.status === 'pending'),
    ...plan.pathSampling.samples.filter((target) => target.status === 'pending'),
  ]
  const byInstant = new Map()
  for (const target of scheduled) {
    const existing = byInstant.get(target.scheduledAt)
    const purpose = target.kind === 'endpoint_close' ? `endpoint+${target.sessionOffset}` : target.kind
    if (existing) existing.purposes.push(purpose)
    else byInstant.set(target.scheduledAt, {
      pool: 'forward', provider, endpoint, tradingDate: target.tradingDate,
      scheduledAt: target.scheduledAt,
      parameters: {
        planId: plan.planId, contractId: plan.contract.contractId, securityId: plan.contract.securityId,
        issuerId: plan.contract.issuerId, ticker: plan.contract.ticker,
        fields: ['option_quote', 'option_trade', 'underlying_quote', 'underlying_trade'],
      },
      purposes: [purpose],
    })
  }
  return [...byInstant.values()].map((job) => ({ ...job, jobId: acquisitionJobId(job) }))
}

export function createHistoricalBackfillPlan({
  tradingDates = [], securities = [], provider = 'alpaca', endpoint = 'historical-options-observations',
  licenseId = 'alpaca-basic-indicative', calendar = OPTIONS_CALENDAR_2026, cohortTags = {},
} = {}) {
  const rights = observationLicense(licenseId)
  if (!rights.allowed) throw new Error(`Historical backfill denied: ${rights.reason}`)
  if (!Array.isArray(tradingDates) || !Array.isArray(securities) || !securities.length) throw new Error('Historical backfill requires dates and securities')
  const jobs = [], gaps = []
  for (const value of [...new Set(tradingDates)].sort()) {
    date(value, 'historical backfill date')
    const session = marketDay(value, calendar)
    if (!session.known || !session.open) {
      gaps.push({ tradingDate: value, reason: session.reason, cohortTags: cohortTags[value] || [] })
      continue
    }
    if (rights.license.historicalFrom && value < rights.license.historicalFrom) {
      gaps.push({ tradingDate: value, reason: 'provider_history_not_available', cohortTags: cohortTags[value] || [] })
      continue
    }
    for (const security of securities) {
      if (!security?.ticker || !security.securityId || !security.issuerId) throw new Error('Historical backfill security identity is incomplete')
      const job = {
        pool: 'historical', provider, endpoint, tradingDate: value,
        parameters: {
          tradingDate: value, ticker: security.ticker, securityId: security.securityId, issuerId: security.issuerId,
          fields: ['contract_reference', 'option_quotes', 'option_trades', 'open_interest_publication', 'underlying', 'events', 'dividends', 'rates'],
          cohortTags: cohortTags[value] || [],
        },
      }
      jobs.push({ ...job, jobId: acquisitionJobId(job) })
    }
  }
  const base = {
    schemaVersion: 'options-historical-backfill-plan-v1', policyVersion: OPTIONS_OBSERVATION_POLICY_VERSION,
    provider, licenseId, jobs, gaps,
    coverageMode: gaps.some((gap) => gap.reason === 'provider_history_not_available') ? 'restricted_replay' : 'candidate_point_in_time_replay',
  }
  return { ...base, planId: digest(base) }
}

export function createObservationAuditRecord({
  scanId, availableAt, request, observations, source, inputHashes = [], licenseId,
  rawProviderPayload,
} = {}) {
  const license = observationLicense(licenseId, { rawPayload: rawProviderPayload !== undefined })
  if (!license.allowed) throw new Error(`Observation retention denied: ${license.reason}`)
  if (!request?.endpoint || !request?.parametersHash || !checksumPattern.test(request.parametersHash)
    || !request.requestedAt || !request.receivedAt || !Number.isInteger(request.attempt) || request.attempt < 1) {
    throw new Error('Observation record requires sanitized request provenance')
  }
  if (!Array.isArray(observations)) throw new Error('Observation record requires an observations array')
  const bodyChecksum = rawProviderPayload === undefined ? request.bodyChecksum : digest(rawProviderPayload)
  if (!checksumPattern.test(bodyChecksum || '')) throw new Error('Observation record requires the provider body checksum')
  const payload = {
    request: { ...request, bodyChecksum }, observations,
    observationCount: observations.length,
    normalizedChecksum: digest(observations),
    ...(rawProviderPayload === undefined ? {} : { rawProviderPayload }),
  }
  return createOptionsAuditRecord({
    type: 'observation', scanId, availableAt, source,
    versions: { code: OPTIONS_OBSERVATION_POLICY_VERSION, model: 'deterministic-no-model', policy: OPTIONS_OBSERVATION_POLICY_VERSION },
    inputHashes: [...new Set([...inputHashes, bodyChecksum])], payload, missing: findNulls(payload),
    retention: createOptionsRetention({ availableAt, licenseId, rawPayloadAllowed: license.license.rawPayloadRetention }),
  })
}

export async function archiveObservationRecord(archive, record) {
  validateOptionsAuditRecord(record)
  return archive.put('options-observation', record.recordId, record,
    ['options-records:observation', `options-records:scan:${record.scanId}`], record.availableAt)
}

export function createOutcomeCaptureAuditRecord({ scanId, availableAt, plans = [], inputHashes = [], feed = 'forward-outcome-capture-plan' } = {}) {
  if (!Array.isArray(plans)) throw new Error('Outcome capture audit requires plans')
  const payload = {
    outcomes: plans.map((plan) => ({
      planId: plan.planId,
      contract: plan.contract,
      tradingDate: plan.tradingDate,
      entryAt: plan.entryAt,
      endpointTargets: plan.endpointTargets,
      pathSampling: plan.pathSampling,
      status: 'capture_pending',
    })),
  }
  return createOptionsAuditRecord({
    type: 'outcome', scanId, availableAt,
    source: { provider: 'wallai', feed, session: 'post-publication', entitlement: 'internal' },
    versions: { code: OPTIONS_OBSERVATION_POLICY_VERSION, model: 'deterministic-no-model', policy: OPTIONS_OBSERVATION_POLICY_VERSION },
    inputHashes: [...new Set(inputHashes)], payload, missing: findNulls(payload),
  })
}

export function acquisitionJobId(job) {
  if (!job?.pool || !['historical', 'forward'].includes(job.pool)) throw new Error('Observation acquisition cannot use the live opening budget')
  if (!job.provider || !job.endpoint || !job.parameters || !job.tradingDate) throw new Error('Acquisition job requires provider endpoint, parameters and date')
  if (job.pool === 'historical' && /(?:snapshot|latest)/i.test(job.endpoint)) {
    throw new Error('Latest or snapshot endpoints cannot source historical observations')
  }
  return digest({ pool: job.pool, provider: job.provider, endpoint: job.endpoint, parameters: job.parameters,
    tradingDate: job.tradingDate, scheduledAt: job.scheduledAt || null })
}

// Provider I/O and durable checkpoint storage are injected. The runner writes a
// checkpoint after every immutable batch, so a retry cannot spend on or archive
// a completed job twice. Pool limits are intentionally independent of opening.
export async function runObservationAcquisition({
  jobs = [],
  fetchJob,
  archiveRecord,
  loadCheckpoint = async () => null,
  saveCheckpoint = async () => {},
  policy = OPTIONS_OBSERVATION_POLICY,
  pool,
  day,
  maxAttempts = 3,
} = {}) {
  if (!['historical', 'forward'].includes(pool)) throw new Error('Acquisition pool must be historical or forward')
  date(day, 'acquisition day')
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('Acquisition maxAttempts must be positive')
  if (typeof fetchJob !== 'function' || typeof archiveRecord !== 'function') throw new Error('Acquisition runner requires fetch and archive functions')
  const limits = policy.pools[pool]
  const saved = await loadCheckpoint({ pool, day })
  const state = {
    schemaVersion: 'options-acquisition-checkpoint-v1', pool, day,
    completedJobIds: [...new Set(saved?.completedJobIds || [])],
    failed: [...(saved?.failed || [])],
    requestCount: Number(saved?.requestCount || 0),
    byteCount: Number(saved?.byteCount || 0),
    recordIds: [...new Set(saved?.recordIds || [])],
  }
  const completed = new Set(state.completedJobIds)
  let checkpointWrite = Promise.resolve()
  const persist = () => {
    const snapshot = structuredClone({ ...state, completedJobIds: [...completed] })
    checkpointWrite = checkpointWrite.then(() => saveCheckpoint(snapshot))
    return checkpointWrite
  }
  const unique = []
  for (const job of jobs) {
    const id = acquisitionJobId(job)
    if (job.pool !== pool || completed.has(id) || unique.some((entry) => entry.id === id)) continue
    unique.push({ id, job })
  }

  let cursor = 0
  const workers = Array.from({ length: Math.min(limits.maxConcurrency, unique.length) }, async () => {
    while (cursor < unique.length) {
      const item = unique[cursor++]
      let result, lastError
      const allowance = limits.maxRequestsPerDay - (item.job.reserved ? 0 : limits.reservedRequests || 0)
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (state.requestCount >= allowance) break
        state.requestCount += 1
        try {
          result = await fetchJob(item.job, { attempt, jobId: item.id, pool })
          break
        } catch (error) { lastError = error }
      }
      if (!result) {
        state.failed.push({ jobId: item.id, reason: state.requestCount >= allowance ? 'daily_request_budget_exhausted' : lastError?.code || 'request_failed' })
        await persist()
        continue
      }
      const bytes = Number(result.record?.byteLength || result.byteLength)
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Acquisition result requires exact byte length')
      if (state.byteCount + bytes > limits.maxBytesPerDay) {
        state.failed.push({ jobId: item.id, reason: 'daily_byte_budget_exhausted' })
        await persist()
        continue
      }
      // Reserve bytes synchronously before yielding so parallel workers cannot
      // each pass the same remaining daily allowance.
      state.byteCount += bytes
      const record = result.record || result
      if (!checksumPattern.test(record.recordId || '')) throw new Error('Acquisition result requires an immutable record ID')
      const archived = await archiveRecord(record)
      state.recordIds.push(archived?.recordId || record.recordId)
      completed.add(item.id)
      state.completedJobIds = [...completed]
      state.failed = state.failed.filter((failure) => failure.jobId !== item.id)
      await persist()
    }
  })
  await Promise.all(workers)
  await checkpointWrite
  state.completedJobIds = [...completed]
  const manifestBase = {
    schemaVersion: 'options-acquisition-manifest-v1', policyVersion: policy.version, pool, day,
    requestCount: state.requestCount, byteCount: state.byteCount,
    completedJobIds: [...state.completedJobIds].sort(), recordIds: [...new Set(state.recordIds)].filter(Boolean).sort(),
    failed: state.failed, limits,
  }
  return { ...state, manifest: { ...manifestBase, manifestId: digest(manifestBase) } }
}
