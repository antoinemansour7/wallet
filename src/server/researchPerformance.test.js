import { describe, expect, it } from 'vitest'
import { sessionCheckpoints, computeLearningStats, evidenceAdjustment, RESEARCH_MODEL_VERSION, EVALUATION_VERSION } from './researchPerformance.js'

const bar = (date, open, close, high = close) => ({ date, timestamp: Date.parse(`${date}T13:30:00Z`), open, close, high })
const candles = [bar('2026-06-12', 100, 102), bar('2026-06-15', 110, 111, 113), bar('2026-06-16', 111, 112), bar('2026-06-17', 112, 114), bar('2026-06-18', 114, 115), bar('2026-06-22', 115, 121)]
const benchmark = candles.map((item) => ({ ...item, open: 100, close: 102 }))

describe('sessionCheckpoints', () => {
  it('measures from the next open, skips weekends/holidays, and charges costs', () => {
    const points = sessionCheckpoints(candles, '2026-06-12T21:00:00Z', Date.parse('2026-06-22T21:00:00Z'), benchmark)
    const fifth = points.find((item) => item.horizon === 5)
    expect(fifth.entryDate).toBe('2026-06-15')
    expect(fifth.exitDate).toBe('2026-06-22')
    expect(fifth.entryPrice).toBe(110) // not the unachievable Friday close
    expect(fifth.grossReturn).toBeCloseTo(10)
    expect(fifth.netReturn).toBeCloseTo(9.8)
    expect(fifth.benchmarkReturn).toBeCloseTo(2)
    expect(fifth.excessReturn).toBeCloseTo(7.8)
  })

  it('uses the same-day open for a premarket recommendation', () => {
    const [first] = sessionCheckpoints(candles, '2026-06-15T13:00:00Z', Date.parse('2026-06-15T21:00:00Z'))
    expect(first.entryDate).toBe('2026-06-15')
    expect(first.exitDate).toBe('2026-06-15')
  })

  it('does not backdate entry for a recommendation made after the open', () => {
    const [first] = sessionCheckpoints(candles, '2026-06-15T14:00:00Z', Date.parse('2026-06-16T21:00:00Z'))
    expect(first.entryDate).toBe('2026-06-16')
  })

  it('never records an in-progress session, even when the tracker runs intraday', () => {
    expect(sessionCheckpoints(candles, '2026-06-15T13:00:00Z', Date.parse('2026-06-15T14:30:00Z'))).toEqual([])
    const points = sessionCheckpoints(candles, '2026-06-15T13:00:00Z', Date.parse('2026-06-22T14:30:00Z'))
    expect(points.map((item) => item.horizon)).toEqual([1, 3])
  })

  it('backfills missed checkpoints using their historical closes, not the latest quote', () => {
    const points = sessionCheckpoints(candles, '2026-06-15T13:00:00Z', Date.parse('2026-07-01T00:00:00Z'))
    expect(points[0].exitPrice).toBe(111)
    expect(points[1].exitPrice).toBe(114)
  })

  it('does not silently shift entry past invalid data or invent a benchmark', () => {
    const broken = candles.map((item) => item.date === '2026-06-15' ? { ...item, open: null } : item)
    expect(sessionCheckpoints(broken, '2026-06-15T13:00:00Z')).toEqual([])
    const [point] = sessionCheckpoints(candles, '2026-06-15T13:00:00Z')
    expect(point.benchmarkReturn).toBeNull()
    expect(point.excessReturn).toBeNull()
    expect(sessionCheckpoints(candles, 'unknown')).toEqual([])
  })
})

const record = (overrides = {}) => ({ ticker: 'A', pickDate: '2026-06-01', exit_date_day5: '2026-06-08', modelVersion: RESEARCH_MODEL_VERSION, evaluationVersion: EVALUATION_VERSION, net_return_day5: 3, excess_return_day5: 2, setupType: 'catalyst', sources: ['desk'], ...overrides })

describe('comparable performance feedback', () => {
  it('excludes legacy, unfinished, future, shadow, duplicate and invalid observations', () => {
    const records = [record(), record(), record({ ticker: 'OLD', modelVersion: 'legacy' }), record({ ticker: 'SHADOW', shadow: true }),
      record({ ticker: 'NEW', net_return_day5: null }), record({ ticker: 'BAD', excess_return_day5: NaN }),
      record({ ticker: 'FUTURE', exit_date_day5: '2027-01-01' })]
    const stats = computeLearningStats(records, Date.parse('2026-07-01'))
    expect(stats.total).toBe(1)
    expect(stats.avgNetReturn).toBe(3)
    expect(stats.bySource.desk.total).toBe(1)
  })

  it('does not reward a high win rate with negative average returns', () => {
    expect(evidenceAdjustment({ total: 100, distinctDates: 20, avgNetReturn: -2, avgExcessReturn: 1, lowerBound: 0.5, upperBound: 1.5 })).toBe(0)
  })

  it('requires multiple dates and sufficient observations and shrinks the adjustment', () => {
    const strong = { total: 20, distinctDates: 10, avgNetReturn: 3, avgExcessReturn: 1.5, lowerBound: 1, upperBound: 2 }
    expect(evidenceAdjustment(strong)).toBe(0.5)
    expect(evidenceAdjustment({ ...strong, total: 19 })).toBe(0)
    expect(evidenceAdjustment({ ...strong, distinctDates: 2 })).toBe(0)
    expect(evidenceAdjustment({ ...strong, lowerBound: -1 })).toBe(0)
    expect(evidenceAdjustment({ ...strong, avgExcessReturn: -3, lowerBound: -4, upperBound: -2 })).toBe(-1)
  })

  it('does not treat many correlated picks from one date as independent evidence', () => {
    const stats = computeLearningStats(Array.from({ length: 50 }, (_, i) => record({ ticker: `T${i}` })))
    expect(stats.bySetup.catalyst.distinctDates).toBe(1)
    expect(evidenceAdjustment(stats.bySetup.catalyst)).toBe(0)
  })
})
