// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  OPTIONS_CALENDAR_2026,
  OPTIONS_ELIGIBILITY_2026_09_22,
  eligibilityFor,
  marketDay,
  optionMarketState,
  regularSessionClose,
  zonedMarketInstant,
} from './calendar.js'

describe('versioned US equity-options calendar', () => {
  it('converts New York market times correctly on both sides of DST changes', () => {
    expect(zonedMarketInstant('2026-03-06', '09:30')).toBe('2026-03-06T14:30:00.000Z')
    expect(zonedMarketInstant('2026-03-09', '09:30')).toBe('2026-03-09T13:30:00.000Z')
    expect(zonedMarketInstant('2026-10-30', '09:30')).toBe('2026-10-30T13:30:00.000Z')
    expect(zonedMarketInstant('2026-11-02', '09:30')).toBe('2026-11-02T14:30:00.000Z')
  })

  it('distinguishes holidays, early closes, weekends and out-of-range dates', () => {
    expect(marketDay('2026-09-07')).toMatchObject({ open: false, reason: 'holiday', name: 'Labor Day' })
    expect(marketDay('2026-11-27')).toMatchObject({ open: true, earlyClose: true, closeTime: '13:00' })
    expect(regularSessionClose('2026-11-27')).toBe('2026-11-27T18:00:00.000Z')
    expect(marketDay('2026-09-26')).toMatchObject({ open: false, reason: 'weekend' })
    expect(marketDay('2027-01-04')).toMatchObject({ known: false, reason: 'calendar_out_of_range' })
  })

  it('keeps observed ineligibility separate from planned candidate status', () => {
    const entries = Object.values(OPTIONS_ELIGIBILITY_2026_09_22.entries)
    expect(entries).toHaveLength(25)
    expect(entries.every((item) => !item.gthEligible && !item.curbEligible)).toBe(true)
    expect(entries.filter((item) => item.announcedCandidate).map((item) => item.symbol).sort()).toEqual([
      'AMD', 'AMZN', 'AVGO', 'HOOD', 'INTC', 'MU', 'NVDA', 'ORCL', 'PLTR',
    ])
    expect(eligibilityFor('NVDA', { asOf: '2026-10-18T23:00:00Z' })).toMatchObject({ gthEligible: false, announcedCandidate: true, refreshRequired: false })
    expect(eligibilityFor('NVDA', { asOf: '2026-10-19T12:00:00Z' })).toMatchObject({ gthEligible: false, announcedCandidate: true, refreshRequired: true })
  })

  it('models GTH, the transition gap, RTH, curb and per-series state separately', () => {
    expect(optionMarketState('2026-09-22T12:00:00Z', { symbol: 'NVDA' })).toMatchObject({ session: 'gth', classAllowed: false, executable: false, reason: 'class_not_gth_eligible' })
    expect(optionMarketState('2026-09-22T13:27:00Z', { symbol: 'NVDA' })).toMatchObject({ session: 'transition', executable: false, reason: 'gth_rth_transition_gap' })
    expect(optionMarketState('2026-09-22T13:31:00Z', { symbol: 'NVDA' })).toMatchObject({ session: 'rth', classAllowed: true, seriesAllowed: true, executable: true })
    expect(optionMarketState('2026-09-22T13:31:00Z', { symbol: 'NVDA', seriesState: 'not_open' })).toMatchObject({ session: 'rth', classAllowed: true, seriesAllowed: false, executable: false, reason: 'series_not_open' })
    expect(optionMarketState('2026-09-22T13:31:00Z', { symbol: 'NVDA', seriesState: 'halted' })).toMatchObject({ executable: false, reason: 'series_halted' })
    expect(optionMarketState('2026-09-22T20:05:00Z', { symbol: 'NVDA' })).toMatchObject({ session: 'curb', classAllowed: false, executable: false, reason: 'class_not_curb_eligible' })
  })

  it('can consume a later confirmed eligibility snapshot without changing the calendar', () => {
    const confirmed = { ...eligibilityFor('NVDA'), gthEligible: true, curbEligible: true, refreshRequired: false, snapshotVersion: 'confirmed-fixture' }
    expect(optionMarketState('2026-09-22T12:00:00Z', { symbol: 'NVDA', eligibility: confirmed, calendar: OPTIONS_CALENDAR_2026 })).toMatchObject({ session: 'gth', executable: true })
    expect(optionMarketState('2026-09-22T20:05:00Z', { symbol: 'NVDA', eligibility: confirmed })).toMatchObject({ session: 'curb', executable: true })
  })
})
