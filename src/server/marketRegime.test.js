import { describe, expect, it } from 'vitest'
import {
  indexAsOf,
  valueAsOf,
  changeOver,
  distanceFromSma,
  percentileAsOf,
  computeRegime,
  regimeLabel,
  regimeSizeMultiplier,
  REGIME_WEIGHTS,
} from './marketRegime'

/** n daily bars from 2026-01-01, weekends included — only ordering matters here. */
const bars = (closes, start = '2026-01-01') => closes.map((close, i) => {
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + i)
  return { date: d.toISOString().slice(0, 10), close }
})

describe('as-of series helpers', () => {
  const series = bars([10, 11, 12, 13, 14])

  it('finds the last bar on or before the date', () => {
    expect(indexAsOf(series, '2026-01-03')).toBe(2)
    expect(valueAsOf(series, '2026-01-03')).toBe(12)
  })

  it('carries the previous bar when the date has no print', () => {
    expect(valueAsOf(series, '2026-01-03T23:59')).toBe(12)
  })

  // The whole point of asOf: a backtest that can see tomorrow proves nothing.
  it('never sees a bar after the date', () => {
    expect(valueAsOf(series, '2026-01-02')).toBe(11)
    expect(valueAsOf(series, '2026-01-02')).not.toBe(14)
  })

  it('gives the same percentile whether or not a later spike exists', () => {
    const ramp = Array.from({ length: 24 }, (_, i) => i + 1)
    const quiet = bars(ramp)
    const spiked = bars([...ramp, 999])
    const asOf = quiet.at(-1).date
    expect(valueAsOf(spiked, asOf)).toBe(24)
    expect(percentileAsOf(spiked, asOf)).toBe(percentileAsOf(quiet, asOf))
  })

  it('returns -1 and null before the series starts', () => {
    expect(indexAsOf(series, '2025-12-31')).toBe(-1)
    expect(valueAsOf(series, '2025-12-31')).toBeNull()
    expect(changeOver(series, '2025-12-31', 2)).toBeNull()
  })

  it('defaults to the latest bar when no date is given', () => {
    expect(valueAsOf(series, null)).toBe(14)
  })

  it('measures change over a bar count', () => {
    expect(changeOver(series, '2026-01-05', 4)).toBeCloseTo(40, 5)
    expect(changeOver(series, '2026-01-02', 5)).toBeNull() // not enough history
  })

  it('measures distance from the trailing average', () => {
    // last 3 of [10,11,12] average 11; close is 12
    expect(distanceFromSma(bars([10, 11, 12]), '2026-01-03', 3)).toBeCloseTo(9.0909, 3)
    expect(distanceFromSma(bars([10, 11]), '2026-01-02', 50)).toBeNull()
  })

  it('needs a minimum window before reporting a percentile', () => {
    expect(percentileAsOf(bars([1, 2, 3]), '2026-01-03')).toBeNull()
  })

  it('tolerates an empty or missing series', () => {
    expect(indexAsOf([], '2026-01-01')).toBe(-1)
    expect(indexAsOf(undefined, '2026-01-01')).toBe(-1)
    expect(valueAsOf([], null)).toBeNull()
  })
})

