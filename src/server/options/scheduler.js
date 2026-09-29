import { randomUUID } from 'node:crypto'
import { digest } from '../research/archive.js'
import { createOptionsAuditRecord } from './audit.js'
import { archiveOptionsAuditRecord } from './auditStore.js'
import { OPTIONS_CALENDAR_2026, marketDay, optionsLocalParts, zonedMarketInstant } from './calendar.js'

export const OPTIONS_SCHEDULE_POLICY = Object.freeze({
  version: 'options-morning-schedule-v1',
  timeZone: 'America/New_York',
  stages: Object.freeze({
    premarket: Object.freeze({ windowStart: '08:00', scheduled: '09:15', deadline: '09:20', maxConcurrency: 4 }),
    opening: Object.freeze({ windowStart: '09:31', scheduled: '09:31', deadline: '09:35', maxConcurrency: 3 }),
    // Experiments only. The wider deadline lets a CPU-bound scan resume on
    // QStash retries; it never delays or competes with the 09:31 live scan.
    shadow: Object.freeze({ windowStart: '09:36', scheduled: '09:36', deadline: '09:50', maxConcurrency: 2 }),
  }),
  provider: Object.freeze({
    name: 'upstash-qstash',
    plan: 'free',
    schedules: Object.freeze({
      premarket: 'CRON_TZ=America/New_York 15 9 * * 1-5',
      opening: 'CRON_TZ=America/New_York 31 9 * * 1-5',
      shadow: 'CRON_TZ=America/New_York 36 9 * * 1-5',
    }),
  }),
  maxDurationMs: 300000,
  finishReserveMs: 15000,
  leaseSeconds: 330,
})

export const OPTIONS_KILL_SWITCH_KEY = 'research:options:kill:v1'
const KEY_PREFIX = 'research:options:schedule:v1'
const CHECKPOINT_TTL_SECONDS = 7 * 86400
const COMPLETION_TTL_SECONDS = 30 * 86400
const RENEW_LUA = "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2]) return 1"
const CHECKPOINT_LUA = "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3]) return 1"
const COMPLETE_LUA = "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end if redis.call('exists', KEYS[2]) == 1 then return 2 end redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3]) redis.call('del', KEYS[1]) redis.call('del', KEYS[3]) return 1"
const RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"

export class OptionsSchedulerUnavailableError extends Error {
  constructor(code = 'storage_unavailable') {
    super(`Options scheduler unavailable: ${code}`)
    this.name = 'OptionsSchedulerUnavailableError'
    this.code = code
  }
}

function iso(value, field) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) throw new Error(`${field} must be a valid instant`)
  return new Date(time).toISOString()
}

function stagePolicy(stage, policy = OPTIONS_SCHEDULE_POLICY) {
  const value = policy.stages[stage]
  if (!value) throw new Error(`Unsupported options stage: ${stage}`)
  return value
}

function keys({ tradingDate, stage, policyVersion }) {
  const identity = `${tradingDate}:${stage}:${policyVersion}`
  return {
    lease: `${KEY_PREFIX}:lease:${identity}`,
    fence: `${KEY_PREFIX}:fence:${identity}`,
    checkpoint: `${KEY_PREFIX}:checkpoint:${identity}`,
    completion: `${KEY_PREFIX}:completion:${identity}`,
  }
}

function seconds(value) {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 3600 + minute * 60
}

