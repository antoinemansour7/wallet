import { describe, expect, it } from 'vitest'
import { compositionHoldings, sortComposition } from './compositionHoldings'
const row = (extra = {}) => ({ SYMBOL: 'ABC', 'ACCOUNT CURRENCY': 'CAD', 'MARKET VALUE': 120, 'BOOK VALUE': 100, QUANTITY: 2, 'DAY CHANGE': 10, ...extra })

describe('holdings overview calculations', () => {
  it('calculates returns from combined cost and previous value, not averaged percentages', () => {
    const [holding] = compositionHoldings([row({ 'ACCOUNT NUMBER': 'A' }), row({ 'ACCOUNT NUMBER': 'B', 'MARKET VALUE': 330, 'BOOK VALUE': 300, QUANTITY: 3, 'DAY CHANGE': 20 })])
    expect(holding.value).toBe(450)
    expect(holding.cost).toBe(400)
    expect(holding.pnl).toBe(50)
    expect(holding.pnlPct).toBe(12.5)
    expect(holding.dayPct).toBeCloseTo(30 / 420 * 100)
    expect(holding.averageCost).toBe(80)
    expect(holding.accounts).toEqual(['A', 'B'])
  })
  it('shows missing daily quotes and cost as unavailable instead of zero', () => {
    const [holding] = compositionHoldings([row(), row({ 'BOOK VALUE': '', 'DAY CHANGE': '' })])
    expect(holding.cost).toBeNull()
    expect(holding.pnl).toBeNull()
    expect(holding.pnlPct).toBeNull()
    expect(holding.day).toBeNull()
    expect(holding.dayPct).toBeNull()
  })
  it('keeps a reported zero gain and avoids a percentage with a zero cost basis', () => {
    const [holding] = compositionHoldings([row({ 'BOOK VALUE': 0, 'UNREALIZED GAIN/LOSS': 0, 'DAY CHANGE': 0 })])
    expect(holding.pnl).toBe(0)
    expect(holding.pnlPct).toBeNull()
    expect(holding.dayPct).toBe(0)
  })
  it('does not combine a CDR with its US underlying', () => {
    expect(compositionHoldings([row({ SYMBOL: 'AVGO', DESCRIPTION: 'BROADCOM INC' }), row({ SYMBOL: 'AVGO', DESCRIPTION: 'BROADCOM INC CDR C$HDG' })])).toHaveLength(2)
  })
  it('sorts gains in either direction with unavailable figures last', () => {
    const items = [{ id: 'A', pnl: 20 }, { id: 'B', pnl: null }, { id: 'C', pnl: -10 }]
    expect(sortComposition(items, 'pnl', 'asc').map((item) => item.id)).toEqual(['C', 'A', 'B'])
    expect(sortComposition(items, 'pnl', 'desc').map((item) => item.id)).toEqual(['A', 'C', 'B'])
  })
})
