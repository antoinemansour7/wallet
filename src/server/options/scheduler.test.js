// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  OPTIONS_KILL_SWITCH_KEY,
  OPTIONS_SCHEDULE_POLICY,
  OptionsSchedulerUnavailableError,
  acquireOptionsStageLease,
  checkpointOptionsStage,
  completeOptionsStage,
  optionsScheduleHealth,
  optionsStageWindow,
  readCompletedOptionsStage,
  runBounded,
  runOptionsScheduledStage,
} from './scheduler.js'

function memoryRedis(clock = () => Date.now()) {
  const values = new Map(), expirations = new Map(), counters = new Map()
  const live = (key) => {
    if (expirations.has(key) && expirations.get(key) <= clock()) { values.delete(key); expirations.delete(key) }
    return values.has(key)
  }
  return {
    values,
    async get(key) { return live(key) ? values.get(key) : null },
    async incr(key) { const value = (counters.get(key) || 0) + 1; counters.set(key, value); return value },
    async expire(key, ttl) { expirations.set(key, clock() + Number(ttl) * 1000); return 1 },
    async set(key, value, options = {}) {
      if (options.nx && live(key)) return null
      values.set(key, value)
      if (options.ex) expirations.set(key, clock() + Number(options.ex) * 1000)
      return 'OK'
    },
    async eval(_script, keys, args) {
      const leaseKey = keys[0]
      if (!live(leaseKey) || values.get(leaseKey) !== args[0]) return 0
      if (keys.length === 1 && args.length === 2) {
        values.set(leaseKey, args[0]); expirations.set(leaseKey, clock() + Number(args[1]) * 1000); return 1
      }
      if (keys.length === 1) { values.delete(leaseKey); expirations.delete(leaseKey); return 1 }
      const outputKey = keys[1]
      if (outputKey.includes(':completion:')) {
        if (live(outputKey)) return 2
        values.set(outputKey, args[1]); expirations.set(outputKey, clock() + Number(args[2]) * 1000)
        values.delete(leaseKey); expirations.delete(leaseKey); values.delete(keys[2]); return 1
      }
      values.set(outputKey, args[1]); expirations.set(outputKey, clock() + Number(args[2]) * 1000); return 1
    },
  }
}

function memoryArchive() {
  const records = []
  return { records, async put(kind, id, record, index, availableAt) { records.push({ kind, id, record, index, availableAt }); return record } }
}

