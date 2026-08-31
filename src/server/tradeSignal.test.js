import { describe, expect, it } from 'vitest'
import { computeSignal } from './tradeSignal'

describe('computeSignal', () => {
  it('returns BUY when trend, momentum, and MACD all point up', () => {
    const s = computeSignal({
      price: 110, sma20: 100, sma50: 95, rsi: 58,
      macd: { histogram: 0.4 }, prevClose: 108, relativeVolume: 1.0,
    })
    expect(s.verdict).toBe('BUY')
    expect(s.score).toBeGreaterThan(25)
    expect(s.strength).toBe(Math.abs(s.score))
  })

  it('returns SELL when price is below averages with weak momentum', () => {
    const s = computeSignal({
      price: 90, sma20: 100, sma50: 105, rsi: 38,
      macd: { histogram: -0.5 }, prevClose: 92, relativeVolume: 1.0,
    })
    expect(s.verdict).toBe('SELL')
    expect(s.score).toBeLessThan(-25)
  })

  it('returns HOLD on mixed signals', () => {
    const s = computeSignal({
      price: 101, sma20: 100, sma50: 105, rsi: 50,
      macd: { histogram: -0.1 }, prevClose: 101,
    })
    expect(s.verdict).toBe('HOLD')
  })

  it('flags overbought RSI in the reasons', () => {
    const s = computeSignal({ price: 100, sma20: 90, sma50: 80, rsi: 78, macd: { histogram: 0.2 }, prevClose: 99 })
    expect(s.reasons.some((r) => /overbought/i.test(r))).toBe(true)
  })

  it('amplifies the score when volume is elevated', () => {
    const base = computeSignal({ price: 110, sma20: 100, sma50: 95, rsi: 58, macd: { histogram: 0.4 }, prevClose: 108, relativeVolume: 1.0 })
    const hot = computeSignal({ price: 110, sma20: 100, sma50: 95, rsi: 58, macd: { histogram: 0.4 }, prevClose: 108, relativeVolume: 2.0 })
    expect(hot.score).toBeGreaterThan(base.score)
    expect(hot.reasons.some((r) => /volume/i.test(r))).toBe(true)
  })

  it('degrades gracefully when indicators are missing', () => {
    const s = computeSignal({ price: 100 })
    expect(['BUY', 'SELL', 'HOLD']).toContain(s.verdict)
    expect(Number.isFinite(s.score)).toBe(true)
  })
})
