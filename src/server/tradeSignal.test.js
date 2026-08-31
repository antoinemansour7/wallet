import { describe, expect, it } from 'vitest'
import { computeSignal, participationFactor } from './tradeSignal'

// The chart that prompted the rewrite: below both averages with MACD fading,
// but RSI drifting toward oversold and only 0.72x normal volume behind it.
const RKLB = {
  price: 63.84, sma20: 65.5, sma50: 68, rsi: 34.6,
  macd: { histogram: -1.0279 }, prevClose: 64.39, relativeVolume: 0.72,
}

describe('direction', () => {
  it('calls a clean uptrend a BUY', () => {
    const s = computeSignal({
      price: 110, sma20: 100, sma50: 95, rsi: 58,
      macd: { histogram: 0.4 }, prevClose: 108, relativeVolume: 1.2,
    })
    expect(s.verdict).toBe('BUY')
    expect(s.score).toBeGreaterThan(15)
  })

  it('calls a decisive downtrend a SELL and means it', () => {
    const s = computeSignal({
      price: 88, sma20: 100, sma50: 106, rsi: 61,
      macd: { histogram: -1.2 }, prevClose: 92, relativeVolume: 2.1,
    })
    expect(s.verdict).toBe('SELL')
    expect(s.confidence).toBeGreaterThan(85)
    expect(s.conflicts).toHaveLength(0)
  })

  it('holds when nothing is leaning', () => {
    const s = computeSignal({
      price: 101, sma20: 100, sma50: 101, rsi: 50,
      macd: { histogram: -0.01 }, prevClose: 101, relativeVolume: 1,
    })
    expect(s.verdict).toBe('HOLD')
  })

  it('keeps score, strength and direction consistent', () => {
    const s = computeSignal(RKLB)
    expect(s.strength).toBe(Math.abs(s.score))
    expect(s.score).toBe(Math.round(s.direction * 100))
  })
})

// The bug that made the old engine untrustworthy: RSI 29.9 scored -36 and RSI
// 30.1 scored -73, because the buckets were step functions.
describe('no cliffs', () => {
  it('moves smoothly across the old oversold boundary', () => {
    const below = computeSignal({ ...RKLB, rsi: 29.9 })
    const above = computeSignal({ ...RKLB, rsi: 30.1 })
    expect(Math.abs(above.score - below.score)).toBeLessThanOrEqual(2)
  })

  it('moves smoothly across the midline', () => {
    const under = computeSignal({ ...RKLB, rsi: 49.9 })
    const over = computeSignal({ ...RKLB, rsi: 50.1 })
    expect(Math.abs(over.score - under.score)).toBeLessThanOrEqual(2)
  })

  it('stays monotonic in RSI — a weaker RSI never reads as more bullish', () => {
    const scores = [20, 30, 40, 50, 60, 70, 80].map((rsi) => computeSignal({ ...RKLB, rsi }).score)
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1])
    }
  })
})

describe('volume decides how much any of it is worth', () => {
  it('damps below average as well as amplifying above it', () => {
    const thin = computeSignal({ ...RKLB, relativeVolume: 0.3 })
    const normal = computeSignal({ ...RKLB, relativeVolume: 1.0 })
    const heavy = computeSignal({ ...RKLB, relativeVolume: 2.0 })
    expect(thin.confidence).toBeLessThan(normal.confidence)
    expect(heavy.confidence).toBeGreaterThan(normal.confidence)
  })

  it('does not change which way the chart leans', () => {
    const thin = computeSignal({ ...RKLB, relativeVolume: 0.3 })
    const heavy = computeSignal({ ...RKLB, relativeVolume: 2.0 })
    expect(thin.score).toBe(heavy.score)
  })

  it('withholds a verdict when almost nobody is trading it', () => {
    expect(computeSignal({ ...RKLB, relativeVolume: 0.25 }).verdict).toBe('HOLD')
  })

  it('is bounded and neutral when volume is unknown', () => {
    expect(participationFactor(undefined)).toBe(1)
    expect(participationFactor(0)).toBe(1)
    expect(participationFactor(99)).toBeLessThanOrEqual(1.1)
    expect(participationFactor(0.01)).toBeGreaterThanOrEqual(0.45)
  })
})

