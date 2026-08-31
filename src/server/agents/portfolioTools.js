// ─── Portfolio Tools ───────────────────────────────────────────────────────────
// Functions that let any agent reason about the user's portfolio.
// Used by: Slack Agent, Position Sizing Agent, and any future MCP server.
// ────────────────────────────────────────────────────────────────────────────────

// Sector classification map for common stocks (incl. Canadian CDR tickers,
// which often differ from the US underlying — e.g. ORAC=Oracle, NOWS=ServiceNow)
const SECTOR_MAP = {
  // Tech / Software
  AAPL: 'Technology', MSFT: 'Technology', GOOGL: 'Technology', GOOG: 'Technology',
  META: 'Technology', AMZN: 'Technology', CRM: 'Technology', ORCL: 'Technology',
  ORAC: 'Technology', ADBE: 'Technology', NOW: 'Technology', NOWS: 'Technology',
  SHOP: 'Technology', SNOW: 'Technology', PLTR: 'Technology', NET: 'Technology',
  DDOG: 'Technology', MDB: 'Technology', CRWD: 'Technology', PANW: 'Technology',
  ZS: 'Technology', SNPS: 'Technology', CDNS: 'Technology', INTU: 'Technology',
  IBM: 'Technology', CSCO: 'Technology', UBER: 'Technology', ABNB: 'Technology',
  HLIT: 'Technology', SMCI: 'Technology', DELL: 'Technology', HPQ: 'Technology',
  APP: 'Technology', RDDT: 'Technology', SNAP: 'Technology', SPOT: 'Technology',
  // Semiconductors
  NVDA: 'Semiconductors', AMD: 'Semiconductors', INTC: 'Semiconductors',
  MU: 'Semiconductors', AVGO: 'Semiconductors', QCOM: 'Semiconductors',
  TSM: 'Semiconductors', MRVL: 'Semiconductors', AMAT: 'Semiconductors',
  KLAC: 'Semiconductors', LRCX: 'Semiconductors', ASML: 'Semiconductors',
  ARM: 'Semiconductors', TXN: 'Semiconductors', ADI: 'Semiconductors',
  // Aerospace / Defense
  RKLB: 'Aerospace', LUNR: 'Aerospace', BA: 'Aerospace', LMT: 'Aerospace',
  RTX: 'Aerospace', NOC: 'Aerospace', GD: 'Aerospace', ASTS: 'Aerospace',
  ACHR: 'Aerospace', JOBY: 'Aerospace', AVAV: 'Aerospace', KTOS: 'Aerospace',
  // Biotech / Healthcare
  MRNA: 'Biotech', PFE: 'Healthcare', JNJ: 'Healthcare', UNH: 'Healthcare',
  LLY: 'Healthcare', ABBV: 'Healthcare', AMGN: 'Biotech', GILD: 'Biotech',
  HIMS: 'Healthcare', VRTX: 'Biotech', REGN: 'Biotech', ISRG: 'Healthcare',
  TEM: 'Healthcare', RXRX: 'Biotech', CRSP: 'Biotech',
  // Finance
  JPM: 'Finance', GS: 'Finance', BAC: 'Finance', V: 'Finance',
  MA: 'Finance', SQ: 'Finance', SOFI: 'Finance', HOOD: 'Finance',
  PYPL: 'Finance', AXP: 'Finance', WFC: 'Finance', MS: 'Finance',
  BRK: 'Finance', SCHW: 'Finance', AFRM: 'Finance',
  // Energy
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', SLB: 'Energy',
  OXY: 'Energy', ENPH: 'Energy', FSLR: 'Energy', NEE: 'Energy',
  // Consumer
  TSLA: 'Consumer', NKE: 'Consumer', SBUX: 'Consumer', DIS: 'Consumer',
  NFLX: 'Consumer', COST: 'Consumer', WMT: 'Consumer', MCD: 'Consumer',
  LULU: 'Consumer', CMG: 'Consumer', HD: 'Consumer', TGT: 'Consumer',
  // Crypto / Bitcoin proxies
  COIN: 'Crypto', MARA: 'Crypto', MSTR: 'Crypto', RIOT: 'Crypto',
  BMNR: 'Crypto', IREN: 'Crypto', CLSK: 'Crypto', HUT: 'Crypto',
  CIFR: 'Crypto', WULF: 'Crypto', BITF: 'Crypto', HIVE: 'Crypto',
  // Industrials / Other
  CAT: 'Industrials', DE: 'Industrials', GE: 'Industrials', HON: 'Industrials',
}

