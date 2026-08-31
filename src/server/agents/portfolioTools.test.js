import { describe, expect, it } from 'vitest'
import { getPortfolioAnalytics, getSectorExposure } from './portfolioTools'

function row(symbol, marketValue, bookValue, description = '') {
  return {
    SYMBOL: symbol,
    DESCRIPTION: description,
    QUANTITY: '10',
    'MARKET VALUE': String(marketValue),
    'BOOK VALUE': String(bookValue),
  }
}

describe('getSectorExposure (CDR + expanded map)', () => {
  it('classifies Canadian CDR tickers that differ from the US underlying', () => {
    const { sectors } = getSectorExposure([
      row('ORAC', 1000, 1000, 'ORACLE CORP CDR C$ HDG'),   // → Technology
      row('NOWS', 1000, 1000, 'SERVICENOW INC CDR C$HDG'), // → Technology
      row('BMNR', 1000, 1000, 'BITMINE IMMERSION TEC-NEW'),// → Crypto
      row('IREN', 1000, 1000, 'IREN LTD'),                 // → Crypto
    ])
    const map = Object.fromEntries(sectors.map((s) => [s.sector, s.weight]))
    expect(map.Technology).toBe(50)
    expect(map.Crypto).toBe(50)
    expect(map.Other).toBeUndefined()
  })

  it('strips exchange suffixes before lookup', () => {
    const { sectors } = getSectorExposure([row('AVGO.NE', 1000, 1000, 'BROADCOM CDR')])
    expect(sectors[0].sector).toBe('Semiconductors')
  })

  it('falls back to description keywords for unknown tickers', () => {
    const { sectors } = getSectorExposure([row('ZZZZ', 1000, 1000, 'Acme Biotech Therapeutics')])
    expect(sectors[0].sector).toBe('Biotech')
  })
})

describe('getPortfolioAnalytics', () => {
  it('flags a single dominant position and grades it down', () => {
    const a = getPortfolioAnalytics([
      row('MSTR', 8000, 10000, 'STRATEGY INC'),
      row('AAPL', 1000, 900),
      row('NVDA', 1000, 800),
    ])
    expect(a.largestPosition.symbol).toBe('MSTR')
    expect(a.largestPosition.weight).toBe(80)
    expect(a.flags.some((f) => f.severity === 'high')).toBe(true)
    expect(['D', 'F', 'C−']).toContain(a.grade)
    expect(a.effectivePositions).toBeLessThan(2)
  })

  it('grades a broad, balanced book highly', () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(`SYM${i}`, 1000, 900, 'software cloud'))
    const a = getPortfolioAnalytics(rows)
    expect(a.score).toBeGreaterThanOrEqual(70)
    expect(['A', 'A−', 'B+', 'B']).toContain(a.grade)
    expect(a.effectivePositions).toBeGreaterThan(10)
  })

  it('computes P&L stats: winners, losers, win rate, best/worst', () => {
    const a = getPortfolioAnalytics([
      row('WIN', 1500, 1000),   // +50%
      row('FLAT', 1000, 1000),  // 0% (not a winner)
      row('LOSE', 500, 1000),   // -50%
    ])
    expect(a.totalPnl).toBe(0)        // +500 -500
    expect(a.winnersCount).toBe(1)
    expect(a.losersCount).toBe(1)
    expect(a.bestPerformer.symbol).toBe('WIN')
    expect(a.worstPerformer.symbol).toBe('LOSE')
  })

  it('returns empty flag for no holdings', () => {
    expect(getPortfolioAnalytics([]).empty).toBe(true)
  })
})
