import { describe, expect, it } from 'vitest'
import { aggregatePositionsBySymbol, getTopPositions } from './helpers'

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