export function optionsStageWindow(instant, stage, { calendar = OPTIONS_CALENDAR_2026, policy = OPTIONS_SCHEDULE_POLICY } = {}) {
  const actualAt = iso(instant, 'schedule instant')
  const local = optionsLocalParts(actualAt)
  const day = marketDay(local.date, calendar)
  const definition = stagePolicy(stage, policy)
  const base = {
    stage,
    tradingDate: local.date,
    actualAt,
    localTime: `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}:${String(local.second).padStart(2, '0')}`,
    calendarVersion: calendar.version,
    policyVersion: policy.version,
  }
  if (!day.known) return { ...base, state: 'unknown', reason: day.reason }
  if (!day.open) return { ...base, state: 'closed', reason: day.reason, marketDay: day }
  const windowStartAt = zonedMarketInstant(local.date, definition.windowStart, calendar.timeZone)
  const scheduledAt = zonedMarketInstant(local.date, definition.scheduled, calendar.timeZone)
  const deadlineAt = zonedMarketInstant(local.date, definition.deadline, calendar.timeZone)
  const currentSecond = local.hour * 3600 + local.minute * 60 + local.second
  const state = currentSecond < seconds(definition.windowStart) ? 'early'
    : currentSecond < seconds(definition.deadline) ? 'on_time' : 'late'
  return { ...base, state, reason: state === 'early' ? 'stage_window_not_open' : state === 'late' ? 'stage_deadline_missed' : null,
    windowStartAt, scheduledAt, deadlineAt, marketDay: day, maxConcurrency: definition.maxConcurrency }
}

function parseStored(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return value }
  }
  return value
}

export async function acquireOptionsStageLease(redis, {
  tradingDate,
  stage,
  policyVersion = OPTIONS_SCHEDULE_POLICY.version,
  ownerId = randomUUID(),
  leaseSeconds = OPTIONS_SCHEDULE_POLICY.leaseSeconds,
  startedAt = new Date().toISOString(),
} = {}) {
  if (!redis || !Number.isInteger(leaseSeconds) || leaseSeconds < 1) throw new Error('A finite options stage lease is required')
  const stageKeys = keys({ tradingDate, stage, policyVersion })
  try {
    const completed = parseStored(await redis.get(stageKeys.completion))
    if (completed) return { status: 'completed', completion: completed, keys: stageKeys }
    const fence = Number(await redis.incr(stageKeys.fence))
    if (!Number.isSafeInteger(fence) || fence < 1) throw new Error('invalid fence')
    await redis.expire(stageKeys.fence, COMPLETION_TTL_SECONDS)
    const ownerRef = digest(ownerId).slice(0, 24)
    const token = `${fence}:${ownerRef}`
    const acquired = await redis.set(stageKeys.lease, token, { nx: true, ex: leaseSeconds })
    if (!acquired) return { status: 'busy', keys: stageKeys }
    const completion = parseStored(await redis.get(stageKeys.completion))
    if (completion) {
      await redis.eval(RELEASE_LUA, [stageKeys.lease], [token])
      return { status: 'completed', completion, keys: stageKeys }
    }
    return { status: 'acquired', token, fence, ownerRef, startedAt: iso(startedAt, 'lease startedAt'), leaseSeconds, keys: stageKeys }
  } catch (error) {
    if (error instanceof OptionsSchedulerUnavailableError) throw error
    throw new OptionsSchedulerUnavailableError('lease_store_unavailable')
  }
}

export async function renewOptionsStageLease(redis, lease) {
  try {
    return Number(await redis.eval(RENEW_LUA, [lease.keys.lease], [lease.token, String(lease.leaseSeconds)])) === 1
  } catch { throw new OptionsSchedulerUnavailableError('lease_renewal_unavailable') }
}

export async function releaseOptionsStageLease(redis, lease) {
  try { return Number(await redis.eval(RELEASE_LUA, [lease.keys.lease], [lease.token])) === 1 }
  catch { throw new OptionsSchedulerUnavailableError('lease_release_unavailable') }
}

// Read-only lookup of another stage's completion pointer -- e.g. the
// opening stage reading premarket's, to find that stage's frozen decision.
// Does not acquire a lease or touch fencing/checkpoint state.
export async function readCompletedOptionsStage(redis, { tradingDate, stage, policyVersion = OPTIONS_SCHEDULE_POLICY.version } = {}) {
  try { return parseStored(await redis.get(keys({ tradingDate, stage, policyVersion }).completion)) }
  catch { throw new OptionsSchedulerUnavailableError('completion_read_unavailable') }
}

