// ─── Portfolio Tools ───────────────────────────────────────────────────────────
// Functions that let any agent reason about the user's portfolio.
// Used by: Slack Agent, Position Sizing Agent, and any future MCP server.
// ────────────────────────────────────────────────────────────────────────────────

// Sector classification map for common stocks
const SECTOR_MAP = {
  // Tech / Software
  AAPL: 'Technology', MSFT: 'Technology', GOOGL: 'Technology', GOOG: 'Technology',
  META: 'Technology', AMZN: 'Technology', CRM: 'Technology', ORCL: 'Technology',
  ADBE: 'Technology', NOW: 'Technology', SHOP: 'Technology', SNOW: 'Technology',
  PLTR: 'Technology', NET: 'Technology', DDOG: 'Technology', MDB: 'Technology',
  // Semiconductors
  NVDA: 'Semiconductors', AMD: 'Semiconductors', INTC: 'Semiconductors',
  MU: 'Semiconductors', AVGO: 'Semiconductors', QCOM: 'Semiconductors',
  TSM: 'Semiconductors', MRVL: 'Semiconductors', AMAT: 'Semiconductors',
  KLAC: 'Semiconductors', LRCX: 'Semiconductors', ASML: 'Semiconductors',
  // Aerospace / Defense
  RKLB: 'Aerospace', LUNR: 'Aerospace', BA: 'Aerospace', LMT: 'Aerospace',
  RTX: 'Aerospace', NOC: 'Aerospace', GD: 'Aerospace', ASTS: 'Aerospace',
  // Biotech / Healthcare
  MRNA: 'Biotech', PFE: 'Healthcare', JNJ: 'Healthcare', UNH: 'Healthcare',
  LLY: 'Healthcare', ABBV: 'Healthcare', AMGN: 'Biotech', GILD: 'Biotech',
  // Finance
  JPM: 'Finance', GS: 'Finance', BAC: 'Finance', V: 'Finance',
  MA: 'Finance', SQ: 'Finance', SOFI: 'Finance', HOOD: 'Finance',
  // Energy
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', SLB: 'Energy',
  // Consumer
  TSLA: 'Consumer', NKE: 'Consumer', SBUX: 'Consumer', DIS: 'Consumer',
  NFLX: 'Consumer', COST: 'Consumer', WMT: 'Consumer',
  // Crypto
  COIN: 'Crypto', MARA: 'Crypto', MSTR: 'Crypto', RIOT: 'Crypto',
}

function classifySector(symbol, description = '') {
  if (SECTOR_MAP[symbol]) return SECTOR_MAP[symbol]
  const desc = description.toLowerCase()
  if (desc.includes('semiconductor') || desc.includes('chip')) return 'Semiconductors'
  if (desc.includes('software') || desc.includes('cloud') || desc.includes('tech')) return 'Technology'
  if (desc.includes('biotech') || desc.includes('pharma')) return 'Biotech'
  if (desc.includes('energy') || desc.includes('oil')) return 'Energy'
  if (desc.includes('financial') || desc.includes('bank')) return 'Finance'
  if (desc.includes('etf') || desc.includes('index') || desc.includes('fund')) return 'ETF/Fund'
  return 'Other'
}

/**
 * Get user holdings from portfolio rows.
 * Returns sorted array of positions with market value and weight.
 */
