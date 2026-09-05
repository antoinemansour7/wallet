import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { RESEARCH_MODEL_VERSION, EVALUATION_VERSION } from './researchPerformance.js'

const { data, redis } = vi.hoisted(() => {
  const data = new Map()
  return { data, redis: { get: vi.fn(async (key) => data.get(key)), set: vi.fn(async (key, value) => { data.set(key, value) }) } }
})
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: () => redis } }))
import { storePickPerformance } from './agents/signalHistoryTools.js'

beforeEach(() => {
  data.clear()
  vi.clearAllMocks()
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://test.invalid')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test')
})
afterEach(() => vi.unstubAllEnvs())

describe('versioned performance storage', () => {
  const extras = { modelVersion: RESEARCH_MODEL_VERSION, evaluationVersion: EVALUATION_VERSION, entryDate: '2026-06-15', exitDate: '2026-06-22', netReturn: 9.8, benchmarkReturn: 2, excessReturn: 7.8, costBps: 20 }

  it('stores explicit session dates, cost and benchmark-adjusted returns', async () => {
    await storePickPerformance('2026-06-12', 'ABC', 100, 110, 5, extras)
    expect(data.get('research:performance:2026-06-12:ABC')).toMatchObject({
      modelVersion: RESEARCH_MODEL_VERSION, evaluationVersion: EVALUATION_VERSION,
      return_day5: 10, net_return_day5: 9.8, excess_return_day5: 7.8,
      exit_date_day5: '2026-06-22', entryDate: '2026-06-15', costBps: 20,
    })
  })

  it('replaces a legacy calendar-day record without mixing its old checkpoints', async () => {
    const key = 'research:performance:2026-06-12:ABC'
    data.set(key, { return_day1: 99, return_day5: 88, entryPrice: 50 })
    await storePickPerformance('2026-06-12', 'ABC', 100, 110, 5, extras)
    expect(data.get(key).return_day1).toBeUndefined()
    expect(data.get(key).return_day5).toBe(10)
    expect(data.get(key).entryPrice).toBe(100)
  })

  it('does not overwrite a completed checkpoint on repeated cron runs', async () => {
    await storePickPerformance('2026-06-12', 'ABC', 100, 110, 5, extras)
    await storePickPerformance('2026-06-12', 'ABC', 100, 130, 5, extras)
    expect(redis.set).toHaveBeenCalledTimes(1)
    expect(data.get('research:performance:2026-06-12:ABC').price_day5).toBe(110)
  })

  it('does not write invalid prices', async () => {
    await storePickPerformance('2026-06-12', 'ABC', 0, 110, 5, extras)
    await storePickPerformance('2026-06-12', 'ABC', 100, NaN, 5, extras)
    expect(redis.set).not.toHaveBeenCalled()
  })
})
