import { describe, expect, it } from 'vitest'
import { aggregatePositionsBySymbol, sortPositionsByValue, getTopPositions } from './helpers'

const BMNR_ACCOUNT_1 = {
  'ACCOUNT NUMBER': 'ACC001',
  SYMBOL: 'BMNR',
  DESCRIPTION: 'BITMINE IMMERSION TEC-NEW',
  'MARKET VALUE': '5147.82',
  'DAY CHANGE': '-27.93',
  'UNREALIZED GAIN/LOSS': '-502.15',
}

const BMNR_ACCOUNT_2 = {
  'ACCOUNT NUMBER': 'ACC002',
  SYMBOL: 'bmnr',
  DESCRIPTION: 'BITMINE IMMERSION TEC-NEW',
  'MARKET VALUE': '1847.09',
  'DAY CHANGE': '-9.97',
  'UNREALIZED GAIN/LOSS': '-84.95',
}

const PLTR = {
  'ACCOUNT NUMBER': 'ACC001',
  SYMBOL: 'PLTR',
  DESCRIPTION: 'PALANTIR TECHS CDR C$ HDG',
  'MARKET VALUE': '13449.72',
  'DAY CHANGE': '405.22',
  'UNREALIZED GAIN/LOSS': '1203.00',
}

describe('aggregatePositionsBySymbol', () => {
  it('combines duplicate tickers across accounts', () => {
    const items = aggregatePositionsBySymbol([BMNR_ACCOUNT_1, BMNR_ACCOUNT_2, PLTR])
    const bmnr = items.find((item) => item.symbol === 'BMNR')

    expect(items).toHaveLength(2)
    expect(bmnr.value).toBeCloseTo(6994.91, 2)
    expect(bmnr.pnl).toBeCloseTo(-587.1, 2)
    expect(bmnr.dayChange).toBeCloseTo(-37.9, 2)
    expect(bmnr.dayChangePct).toBeCloseTo(-0.54, 2)
  })
})

describe('getTopPositions', () => {
  it('sorts by aggregated market value', () => {
    const items = getTopPositions([BMNR_ACCOUNT_1, BMNR_ACCOUNT_2, PLTR])

    expect(items.map((item) => item.symbol)).toEqual(['PLTR', 'BMNR'])
  })
})

describe('sortPositionsByValue', () => {
  const pos = (SYMBOL, value) => ({ SYMBOL, 'MARKET VALUE': value })

  it('puts the largest holding first', () => {
    const sorted = sortPositionsByValue([pos('A', '100'), pos('B', '5000'), pos('C', '750')])
    expect(sorted.map((r) => r.SYMBOL)).toEqual(['B', 'C', 'A'])
  })

  it('handles broker formatting — commas, dollar signs, blanks', () => {
    const sorted = sortPositionsByValue([
      pos('A', '$1,200.50'), pos('B', ''), pos('C', '9,001'),
    ])
    expect(sorted.map((r) => r.SYMBOL)).toEqual(['C', 'A', 'B'])
  })

  // Prices refresh every five minutes; an unstable comparator would reshuffle
  // equal-valued rows on each pass and move whatever the user had expanded.
  it('breaks ties on symbol so the order never reshuffles', () => {
    const once = sortPositionsByValue([pos('ZZZ', '100'), pos('AAA', '100'), pos('MMM', '100')])
    const twice = sortPositionsByValue(once)
    expect(once.map((r) => r.SYMBOL)).toEqual(['AAA', 'MMM', 'ZZZ'])
    expect(twice.map((r) => r.SYMBOL)).toEqual(once.map((r) => r.SYMBOL))
  })

  it('does not mutate the array it was given', () => {
    const input = [pos('A', '1'), pos('B', '99')]
    const copy = [...input]
    sortPositionsByValue(input)
    expect(input).toEqual(copy)
  })

  it('survives an empty list', () => {
    expect(sortPositionsByValue([])).toEqual([])
  })
})
