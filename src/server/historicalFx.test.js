import { describe, it, expect, vi } from 'vitest'
import {
  parseObservations,
  buildRateIndex,
  resolveRateForDate,
  windowFor,
  getRatesForDates,
} from './historicalFx'

const boCResponse = (pairs) => ({
  observations: pairs.map(([d, v]) => ({ d, FXUSDCAD: { v } })),
})

describe('parseObservations', () => {
  it('turns the Bank of Canada shape into date/rate pairs', () => {
    const raw = boCResponse([['2026-03-10', '1.3567'], ['2026-03-11', '1.3587']])
    expect(parseObservations(raw)).toEqual([
      { date: '2026-03-10', rate: 1.3567 },
      { date: '2026-03-11', rate: 1.3587 },
    ])
  })

  it('skips an observation with no published value rather than inventing zero', () => {
    // The Valet API omits the value on days with no trading rather than
    // publishing a zero, and a zero rate would silently corrupt every figure
    // built on it.
    const raw = { observations: [{ d: '2026-03-10', FXUSDCAD: {} }, { d: '2026-03-11', FXUSDCAD: { v: '1.36' } }] }
    expect(parseObservations(raw)).toEqual([{ date: '2026-03-11', rate: 1.36 }])
  })

  it('returns an empty array for a malformed or empty response', () => {
    expect(parseObservations({})).toEqual([])
    expect(parseObservations(null)).toEqual([])
    expect(parseObservations({ observations: [] })).toEqual([])
  })
})

describe('buildRateIndex', () => {
  it('sorts observations by date regardless of the order fetched', () => {
    const index = buildRateIndex([{ date: '2026-03-12', rate: 1.36 }, { date: '2026-03-10', rate: 1.35 }])
    expect(index.map((o) => o.date)).toEqual(['2026-03-10', '2026-03-12'])
  })
})

describe('resolveRateForDate', () => {
  // The Bank of Canada does not publish a rate for Saturday 2026-03-14 or
  // Sunday 2026-03-15 — confirmed against the live API, not assumed.
  const index = buildRateIndex(parseObservations(boCResponse([
    ['2026-03-10', '1.3567'],
    ['2026-03-11', '1.3587'],
    ['2026-03-12', '1.3617'],
    ['2026-03-13', '1.3716'],
    ['2026-03-16', '1.3675'],
  ])))

  it('returns the rate published on the trade date itself', () => {
    expect(resolveRateForDate(index, '2026-03-12')).toEqual({ rate: 1.3617, asOf: '2026-03-12' })
  })

  it('resolves a weekend to the last published rate, recording the date actually used', () => {
    expect(resolveRateForDate(index, '2026-03-14')).toEqual({ rate: 1.3716, asOf: '2026-03-13' })
    expect(resolveRateForDate(index, '2026-03-15')).toEqual({ rate: 1.3716, asOf: '2026-03-13' })
  })

  it('never looks forward — a date needs the rate that existed on it, not one from the future', () => {
    // A holiday two days before the earliest observation in the index must not
    // resolve to that observation; it is a rate from days later, which is not
    // the rate that existed on the requested date.
    expect(resolveRateForDate(index, '2026-03-08')).toBeNull()
  })

  it('returns null rather than defaulting to 1 when nothing published covers the date', () => {
    expect(resolveRateForDate([], '2026-03-12')).toBeNull()
  })
})

describe('windowFor', () => {
  it('spans the min and max of the requested dates in one range', () => {
    // Importing 24 months of transactions must not become 500 requests — one
    // range covering everything needed is the whole point.
    expect(windowFor(['2026-03-12', '2024-01-05', '2025-11-30'])).toEqual({
      startDate: '2024-01-05',
      endDate: '2026-03-12',
    })
  })

  it('pads the start backward so a weekend or holiday at the edge still resolves', () => {
    // A trade on the earliest date in the batch, if it lands on a Monday
    // holiday, needs a rate from before the batch's own start to resolve
    // backward to.
    const { startDate } = windowFor(['2026-03-16'], { padDays: 5 })
    expect(startDate).toBe('2026-03-11')
  })

  it('returns null for no dates', () => {
    expect(windowFor([])).toBeNull()
  })
})

