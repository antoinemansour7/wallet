import { describe, expect, it } from 'vitest'
import { computeWinRateStats, formatStatsForPrompt } from './signalHistoryTools'
import { checkpointSlot } from '../../../api/track-performance'

const NOW = new Date('2026-06-10T00:00:00Z').getTime()

function makeRecord(overrides = {}) {
  return {
    ticker: 'RKLB',
    pickDate: '2026-06-08',
    return_day3: 5,
    setupType: 'catalyst',
    conviction: 8,
    catalystVerified: true,
    riskScore: 4,
    sources: ['@unusualwhales'],
    ...overrides,
  }
}

describe('computeWinRateStats', () => {
  it('returns empty stats with no records', () => {
    expect(computeWinRateStats([]).totalPicks).toBe(0)
  })

  it('aggregates per-source win rates with a minimum sample size', () => {
    const records = [
      makeRecord({ ticker: 'A', return_day3: 6, sources: ['@winner'] }),
      makeRecord({ ticker: 'B', return_day3: 8, sources: ['@winner'] }),
      makeRecord({ ticker: 'C', return_day3: 4, sources: ['@winner'] }),
      makeRecord({ ticker: 'D', return_day3: -5, sources: ['@onesample'] }),
    ]

    const stats = computeWinRateStats(records, NOW)

    expect(stats.bySource['@winner'].total).toBe(3)
    expect(stats.bySource['@winner'].winRate).toBe(100)
    // Below n=3 threshold — excluded so noise can't steer picks
    expect(stats.bySource['@onesample']).toBeUndefined()
  })

  it('still computes setup and conviction stats', () => {
    const records = [
      makeRecord({ ticker: 'A', return_day3: 6 }),
      makeRecord({ ticker: 'B', return_day3: -4, setupType: 'squeeze', conviction: 6 }),
    ]

    const stats = computeWinRateStats(records, NOW)

    expect(stats.totalPicks).toBe(2)
    expect(stats.bySetup.catalyst.winRate).toBe(100)
    expect(stats.bySetup.squeeze.winRate).toBe(0)
  })
})

describe('formatStatsForPrompt', () => {
  it('includes source track record when enough sources exist', () => {
    const records = [
      makeRecord({ ticker: 'A', return_day3: 6, sources: ['@winner'] }),
      makeRecord({ ticker: 'B', return_day3: 8, sources: ['@winner'] }),
      makeRecord({ ticker: 'C', return_day3: 4, sources: ['@winner'] }),
      makeRecord({ ticker: 'D', return_day3: -5, sources: ['@loser'] }),
      makeRecord({ ticker: 'E', return_day3: -6, sources: ['@loser'] }),
      makeRecord({ ticker: 'F', return_day3: -2, sources: ['@loser'] }),
    ]

    const text = formatStatsForPrompt(computeWinRateStats(records, NOW))

    expect(text).toContain('Signal source track record')
    expect(text).toContain('@winner')
    expect(text).toContain('UNDERPERFORMING sources')
    expect(text).toContain('@loser')
  })
})

describe('computeWinRateStats day-1 metrics', () => {
  it('prefers open→close return with a +1.5% win threshold', () => {
    const records = [
      makeRecord({ ticker: 'A', return_day1: 5, return_day1_oc: 1.8, return_day3: -2 }),
      makeRecord({ ticker: 'B', return_day1: 4, return_day1_oc: 0.5 }),
    ]

    const stats = computeWinRateStats(records, NOW)

    // 1.8% oc = win, 0.5% oc = loss (despite both looking great close-to-close)
    expect(stats.overallWinRate).toBe(50)
    expect(stats.avgReturn).toBeCloseTo((1.8 + 0.5) / 2, 1)
  })

  it('averages intraday peak (MFE) when present', () => {
    const records = [
      makeRecord({ ticker: 'A', return_day1_oc: 2, mfe_day1: 4 }),
      makeRecord({ ticker: 'B', return_day1_oc: 1, mfe_day1: 2 }),
    ]

    expect(computeWinRateStats(records, NOW).avgIntradayPeak).toBe(3)
  })

  it('keeps shadow records out of headline stats but in setup/source learning', () => {
    const records = [
      makeRecord({ ticker: 'REAL', return_day1_oc: 3 }),
      makeRecord({ ticker: 'SH1', return_day1_oc: -2, shadow: true, setupType: 'squeeze', sources: ['@shadowsrc'] }),
      makeRecord({ ticker: 'SH2', return_day1_oc: -3, shadow: true, setupType: 'squeeze', sources: ['@shadowsrc'] }),
      makeRecord({ ticker: 'SH3', return_day1_oc: -1, shadow: true, setupType: 'squeeze', sources: ['@shadowsrc'] }),
    ]

    const stats = computeWinRateStats(records, NOW)

    expect(stats.totalPicks).toBe(1)
    expect(stats.overallWinRate).toBe(100)
    expect(stats.bySetup.squeeze.total).toBe(3)
    expect(stats.bySource['@shadowsrc'].winRate).toBe(0)
  })
})

describe('checkpointSlot', () => {
  it('maps days held to tolerant checkpoint windows', () => {
    expect(checkpointSlot(1)).toBe(1)
    expect(checkpointSlot(2)).toBe(1)
    expect(checkpointSlot(3)).toBe(3)
    expect(checkpointSlot(4)).toBe(3)
    expect(checkpointSlot(6)).toBe(5)
    expect(checkpointSlot(8)).toBe(null)
    expect(checkpointSlot(11)).toBe(10)
    expect(checkpointSlot(13)).toBe(null)
    expect(checkpointSlot(0)).toBe(null)
  })
})
