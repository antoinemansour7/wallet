import { describe, expect, it } from 'vitest'
import { earningsToSignals, moversToSignals } from './dayTradeSignals'
import { firstSessionAfter } from '../../api/track-performance'

describe('earningsToSignals', () => {
  it('converts earnings reporters into screener-style board signals', () => {
    const signals = earningsToSignals(
      [{ ticker: 'HIMS', timing: 'before open' }],
      { when: 'tomorrow' },
    )

    expect(signals).toHaveLength(1)
    expect(signals[0].tickers).toEqual(['HIMS'])
    expect(signals[0].sourceType).toBe('screener')
    expect(signals[0].sourceLabels).toEqual(['earnings-calendar'])
    expect(signals[0].text).toContain('earnings tomorrow before open')
  })
})

describe('moversToSignals', () => {
  it('converts premarket gainers into signals with the move size', () => {
    const signals = moversToSignals([{ ticker: 'IREN', changePerc: 6.2 }])

    expect(signals[0].tickers).toEqual(['IREN'])
    expect(signals[0].sourceLabels).toEqual(['premarket-movers'])
    expect(signals[0].text).toContain('6.2%')
  })
})

describe('firstSessionAfter', () => {
  const candles = [
    { date: '2026-06-10', open: 100, high: 105 },
    { date: '2026-06-11', open: 102, high: 110 },
    { date: '2026-06-12', open: 108, high: 109 },
  ]

  it('returns the open/high of the first trading day after the pick date', () => {
    expect(firstSessionAfter(candles, '2026-06-10')).toEqual({ day1Open: 102, day1High: 110 })
  })

  it('skips weekends/holidays implicitly via date comparison', () => {
    expect(firstSessionAfter(candles, '2026-06-11')).toEqual({ day1Open: 108, day1High: 109 })
  })

  it('returns null when no later session exists', () => {
    expect(firstSessionAfter(candles, '2026-06-12')).toBeNull()
    expect(firstSessionAfter([], '2026-06-10')).toBeNull()
  })
})