describe('options morning scheduler', () => {
  it('resolves the same New York stage times across standard time and daylight time', () => {
    expect(optionsStageWindow('2026-01-15T14:15:00.000Z', 'premarket')).toMatchObject({
      state: 'on_time', localTime: '09:15:00', scheduledAt: '2026-01-15T14:15:00.000Z', deadlineAt: '2026-01-15T14:20:00.000Z',
    })
    expect(optionsStageWindow('2026-07-15T13:15:00.000Z', 'premarket')).toMatchObject({
      state: 'on_time', localTime: '09:15:00', scheduledAt: '2026-07-15T13:15:00.000Z', deadlineAt: '2026-07-15T13:20:00.000Z',
    })
    expect(optionsStageWindow('2026-07-15T13:31:00.000Z', 'opening')).toMatchObject({ state: 'on_time', localTime: '09:31:00' })
    expect(optionsStageWindow('2026-07-15T13:35:00.000Z', 'opening')).toMatchObject({ state: 'late' })
  })

  it('uses the versioned calendar for holidays and early-close trading days', () => {
    expect(optionsStageWindow('2026-09-07T13:15:00.000Z', 'premarket')).toMatchObject({ state: 'closed', reason: 'holiday' })
    expect(optionsStageWindow('2026-11-27T14:31:00.000Z', 'opening')).toMatchObject({ state: 'on_time', marketDay: { earlyClose: true } })
  })

  it('fences an expired worker from checkpoints and completion after a new owner takes over', async () => {
    let time = Date.parse('2026-07-15T13:15:00.000Z')
    const redis = memoryRedis(() => time)
    const first = await acquireOptionsStageLease(redis, { tradingDate: '2026-07-15', stage: 'premarket', ownerId: 'first', leaseSeconds: 2 })
    expect(first).toMatchObject({ status: 'acquired', fence: 1 })
    time += 2001
    const second = await acquireOptionsStageLease(redis, { tradingDate: '2026-07-15', stage: 'premarket', ownerId: 'second', leaseSeconds: 2 })
    expect(second).toMatchObject({ status: 'acquired', fence: 2 })
    await expect(checkpointOptionsStage(redis, first, { cursor: 'stale', savedAt: new Date(time).toISOString() })).rejects.toMatchObject({ code: 'lease_lost' })
    await expect(completeOptionsStage(redis, first, { status: 'complete' })).rejects.toMatchObject({ code: 'lease_lost' })
    expect(await checkpointOptionsStage(redis, second, { cursor: 'page-2', savedAt: new Date(time).toISOString() })).toMatchObject({ cursor: 'page-2', fence: 2 })
  })

  it('lets another stage read a completed stage without acquiring its lease', async () => {
    const time = Date.parse('2026-07-15T13:15:00.000Z')
    const redis = memoryRedis(() => time)
    expect(await readCompletedOptionsStage(redis, { tradingDate: '2026-07-15', stage: 'premarket' })).toBeNull()
    const lease = await acquireOptionsStageLease(redis, { tradingDate: '2026-07-15', stage: 'premarket', ownerId: 'first', leaseSeconds: 60 })
    await completeOptionsStage(redis, lease, { status: 'complete', auditRecordId: 'audit-reference' })
    expect(await readCompletedOptionsStage(redis, { tradingDate: '2026-07-15', stage: 'premarket' })).toMatchObject({ status: 'complete', auditRecordId: 'audit-reference' })
  })

  it('deduplicates concurrent triggers into one logical publication', async () => {
    const now = () => Date.parse('2026-07-15T13:15:00.000Z')
    const redis = memoryRedis(now), archive = memoryArchive()
    let finish
    const execute = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const publish = vi.fn()
    const first = runOptionsScheduledStage({ redis, archive, stage: 'premarket', requestId: 'request-one', now, execute, publish, enabled: true })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    const duplicate = await runOptionsScheduledStage({ redis, archive, stage: 'premarket', requestId: 'request-two', now, execute, publish, enabled: true })
    expect(duplicate.status).toBe('in_progress')
    finish({ status: 'complete', metrics: { securities: 25 } })
    const completed = await first
    expect(completed).toMatchObject({ status: 'complete', attempt: 1, fence: 1 })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(await runOptionsScheduledStage({ redis, archive, stage: 'premarket', requestId: 'request-three', now, execute, publish, enabled: true })).toMatchObject({ status: 'duplicate' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('checkpoints incomplete work and resumes its cursor on the retry', async () => {
    const now = () => Date.parse('2026-07-15T13:16:00.000Z')
    const redis = memoryRedis(now), archive = memoryArchive(), seen = []
    const execute = vi.fn(async ({ attempt, checkpoint, deadlineAt, maxConcurrency }) => {
      seen.push({ attempt, checkpoint, deadlineAt, maxConcurrency })
      return attempt === 1
        ? { status: 'incomplete', checkpoint: { cursor: 'contracts-page-3' }, reason: 'provider_timeout', metrics: { pages: 2 } }
        : { status: 'complete', metrics: { pages: 4 } }
    })
    expect(await runOptionsScheduledStage({ redis, archive, stage: 'premarket', requestId: 'one', now, execute, enabled: true })).toMatchObject({ status: 'incomplete', attempt: 1 })
    expect(await runOptionsScheduledStage({ redis, archive, stage: 'premarket', requestId: 'two', now, execute, enabled: true })).toMatchObject({ status: 'complete', attempt: 2 })
    expect(seen[1]).toMatchObject({ attempt: 2, checkpoint: { cursor: 'contracts-page-3', attempt: 1, fence: 1 } })
    expect(seen[0]).toMatchObject({ deadlineAt: '2026-07-15T13:20:00.000Z', maxConcurrency: 4 })
    expect(archive.records.map((item) => item.record.payload.status)).toEqual(['incomplete', 'complete'])
  })

  it('records a missed result without starting work after the stage deadline', async () => {
    const now = () => Date.parse('2026-07-15T13:21:00.000Z')
    const archive = memoryArchive(), execute = vi.fn()
    const result = await runOptionsScheduledStage({ redis: memoryRedis(now), archive, stage: 'premarket', requestId: 'late-secret-looking-id', now, execute, enabled: true })
    expect(result).toMatchObject({ status: 'missed', tradingDate: '2026-07-15' })
    expect(execute).not.toHaveBeenCalled()
    expect(archive.records[0].record.payload).toMatchObject({ status: 'missed', errorCode: 'stage_deadline_missed' })
    expect(JSON.stringify(archive.records[0].record)).not.toContain('late-secret-looking-id')
  })

  it('reserves serverless finishing time when it is earlier than the scanner deadline', async () => {
    const now = () => Date.parse('2026-07-15T12:00:00.000Z')
    const redis = memoryRedis(now)
    let deadlineAt
    const policy = { ...OPTIONS_SCHEDULE_POLICY, maxDurationMs: 60000, finishReserveMs: 15000 }
    await runOptionsScheduledStage({
      redis, archive: memoryArchive(), stage: 'premarket', now, policy, requestId: 'budget', enabled: true,
      execute: async (context) => { deadlineAt = context.deadlineAt; return { status: 'incomplete', reason: 'checkpoint_only' } },
    })
    expect(deadlineAt).toBe('2026-07-15T12:00:45.000Z')
  })

  it('uses scanner deadlines for health instead of the research grace period', () => {
    expect(optionsScheduleHealth([], Date.parse('2026-07-15T13:19:59.999Z')).missing).toEqual([])
    expect(optionsScheduleHealth([], Date.parse('2026-07-15T13:20:00.000Z')).missing).toContainEqual(expect.objectContaining({ stage: 'premarket', status: 'missed' }))
    expect(optionsScheduleHealth([], Date.parse('2026-07-15T13:35:00.000Z')).missing.map((item) => item.stage)).toEqual(['premarket', 'opening'])
    expect(optionsScheduleHealth([{ stage: 'premarket', tradingDate: '2026-07-15', status: 'complete', endedAt: '2026-07-15T13:19:59.000Z' }],
      Date.parse('2026-07-15T13:35:00.000Z')).missing.map((item) => item.stage)).toEqual(['opening'])
  })

  it('fails closed on Redis outage and honors both deployment and runtime kill switches', async () => {
    const now = () => Date.parse('2026-07-15T13:15:00.000Z')
    const broken = { async get() { throw new Error('quota') } }
    await expect(runOptionsScheduledStage({ redis: broken, stage: 'premarket', now, execute: vi.fn(), enabled: true })).rejects.toBeInstanceOf(OptionsSchedulerUnavailableError)
    expect(await runOptionsScheduledStage({ stage: 'premarket', now, execute: vi.fn(), enabled: false })).toMatchObject({ status: 'disabled' })
    const redis = memoryRedis(now)
    await redis.set(OPTIONS_KILL_SWITCH_KEY, 'maintenance')
    expect(await runOptionsScheduledStage({ redis, stage: 'premarket', now, execute: vi.fn(), enabled: true })).toMatchObject({ status: 'disabled' })
  })

  it('bounds concurrent page work without polling Redis', async () => {
    let active = 0, peak = 0
    const result = await runBounded([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1; peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return value * 2
    })
    expect(result).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBe(2)
    expect(OPTIONS_SCHEDULE_POLICY.provider.schedules).toEqual({
      premarket: 'CRON_TZ=America/New_York 15 9 * * 1-5',
      opening: 'CRON_TZ=America/New_York 31 9 * * 1-5',
    })
  })
})
