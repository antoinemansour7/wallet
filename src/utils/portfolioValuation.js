import { parseNum } from './portfolioStats.js'

export const INITIAL_VALUATION_STATE = Object.freeze({
  portfolioSettled: false,
  priceCoverage: 'settling',
})

export function valuationReadinessReducer(state, action) {
  switch (action.type) {
    case 'hydration-started':
      return INITIAL_VALUATION_STATE
    case 'portfolio-applied':
    case 'quote-refresh-started':
      return { ...state, priceCoverage: 'settling' }
    case 'hydration-finished':
      return { ...state, portfolioSettled: true }
    case 'quote-refresh-finished':
      return { ...state, priceCoverage: action.complete ? 'complete' : 'partial' }
    default:
      return state
  }
}

export function isPortfolioValuationReady(state) {
  return state.portfolioSettled && state.priceCoverage === 'complete'
}

/**
 * A total is current only when every value-bearing holding took a usable quote
 * in this refresh. Rows with no symbol, quantity, or safe quote remain useful
 * as saved holdings, but they cannot anchor a live chart or history snapshot.
 */
export function hasCompleteQuoteRefresh(rows = [], result = {}) {
  const holdings = rows.filter((row) => (
    parseNum(row?.QUANTITY) > 0 || parseNum(row?.['MARKET VALUE']) !== 0
  ))
  if (holdings.length === 0) return true
  if (result.updatedRows !== holdings.length || result.missing?.length) return false
  return !(result.quotes || []).some((quote) => quote?.cacheStatus === 'stale')
}
