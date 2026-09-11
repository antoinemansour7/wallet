import { describe, expect, it } from 'vitest'
import {
  hasCompleteQuoteRefresh,
  INITIAL_VALUATION_STATE,
  isPortfolioValuationReady,
  valuationReadinessReducer,
} from './portfolioValuation.js'

function transition(state, action) {
  return valuationReadinessReducer(state, { type: action.type, complete: action.complete })
}

describe('portfolio valuation readiness transitions', () => {
  it('stays unsettled across local and remote hydration until live prices complete', () => {
    let state = transition(INITIAL_VALUATION_STATE, { type: 'hydration-started' })
    state = transition(state, { type: 'portfolio-applied' }) // local
    state = transition(state, { type: 'portfolio-applied' }) // remote
    state = transition(state, { type: 'hydration-finished' })
    expect(isPortfolioValuationReady(state)).toBe(false)

    state = transition(state, { type: 'quote-refresh-started' })
    expect(isPortfolioValuationReady(state)).toBe(false) // cached quote paint
    state = transition(state, { type: 'quote-refresh-finished', complete: true })
    expect(isPortfolioValuationReady(state)).toBe(true)
  })

  it('rejects partial and missing quote coverage', () => {
    const rows = [
      { SYMBOL: 'ABC', QUANTITY: '10', 'MARKET VALUE': '1000' },
      { SYMBOL: 'MISSING', QUANTITY: '4', 'MARKET VALUE': '400' },
    ]
    expect(hasCompleteQuoteRefresh(rows, { updatedRows: 1 })).toBe(false)
    expect(hasCompleteQuoteRefresh(rows, { updatedRows: 2, missing: ['MISSING'] })).toBe(false)
    expect(hasCompleteQuoteRefresh(rows, { updatedRows: 2, quotes: [{ cacheStatus: 'stale' }] })).toBe(false)
    expect(hasCompleteQuoteRefresh(rows, { updatedRows: 2 })).toBe(true)
  })
})