describe('getRatesForDates', () => {
  function fetcherReturning(pairs) {
    return vi.fn(async () => boCResponse(pairs))
  }

  it('fetches one range covering every requested date, not one call per date', async () => {
    const fetchRange = fetcherReturning([
      ['2026-03-10', '1.3567'], ['2026-03-11', '1.3587'], ['2026-03-12', '1.3617'],
      ['2026-03-13', '1.3716'], ['2026-03-16', '1.3675'],
    ])

    const result = await getRatesForDates(['2026-03-12', '2026-03-15'], { fetchRange, cache: null })

    expect(fetchRange).toHaveBeenCalledOnce()
    expect(result.get('2026-03-12')).toEqual({ rate: 1.3617, source: 'boc', asOf: '2026-03-12' })
    expect(result.get('2026-03-15')).toEqual({ rate: 1.3716, source: 'boc', asOf: '2026-03-13' })
  })

  it('maps an unresolvable date to null without failing the whole batch', async () => {
    const fetchRange = fetcherReturning([['2026-03-12', '1.3617']])
    const result = await getRatesForDates(['2026-03-01', '2026-03-12'], { fetchRange, cache: null })

    expect(result.get('2026-03-12')).toMatchObject({ rate: 1.3617 })
    expect(result.get('2026-03-01')).toBeNull()
  })

  it('reads from the cache before fetching, and never re-fetches a cached date', async () => {
    const cached = new Map([['2026-03-12', { rate: 1.3617, source: 'boc', asOf: '2026-03-12' }]])
    const cache = {
      getMany: vi.fn(async (dates) => new Map(dates.filter((d) => cached.has(d)).map((d) => [d, cached.get(d)]))),
      setMany: vi.fn(async () => {}),
    }
    const fetchRange = fetcherReturning([])

    const result = await getRatesForDates(['2026-03-12'], { fetchRange, cache })

    expect(fetchRange).not.toHaveBeenCalled()
    expect(result.get('2026-03-12')).toEqual(cached.get('2026-03-12'))
  })

  it('caches newly fetched rates, since a published rate never changes', async () => {
    const stored = new Map()
    const cache = {
      getMany: vi.fn(async () => new Map()),
      setMany: vi.fn(async (entries) => { for (const [k, v] of entries) stored.set(k, v) }),
    }
    const fetchRange = fetcherReturning([['2026-03-12', '1.3617']])

    await getRatesForDates(['2026-03-12'], { fetchRange, cache })

    expect(cache.setMany).toHaveBeenCalledOnce()
    expect(stored.get('2026-03-12')).toMatchObject({ rate: 1.3617 })
  })

  it('only fetches the range for dates the cache did not already cover', async () => {
    const cache = {
      getMany: vi.fn(async () => new Map([['2026-03-12', { rate: 1.3617, source: 'boc', asOf: '2026-03-12' }]])),
      setMany: vi.fn(async () => {}),
    }
    const fetchRange = fetcherReturning([['2026-01-05', '1.34']])

    const result = await getRatesForDates(['2026-03-12', '2026-01-05'], { fetchRange, cache })

    // Only the uncached date drives the fetch range.
    expect(fetchRange).toHaveBeenCalledWith(expect.objectContaining({ endDate: '2026-01-05' }))
    expect(result.get('2026-03-12')).toMatchObject({ rate: 1.3617 })
    expect(result.get('2026-01-05')).toMatchObject({ rate: 1.34 })
  })

  it('does nothing and fetches nothing for an empty request', async () => {
    const fetchRange = fetcherReturning([])
    const result = await getRatesForDates([], { fetchRange, cache: null })
    expect(fetchRange).not.toHaveBeenCalled()
    expect(result.size).toBe(0)
  })
})