describe('computeRegime', () => {
  // 300 bars so the 200-day average and the 252-day percentile both resolve.
  const flat = (v) => bars(Array.from({ length: 300 }, () => v))
  const rising = (from, to) => bars(
    Array.from({ length: 300 }, (_, i) => from + ((to - from) * i) / 299),
  )

  const baseline = () => ({
    SPY: flat(100), VIX: flat(20), TNX: flat(4), OIL: flat(80),
    IWM: flat(100), ARKK: flat(100), HYG: flat(80), RSP: flat(100),
  })

  it('scores a featureless tape near the middle', () => {
    const r = computeRegime(baseline())
    expect(r.score).toBeGreaterThan(3)
    expect(r.score).toBeLessThan(8)
    expect(r.components).toHaveLength(Object.keys(REGIME_WEIGHTS).length)
    expect(r.coverage).toBe('7/7')
  })

  it('keeps every component and the composite inside 0-10', () => {
    const violent = { ...baseline(), SPY: rising(10, 400), TNX: rising(1, 9), OIL: rising(20, 200) }
    const r = computeRegime(violent)
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(10)
    for (const c of r.components) {
      expect(c.score).toBeGreaterThanOrEqual(0)
      expect(c.score).toBeLessThanOrEqual(10)
    }
  })

  // The case that motivated the whole module: yields at the top of their range
  // must register as stress even while the index itself looks fine.
  it('marks rate stress down when yields sit at the top of their range', () => {
    const calm = computeRegime(baseline())
    const stressed = computeRegime({ ...baseline(), TNX: rising(3, 5) })
    const get = (r) => r.components.find((c) => c.key === 'rates').score
    expect(get(stressed)).toBeLessThan(get(calm))
  })

  it('reads a crude spike as a headwind', () => {
    const get = (r) => r.components.find((c) => c.key === 'commodity').score
    expect(get(computeRegime({ ...baseline(), OIL: rising(60, 90) })))
      .toBeLessThan(get(computeRegime(baseline())))
  })

  it('rewards high beta outperforming the index', () => {
    const get = (r) => r.components.find((c) => c.key === 'riskAppetite').score
    const hot = computeRegime({ ...baseline(), ARKK: rising(80, 130), IWM: rising(90, 115) })
    expect(get(hot)).toBeGreaterThan(get(computeRegime(baseline())))
  })

  // A dead feed should pull toward neutral, not toward zero — otherwise one
  // failed fetch reads as "stand down" and suppresses a perfectly good tape.
  it('renormalises over the components it actually has', () => {
    const partial = { ...baseline(), OIL: [], HYG: [], RSP: [] }
    const r = computeRegime(partial)
    expect(r.coverage).toBe('4/7')
    expect(r.score).toBeGreaterThan(3)
    expect(r.components.every((c) => c.key !== 'commodity')).toBe(true)
  })

  it('returns null when nothing at all resolved', () => {
    expect(computeRegime({ SPY: [], VIX: [], TNX: [] })).toBeNull()
  })

  it('names the weakest and strongest component', () => {
    const r = computeRegime({ ...baseline(), TNX: rising(3, 5) })
    expect(r.drag.label).toBeTruthy()
    expect(r.support.label).toBeTruthy()
    const scores = r.components.map((c) => c.score)
    expect(r.components.find((c) => c.label === r.drag.label).score).toBe(Math.min(...scores))
  })

  it('replays a past date without seeing later bars', () => {
    const series = { ...baseline(), TNX: rising(3, 5) }
    const early = computeRegime(series, series.TNX[250].date)
    const late = computeRegime(series, series.TNX[299].date)
    expect(early.asOf).toBe(series.TNX[250].date)
    // yields are still climbing, so the later date must be the more stressed one
    const rates = (r) => r.components.find((c) => c.key === 'rates').score
    expect(rates(early)).toBeGreaterThanOrEqual(rates(late))
  })
})

describe('labels and sizing', () => {
  it('labels each band', () => {
    expect(regimeLabel(8)).toBe('constructive')
    expect(regimeLabel(5.5)).toBe('mixed')
    expect(regimeLabel(3.2)).toBe('defensive')
    expect(regimeLabel(1)).toBe('stand down')
  })

  it('never suggests upsizing above a full position', () => {
    for (const s of [0, 2, 4, 6, 8, 10]) {
      expect(regimeSizeMultiplier(s)).toBeGreaterThan(0)
      expect(regimeSizeMultiplier(s)).toBeLessThanOrEqual(1)
    }
  })

  it('is monotonic — a worse tape never suggests a bigger position', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(regimeSizeMultiplier)
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1])
  })

  it('falls back to a full position when there is no score', () => {
    expect(regimeSizeMultiplier(null)).toBe(1)
  })
})