export function getUserHoldings(portfolioRows) {
  if (!portfolioRows || !Array.isArray(portfolioRows)) return { holdings: [], totalValue: 0 }

  const holdings = portfolioRows
    .filter((row) => {
      const qty = parseFloat(row.QUANTITY || row.quantity || 0)
      return qty > 0
    })
    .map((row) => {
      const symbol = (row.SYMBOL || row.symbol || '').trim().toUpperCase()
      const quantity = parseFloat(row.QUANTITY || row.quantity || 0)
      const marketValue = parseFloat(row['MARKET VALUE'] || row.marketValue || 0)
      const bookValue = parseFloat(row['BOOK VALUE'] || row.bookValue || 0)
      const description = (row.DESCRIPTION || row.description || '').trim()
      const avgCost = parseFloat(row['AVERAGE UNIT COST'] || row.averageUnitCost || 0)
      const marketPrice = parseFloat(row['MARKET PRICE'] || row.marketPrice || 0)
      const gainLoss = marketValue - bookValue
      const gainLossPct = bookValue > 0 ? ((marketValue - bookValue) / bookValue) * 100 : 0
      const sector = classifySector(symbol, description)

      return { symbol, quantity, marketValue, bookValue, description, avgCost, marketPrice, gainLoss, gainLossPct, sector }
    })
    .filter((h) => h.symbol && h.marketValue > 0)
    .sort((a, b) => b.marketValue - a.marketValue)

  const totalValue = holdings.reduce((sum, h) => sum + h.marketValue, 0)
  return {
    holdings: holdings.map((h) => ({
      ...h,
      weight: totalValue > 0 ? Number(((h.marketValue / totalValue) * 100).toFixed(2)) : 0,
    })),
    totalValue,
  }
}

/**
 * Get sector exposure breakdown.
 * Returns sectors sorted by total exposure.
 */
export function getSectorExposure(portfolioRows) {
  const { holdings, totalValue } = getUserHoldings(portfolioRows)
  if (holdings.length === 0) return { sectors: [], totalValue: 0 }

  const sectorMap = new Map()
  for (const h of holdings) {
    const existing = sectorMap.get(h.sector) || { sector: h.sector, totalValue: 0, positions: [], count: 0 }
    existing.totalValue += h.marketValue
    existing.count += 1
    existing.positions.push({ symbol: h.symbol, marketValue: h.marketValue, weight: h.weight })
    sectorMap.set(h.sector, existing)
  }

  const sectors = [...sectorMap.values()]
    .map((s) => ({
      ...s,
      weight: totalValue > 0 ? Number(((s.totalValue / totalValue) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.totalValue - a.totalValue)

  return { sectors, totalValue }
}

/**
 * Check overlap between portfolio holdings and a set of tickers.
 * Returns which tickers the user already holds and at what weight.
 */
export function checkOverlap(portfolioRows, tickers) {
  const { holdings, totalValue } = getUserHoldings(portfolioRows)
  const holdingMap = new Map(holdings.map((h) => [h.symbol, h]))

  return tickers.map((ticker) => {
    const held = holdingMap.get(ticker.toUpperCase())
    return {
      ticker: ticker.toUpperCase(),
      alreadyHeld: Boolean(held),
      currentWeight: held?.weight || 0,
      currentValue: held?.marketValue || 0,
      sector: held?.sector || classifySector(ticker.toUpperCase()),
    }
  })
}

/**
 * Get concentration risk metrics.
 */
export function getConcentrationRisk(portfolioRows) {
  const { holdings, totalValue } = getUserHoldings(portfolioRows)
  const { sectors } = getSectorExposure(portfolioRows)

  const top5Weight = holdings.slice(0, 5).reduce((s, h) => s + h.weight, 0)
  const largestPosition = holdings[0] || null
  const largestSector = sectors[0] || null

  const risks = []
  if (top5Weight > 60) risks.push(`Top 5 positions = ${top5Weight.toFixed(1)}% (>60% concentrated)`)
  if (largestPosition && largestPosition.weight > 20) risks.push(`${largestPosition.symbol} is ${largestPosition.weight}% of portfolio (>20%)`)
  if (largestSector && largestSector.weight > 50) risks.push(`${largestSector.sector} sector is ${largestSector.weight}% (>50%)`)

  return {
    totalValue,
    positionCount: holdings.length,
    top5Weight: Number(top5Weight.toFixed(1)),
    largestPosition: largestPosition ? { symbol: largestPosition.symbol, weight: largestPosition.weight } : null,
    largestSector: largestSector ? { sector: largestSector.sector, weight: largestSector.weight } : null,
    risks,
    diversified: risks.length === 0,
  }
}