// CDR tickers that don't appear above but whose description names the company.
const SECTOR_KEYWORDS = [
  [/semiconductor|chip|foundry|wafer/i, 'Semiconductors'],
  [/software|cloud|saas|data|cyber|internet|platform|digital/i, 'Technology'],
  [/biotech|therapeutic|pharma|genomic|clinical/i, 'Biotech'],
  [/health|medical|hospital|care|telehealth/i, 'Healthcare'],
  [/bitcoin|crypto|blockchain|mining|miner|digital asset/i, 'Crypto'],
  [/aerospace|defense|space|satellite|rocket|missile|drone/i, 'Aerospace'],
  [/energy|oil|gas|solar|petroleum|renewable/i, 'Energy'],
  [/bank|financ|capital|insurance|payment|fintech/i, 'Finance'],
  [/etf|index|fund|trust|holdings? etf/i, 'ETF/Fund'],
  [/retail|consumer|restaurant|apparel|beverage/i, 'Consumer'],
]

function classifySector(symbol, description = '') {
  // Strip exchange suffix (e.g. AVGO.NE → AVGO) so CDRs resolve
  const base = String(symbol || '').toUpperCase().replace(/\.(NE|TO|V|CN)$/, '')
  if (SECTOR_MAP[base]) return SECTOR_MAP[base]
  for (const [pattern, sector] of SECTOR_KEYWORDS) {
    if (pattern.test(description)) return sector
  }
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function gradeFromScore(score) {
  if (score >= 90) return 'A'
  if (score >= 80) return 'A−'
  if (score >= 72) return 'B+'
  if (score >= 64) return 'B'
  if (score >= 56) return 'B−'
  if (score >= 48) return 'C+'
  if (score >= 40) return 'C'
  if (score >= 32) return 'C−'
  if (score >= 24) return 'D'
  return 'F'
}

/**
 * Full quantitative portfolio analysis: concentration (HHI / effective
 * positions), a deterministic diversification score + grade, P&L statistics,
 * and severity-tagged risk flags. Computed in code so the grade is consistent
 * and not subject to LLM variance — the LLM only narrates and recommends.
 */
export function getPortfolioAnalytics(portfolioRows) {
  const { holdings, totalValue } = getUserHoldings(portfolioRows)
  if (holdings.length === 0) {
    return { empty: true, positionCount: 0, totalValue: 0 }
  }

  const { sectors } = getSectorExposure(portfolioRows)

  // ── Concentration: Herfindahl-Hirschman Index on position weights ──
  const fractions = holdings.map((h) => h.weight / 100)
  const stockHHI = fractions.reduce((sum, f) => sum + f * f, 0)
  const effectivePositions = stockHHI > 0 ? 1 / stockHHI : 0

  const sectorFractions = sectors.map((s) => s.weight / 100)
  const sectorHHI = sectorFractions.reduce((sum, f) => sum + f * f, 0)
  const effectiveSectors = sectorHHI > 0 ? 1 / sectorHHI : 0

  const largest = holdings[0]
  const top5Weight = holdings.slice(0, 5).reduce((s, h) => s + h.weight, 0)
  const largestSector = sectors[0]

  // ── Diversification score (0-100): breadth 50%, position 25%, sector 25% ──
  const breadthScore = clamp((effectivePositions / 12) * 100, 0, 100)
  const positionScore = largest.weight <= 8 ? 100
    : largest.weight >= 30 ? 0
    : (100 * (30 - largest.weight)) / (30 - 8)
  const sectorScore = !largestSector || largestSector.weight <= 25 ? 100
    : largestSector.weight >= 60 ? 0
    : (100 * (60 - largestSector.weight)) / (60 - 25)

  const score = Math.round(0.5 * breadthScore + 0.25 * positionScore + 0.25 * sectorScore)
  const grade = gradeFromScore(score)

  // ── P&L analytics ──
  const totalCost = holdings.reduce((s, h) => s + h.bookValue, 0)
  const totalPnl = holdings.reduce((s, h) => s + h.gainLoss, 0)
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0
  const winners = holdings.filter((h) => h.gainLossPct > 0)
  const losers = holdings.filter((h) => h.gainLossPct < 0)
  const ranked = [...holdings].sort((a, b) => b.gainLossPct - a.gainLossPct)
  const bestPerformer = ranked[0]
  const worstPerformer = ranked[ranked.length - 1]

  // ── Severity-tagged flags ──
  const flags = []
  if (largest.weight > 25) flags.push({ severity: 'high', text: `${largest.symbol} is ${largest.weight}% of the portfolio — a single-name blowup would be severe.` })
  else if (largest.weight > 15) flags.push({ severity: 'medium', text: `${largest.symbol} is ${largest.weight}% — above a comfortable single-position ceiling.` })
  if (top5Weight > 65) flags.push({ severity: 'high', text: `Top 5 holdings are ${top5Weight.toFixed(0)}% of the book — very top-heavy.` })
  else if (top5Weight > 50) flags.push({ severity: 'medium', text: `Top 5 holdings are ${top5Weight.toFixed(0)}% — moderately concentrated.` })
  if (largestSector && largestSector.weight > 50) flags.push({ severity: 'high', text: `${largestSector.sector} is ${largestSector.weight}% of exposure — you're effectively a sector bet.` })
  else if (largestSector && largestSector.weight > 35) flags.push({ severity: 'medium', text: `${largestSector.sector} is ${largestSector.weight}% — overweight versus a balanced book.` })
  if (effectivePositions < 4) flags.push({ severity: 'high', text: `Only ~${effectivePositions.toFixed(1)} effective positions — diversification is thin despite holding ${holdings.length} names.` })
  else if (effectivePositions < 8) flags.push({ severity: 'medium', text: `~${effectivePositions.toFixed(1)} effective positions — concentration is higher than the raw count suggests.` })

  return {
    empty: false,
    totalValue: Number(totalValue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    totalPnl: Number(totalPnl.toFixed(2)),
    totalPnlPct: Number(totalPnlPct.toFixed(2)),
    positionCount: holdings.length,
    effectivePositions: Number(effectivePositions.toFixed(1)),
    effectiveSectors: Number(effectiveSectors.toFixed(1)),
    stockHHI: Number(stockHHI.toFixed(4)),
    sectorHHI: Number(sectorHHI.toFixed(4)),
    score,
    grade,
    scoreBreakdown: {
      breadth: Math.round(breadthScore),
      position: Math.round(positionScore),
      sector: Math.round(sectorScore),
    },
    top5Weight: Number(top5Weight.toFixed(1)),
    largestPosition: { symbol: largest.symbol, weight: largest.weight },
    largestSector: largestSector ? { sector: largestSector.sector, weight: largestSector.weight } : null,
    winnersCount: winners.length,
    losersCount: losers.length,
    winRate: holdings.length > 0 ? Number(((winners.length / holdings.length) * 100).toFixed(0)) : 0,
    bestPerformer: bestPerformer ? { symbol: bestPerformer.symbol, pct: Number(bestPerformer.gainLossPct.toFixed(1)) } : null,
    worstPerformer: worstPerformer ? { symbol: worstPerformer.symbol, pct: Number(worstPerformer.gainLossPct.toFixed(1)) } : null,
    sectors: sectors.map((s) => ({ sector: s.sector, weight: s.weight, count: s.count })),
    holdings: holdings.map((h) => ({ symbol: h.symbol, weight: h.weight, sector: h.sector, pnlPct: Number(h.gainLossPct.toFixed(1)) })),
    flags,
  }
}
