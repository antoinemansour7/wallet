import { describe, expect, it, afterEach } from 'vitest'
import {
  DEFAULT_CYCLE_HOUR_UTC,
  cycleHourUtc,
  cycleStart,
  isSameCycle,
  mergePicksByScore,
  pickScore,
} from './researchCycle.js'

const at = (iso) => new Date(iso)
const pick = (ticker, finalScore, extra = {}) => ({ ticker, finalScore, ...extra })

describe('cycleHourUtc', () => {
  afterEach(() => { delete process.env.RESEARCH_CYCLE_HOUR_UTC })

  it('defaults to the scheduled cron hour', () => {
    expect(cycleHourUtc()).toBe(DEFAULT_CYCLE_HOUR_UTC)
  })

  it('accepts a configured hour', () => {
    process.env.RESEARCH_CYCLE_HOUR_UTC = '3'
    expect(cycleHourUtc()).toBe(3)
  })

  it.each(['', 'nightly', '24', '-1', '7.5'])('falls back on invalid value %j', (value) => {
    process.env.RESEARCH_CYCLE_HOUR_UTC = value
    expect(cycleHourUtc()).toBe(DEFAULT_CYCLE_HOUR_UTC)
  })

  it('accepts midnight, which is falsy but valid', () => {
    process.env.RESEARCH_CYCLE_HOUR_UTC = '0'
    expect(cycleHourUtc()).toBe(0)
  })
})

describe('cycleStart', () => {
  it('returns today at the scheduled hour once it has passed', () => {
    expect(cycleStart(at('2026-09-09T13:35:00Z')).toISOString()).toBe('2026-09-09T07:00:00.000Z')
  })

  it('returns yesterday at the scheduled hour before it arrives', () => {
    expect(cycleStart(at('2026-09-09T06:59:59Z')).toISOString()).toBe('2026-09-08T07:00:00.000Z')
  })

  it('treats the scheduled hour itself as opening a new cycle', () => {
    expect(cycleStart(at('2026-09-09T07:00:00Z')).toISOString()).toBe('2026-09-09T07:00:00.000Z')
  })

  it('crosses a month boundary', () => {
    expect(cycleStart(at('2026-10-01T02:00:00Z')).toISOString()).toBe('2026-09-30T07:00:00.000Z')
  })
})

describe('isSameCycle', () => {
  const now = at('2026-09-09T13:35:00Z')

  it('includes an earlier run from the same cycle', () => {
    expect(isSameCycle('2026-09-09T13:23:00Z', now)).toBe(true)
  })

  it('includes the scheduled run that opened the cycle', () => {
    expect(isSameCycle('2026-09-09T07:00:00Z', now)).toBe(true)
  })

  // The behaviour the whole module exists for: yesterday's board never bleeds
  // into today, even though it is less than 24 hours old.
  it('excludes the previous scheduled run', () => {
    expect(isSameCycle('2026-09-08T07:00:00Z', now)).toBe(false)
  })

  it('excludes a run 23 hours old that sits before the boundary', () => {
    expect(isSameCycle('2026-09-08T14:35:00Z', now)).toBe(false)
  })

  it.each([null, undefined, '', 'not-a-date'])('rejects %j', (value) => {
    expect(isSameCycle(value, now)).toBe(false)
  })
})

describe('pickScore', () => {
  it('uses finalScore when present', () => {
    expect(pickScore({ finalScore: 12.5, conviction: 4 })).toBe(12.5)
  })

  it('falls back to conviction when finalScore is missing', () => {
    expect(pickScore({ conviction: 8 })).toBe(12)
  })

  it('falls back to a neutral conviction when neither is usable', () => {
    expect(pickScore({})).toBe(7.5)
    expect(pickScore(null)).toBe(7.5)
  })

  it('treats a zero finalScore as a real score, not a missing one', () => {
    expect(pickScore({ finalScore: 0, conviction: 9 })).toBe(0)
  })
})

describe('mergePicksByScore', () => {
  it('keeps the highest scorers across both runs', () => {
    const carried = [pick('NBIS', 14), pick('QCOM', 9), pick('AAA', 8)]
    const current = [pick('NVDA', 13), pick('SNDK', 11), pick('BBB', 3)]

    const board = mergePicksByScore(carried, current)
    expect(board.map((p) => p.ticker)).toEqual(['NBIS', 'NVDA', 'SNDK'])
  })

  it('keeps a duplicated ticker whole from its higher-scoring run', () => {
    const carried = [pick('NVDA', 14, { report: 'carried report', price: 220 })]
    const current = [pick('NVDA', 9, { report: 'fresh report', price: 224 })]

    const [entry] = mergePicksByScore(carried, current)
    // Not assembled from both: the score and the report come from one run.
    expect(entry.finalScore).toBe(14)
    expect(entry.report).toBe('carried report')
    expect(entry.price).toBe(220)
  })

  it('gives a tie to the current run, whose evidence is fresher', () => {
    const carried = [pick('NVDA', 12, { report: 'carried report' })]
    const current = [pick('NVDA', 12, { report: 'fresh report' })]

    expect(mergePicksByScore(carried, current)[0].report).toBe('fresh report')
  })

  it('leaves the cycle board standing when a run extracts nothing', () => {
    const carried = [pick('NBIS', 14), pick('MU', 10)]
    expect(mergePicksByScore(carried, []).map((p) => p.ticker)).toEqual(['NBIS', 'MU'])
  })

  it('returns this run alone when the cycle is empty', () => {
    const current = [pick('NVDA', 13), pick('MU', 10)]
    expect(mergePicksByScore([], current).map((p) => p.ticker)).toEqual(['NVDA', 'MU'])
  })

  it('does not shrink the board below what either run held', () => {
    const carried = [pick('A', 9), pick('B', 8), pick('C', 7), pick('D', 6), pick('E', 5)]
    const current = [pick('F', 10)]
    expect(mergePicksByScore(carried, current)).toHaveLength(5)
  })

  it('honours an explicit limit', () => {
    const carried = [pick('A', 9), pick('B', 8)]
    const current = [pick('C', 10), pick('D', 7)]
    expect(mergePicksByScore(carried, current, { limit: 2 }).map((p) => p.ticker)).toEqual(['C', 'A'])
  })

  it('breaks score ties on ticker so the order is stable', () => {
    const board = mergePicksByScore([], [pick('ZZZ', 5), pick('AAA', 5), pick('MMM', 5)])
    expect(board.map((p) => p.ticker)).toEqual(['AAA', 'MMM', 'ZZZ'])
  })

  it('ignores entries with no ticker', () => {
    const board = mergePicksByScore([{ finalScore: 99 }], [pick('NVDA', 4)])
    expect(board.map((p) => p.ticker)).toEqual(['NVDA'])
  })

  it('ranks a pick that never reached finalizePicks by its conviction', () => {
    const carried = [pick('NBIS', 14)]
    const current = [{ ticker: 'NVDA', conviction: 10 }] // 15 via the fallback
    expect(mergePicksByScore(carried, current)[0].ticker).toBe('NVDA')
  })
})