export async function readOptionsStageCheckpoint(redis, lease) {
  try { return parseStored(await redis.get(lease.keys.checkpoint)) }
  catch { throw new OptionsSchedulerUnavailableError('checkpoint_read_unavailable') }
}

export async function checkpointOptionsStage(redis, lease, checkpoint) {
  const record = { ...checkpoint, fence: lease.fence, savedAt: iso(checkpoint.savedAt || new Date(), 'checkpoint savedAt') }
  try {
    const written = Number(await redis.eval(CHECKPOINT_LUA, [lease.keys.lease, lease.keys.checkpoint], [lease.token, JSON.stringify(record), String(CHECKPOINT_TTL_SECONDS)]))
    if (written !== 1) throw new OptionsSchedulerUnavailableError('lease_lost')
    return record
  } catch (error) {
    if (error instanceof OptionsSchedulerUnavailableError) throw error
    throw new OptionsSchedulerUnavailableError('checkpoint_write_unavailable')
  }
}

export async function completeOptionsStage(redis, lease, completion) {
  const record = { ...completion, fence: lease.fence }
  try {
    const result = Number(await redis.eval(COMPLETE_LUA, [lease.keys.lease, lease.keys.completion, lease.keys.checkpoint],
      [lease.token, JSON.stringify(record), String(COMPLETION_TTL_SECONDS)]))
    if (result === 0) throw new OptionsSchedulerUnavailableError('lease_lost')
    if (result === 2) return { status: 'duplicate', completion: parseStored(await redis.get(lease.keys.completion)) }
    return { status: 'completed', completion: record }
  } catch (error) {
    if (error instanceof OptionsSchedulerUnavailableError) throw error
    throw new OptionsSchedulerUnavailableError('completion_write_unavailable')
  }
}

export async function runBounded(items, concurrency, work) {
  if (!Array.isArray(items) || !Number.isInteger(concurrency) || concurrency < 1) throw new Error('Bounded work requires items and positive concurrency')
  const output = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      output[index] = await work(items[index], index)
    }
  })
  await Promise.all(workers)
  return output
}

function requestReference(value) {
  return digest(String(value || randomUUID())).slice(0, 16)
}

function safeMetrics(metrics) {
  return Object.fromEntries(Object.entries(metrics || {}).filter(([, value]) => typeof value === 'string'
    || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))))
}