describe('confidence and conflict', () => {
  // The whole point: this chart leans down, but not everything agrees, and
  // hardly anyone is trading it. It used to report 73/100.
  it('reports the RKLB chart as a low-confidence lean, not a loud call', () => {
    const s = computeSignal(RKLB)
    expect(s.verdict).toBe('SELL')
    expect(s.confidence).toBeLessThan(60)
    expect(s.agreement).toBeLessThan(0.8)
  })

  it('names the indicator arguing the other way', () => {
    const s = computeSignal(RKLB)
    expect(s.conflicts.join(' ')).toMatch(/RSI/i)
    expect(s.conflicts.join(' ')).toMatch(/oversold/i)
  })

  it('reaches full confidence only when everything agrees', () => {
    const aligned = computeSignal({
      price: 120, sma20: 105, sma50: 98, rsi: 42,
      macd: { histogram: 1.4 }, prevClose: 116, relativeVolume: 2.5,
    })
    expect(aligned.agreement).toBeGreaterThan(0.95)
    expect(aligned.conflicts).toHaveLength(0)
  })

  it('correlated trend readings count once, not three times', () => {
    // Trend, and only trend, is bearish. That must not on its own produce the
    // kind of score the old engine reached by counting it from three angles.
    const s = computeSignal({
      price: 90, sma20: 100, sma50: 106, rsi: 50,
      macd: { histogram: 0 }, prevClose: 90, relativeVolume: 1,
    })
    expect(Math.abs(s.score)).toBeLessThan(45)
  })
})

describe('missing data', () => {
  it('renormalises over the indicators it has', () => {
    // Trend alone: no MACD, no RSI, no prior close.
    const trendOnly = computeSignal({ price: 100, sma20: 90, sma50: 85, relativeVolume: 1 })
    expect(trendOnly.coverage).toBe('1/4')
    expect(Number.isFinite(trendOnly.score)).toBe(true)
    expect(trendOnly.verdict).toBe('BUY')

    const withDay = computeSignal({ price: 100, sma20: 90, sma50: 85, prevClose: 97, relativeVolume: 1 })
    expect(withDay.coverage).toBe('2/4')
  })

  it('returns a neutral shape when there is nothing to read', () => {
    const s = computeSignal({})
    expect(s.verdict).toBe('HOLD')
    expect(s.score).toBe(0)
    expect(s.components).toHaveLength(0)
    expect(s.coverage).toBe('0/4')
  })

  it('never returns a score outside -100..100', () => {
    const extreme = computeSignal({
      price: 1, sma20: 900, sma50: 5000, rsi: 99,
      macd: { histogram: -50 }, prevClose: 800, relativeVolume: 40,
    })
    expect(extreme.score).toBeGreaterThanOrEqual(-100)
    expect(extreme.score).toBeLessThanOrEqual(100)
    expect(extreme.confidence).toBeLessThanOrEqual(100)
  })
})

// "Overbought" and "oversold" are 70/30 terms. Describing from the normalised
// value called RSI 61 overbought, which is simply wrong.
describe('RSI wording', () => {
  const at = (rsi) => computeSignal({
    price: 100, sma20: 100, sma50: 100, rsi, macd: { histogram: 0 }, prevClose: 100,
  }).components.find((c) => c.key === 'meanReversion').detail

  it('reserves oversold and overbought for the real thresholds', () => {
    expect(at(28)).toMatch(/oversold$/)
    expect(at(74)).toMatch(/overbought$/)
    expect(at(61)).not.toMatch(/— overbought$/)
    expect(at(34.6)).not.toMatch(/— oversold$/)
  })

  it('says which side of the midline everything else is on', () => {
    expect(at(34.6)).toMatch(/nearing oversold/)
    expect(at(61)).toMatch(/nearing overbought/)
    expect(at(50)).toMatch(/neutral/)
  })
})