export function createOptionsScheduleAuditRecord({ scanId, window, status, startedAt, endedAt, attempt, fence, requestId, checkpoint, metrics, errorCode } = {}) {
  const payload = {
    stage: window.stage,
    status,
    policyVersion: window.policyVersion,
    calendarVersion: window.calendarVersion,
    tradingDate: window.tradingDate,
    scheduledAt: window.scheduledAt,
    deadlineAt: window.deadlineAt,
    startedAt: iso(startedAt, 'stage startedAt'),
    endedAt: iso(endedAt, 'stage endedAt'),
    attempt,
    requestRef: requestReference(requestId),
    ...(Number.isSafeInteger(fence) ? { fence } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    ...(Object.keys(safeMetrics(metrics)).length ? { metrics: safeMetrics(metrics) } : {}),
    ...(errorCode ? { errorCode } : {}),
  }
  const missing = []
  const findNulls = (value, path = 'payload') => {
    if (value === null) { missing.push({ path, reason: 'not_available_for_attempt' }); return }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) findNulls(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`)
  }
  findNulls(payload)
  return createOptionsAuditRecord({
    type: 'scan', scanId, availableAt: payload.endedAt,
    source: { provider: 'wallai', feed: 'scheduled-dispatch', session: window.stage, entitlement: 'internal' },
    versions: { code: 'options-scheduler-v1', model: 'deterministic-no-model', policy: window.policyVersion },
    payload,
    missing,
  })
}

async function archiveAttempt(archive, input) {
  const record = createOptionsScheduleAuditRecord(input)
  if (archive) await archiveOptionsAuditRecord(archive, record)
  return record
}

async function deadlineRace(deadlineAt, now, work) {
  const available = Date.parse(deadlineAt) - now()
  if (available <= 0) throw Object.assign(new Error('stage deadline reached'), { code: 'stage_deadline' })
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('stage deadline reached'), { code: 'stage_deadline' })), available)
    timer.unref?.()
  })
  try { return await Promise.race([work(), timeout]) }
  finally { clearTimeout(timer) }
}

export async function runOptionsScheduledStage({
  redis,
  archive,
  stage,
  execute,
  publish = async () => {},
  requestId,
  now = Date.now,
  calendar = OPTIONS_CALENDAR_2026,
  policy = OPTIONS_SCHEDULE_POLICY,
  enabled = process.env.OPTIONS_SCANNER_ENABLED === 'true',
} = {}) {
  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()
  const window = optionsStageWindow(startedAt, stage, { calendar, policy })
  const scanId = `${window.tradingDate}:${stage}:${policy.version}`
  if (!enabled) return { status: 'disabled', stage, tradingDate: window.tradingDate, policyVersion: policy.version }
  if (!redis) throw new OptionsSchedulerUnavailableError('redis_required')
  let killed
  try { killed = await redis.get(OPTIONS_KILL_SWITCH_KEY) }
  catch { throw new OptionsSchedulerUnavailableError('kill_switch_unavailable') }
  if (killed) return { status: 'disabled', stage, tradingDate: window.tradingDate, policyVersion: policy.version }
  if (window.state === 'closed' || window.state === 'unknown' || window.state === 'early') {
    return { status: 'skipped', stage, tradingDate: window.tradingDate, reason: window.reason }
  }
  if (window.state === 'late') {
    const audit = await archiveAttempt(archive, { scanId, window, status: 'missed', startedAt, endedAt: startedAt, attempt: 0, requestId, errorCode: 'stage_deadline_missed' })
    return { status: 'missed', stage, tradingDate: window.tradingDate, auditRecordId: audit.recordId }
  }

  const lease = await acquireOptionsStageLease(redis, { tradingDate: window.tradingDate, stage, policyVersion: policy.version,
    ownerId: requestId || randomUUID(), leaseSeconds: policy.leaseSeconds, startedAt })
  if (lease.status === 'completed') return { status: 'duplicate', stage, tradingDate: window.tradingDate, completion: lease.completion }
  if (lease.status === 'busy') return { status: 'in_progress', stage, tradingDate: window.tradingDate }

  const previous = await readOptionsStageCheckpoint(redis, lease)
  const attempt = Number(previous?.attempt || 0) + 1
  let latestCheckpoint = previous
  const saveCheckpoint = async (value) => {
    latestCheckpoint = await checkpointOptionsStage(redis, lease, { ...value, attempt, savedAt: new Date(now()).toISOString() })
    return latestCheckpoint
  }
  const functionDeadline = startedMs + policy.maxDurationMs - policy.finishReserveMs
  const deadlineAt = new Date(Math.min(Date.parse(window.deadlineAt), functionDeadline)).toISOString()

  try {
    const result = await deadlineRace(deadlineAt, now, () => execute({
      stage, window, deadlineAt, attempt, checkpoint: previous, saveCheckpoint,
      maxConcurrency: stagePolicy(stage, policy).maxConcurrency,
    }))
    const endedAt = new Date(now()).toISOString()
    if (result?.status !== 'complete') {
      if (result?.checkpoint) await saveCheckpoint(result.checkpoint)
      const audit = await archiveAttempt(archive, { scanId, window, status: 'incomplete', startedAt, endedAt, attempt, fence: lease.fence,
        requestId, checkpoint: latestCheckpoint, metrics: result?.metrics, errorCode: result?.reason || 'stage_incomplete' })
      await releaseOptionsStageLease(redis, lease)
      return { status: 'incomplete', stage, tradingDate: window.tradingDate, attempt, auditRecordId: audit.recordId }
    }
    if (Date.parse(endedAt) >= Date.parse(window.deadlineAt)) {
      const audit = await archiveAttempt(archive, { scanId, window, status: 'late', startedAt, endedAt, attempt, fence: lease.fence,
        requestId, checkpoint: latestCheckpoint, metrics: result.metrics, errorCode: 'completed_after_deadline' })
      const completion = await completeOptionsStage(redis, lease, { status: 'late', endedAt, auditRecordId: audit.recordId })
      return { status: 'late', stage, tradingDate: window.tradingDate, attempt, completion: completion.completion }
    }
    if (!await renewOptionsStageLease(redis, lease)) throw new OptionsSchedulerUnavailableError('lease_lost')
    await publish(result, { lockKey: lease.keys.lease, lockToken: lease.token, fence: lease.fence, deadlineAt })
    const publishedAt = new Date(now()).toISOString()
    const audit = await archiveAttempt(archive, { scanId, window, status: 'complete', startedAt, endedAt: publishedAt, attempt, fence: lease.fence,
      requestId, checkpoint: latestCheckpoint, metrics: result.metrics })
    const completion = await completeOptionsStage(redis, lease, { status: 'complete', endedAt: publishedAt, auditRecordId: audit.recordId })
    return { status: completion.status === 'duplicate' ? 'duplicate' : 'complete', stage, tradingDate: window.tradingDate,
      attempt, auditRecordId: audit.recordId, fence: lease.fence }
  } catch (error) {
    const endedAt = new Date(now()).toISOString()
    const errorCode = error?.code || 'stage_failed'
    if (error?.checkpoint) {
      try { await saveCheckpoint(error.checkpoint) } catch { /* lease loss is reflected below */ }
    }
    // Only the stage window closing is final. Running out of this function's
    // own time (deadlineAt can be the earlier serverless limit) leaves the
    // stage open, so the provider's retry can still finish it in the window.
    const windowClosed = Date.parse(endedAt) >= Date.parse(window.deadlineAt)
      || (errorCode === 'stage_deadline' && Date.parse(deadlineAt) === Date.parse(window.deadlineAt))
    const status = windowClosed ? 'late' : 'incomplete'
    const audit = await archiveAttempt(archive, { scanId, window, status, startedAt, endedAt, attempt, fence: lease.fence,
      requestId, checkpoint: latestCheckpoint, errorCode })
    try {
      if (status === 'late') await completeOptionsStage(redis, lease, { status: 'late', endedAt, auditRecordId: audit.recordId })
      else await releaseOptionsStageLease(redis, lease)
    } catch { /* the original bounded failure remains the public result */ }
    return { status, stage, tradingDate: window.tradingDate, attempt, auditRecordId: audit.recordId, errorCode }
  }
}

function priorDate(date, days) {
  return new Date(Date.parse(`${date}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10)
}

export function optionsScheduleHealth(attempts = [], now = Date.now(), { calendar = OPTIONS_CALENDAR_2026, policy = OPTIONS_SCHEDULE_POLICY } = {}) {
  const checkedAt = iso(now, 'health checkedAt')
  const local = optionsLocalParts(checkedAt)
  let tradingDate = local.date
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = priorDate(local.date, offset)
    if (marketDay(candidate, calendar).open) { tradingDate = candidate; break }
  }
  const missing = []
  for (const stage of Object.keys(policy.stages)) {
    const deadlineAt = zonedMarketInstant(tradingDate, policy.stages[stage].deadline, calendar.timeZone)
    if (Date.parse(checkedAt) < Date.parse(deadlineAt)) continue
    const matching = attempts.filter((item) => item.stage === stage && item.tradingDate === tradingDate)
    const onTime = matching.find((item) => item.status === 'complete' && Date.parse(item.endedAt) < Date.parse(deadlineAt))
    if (!onTime) missing.push({ stage, tradingDate, deadlineAt, status: matching.at(-1)?.status || 'missed' })
  }
  return { checkedAt, policyVersion: policy.version, tradingDate, missing }
}
