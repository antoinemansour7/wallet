// Company sectors for the constrained-portfolio comparison. The free Polygon
// plan has no live quotes, but its company details carry the SEC SIC code,
// which maps to the sector names the evaluation benchmarks against (see
// SECTOR_BENCHMARKS). The mapping is by SIC industry group, so it is an
// approximation of GICS, versioned so it can be revised without mixing.
export const SIC_SECTOR_VERSION = 'sic-division-v1'

// Ordered [from, to, sector]; the first matching range wins.
const SIC_RANGES = [
  [100, 999, 'Consumer Staples'],
  [1000, 1099, 'Materials'], [1200, 1299, 'Energy'], [1300, 1399, 'Energy'], [1400, 1499, 'Materials'],
  [1500, 1799, 'Industrials'],
  [2000, 2199, 'Consumer Staples'], [2200, 2399, 'Consumer Discretionary'], [2400, 2499, 'Materials'],
  [2500, 2599, 'Consumer Discretionary'], [2600, 2699, 'Materials'], [2700, 2799, 'Communication Services'],
  [2830, 2836, 'Health Care'], [2840, 2844, 'Consumer Staples'], [2800, 2899, 'Materials'], [2900, 2999, 'Energy'],
  [3000, 3099, 'Materials'], [3100, 3199, 'Consumer Discretionary'], [3200, 3399, 'Materials'], [3400, 3499, 'Industrials'],
  [3570, 3579, 'Technology'], [3500, 3599, 'Industrials'],
  [3630, 3639, 'Consumer Discretionary'], [3600, 3699, 'Technology'],
  [3710, 3716, 'Consumer Discretionary'], [3750, 3751, 'Consumer Discretionary'], [3700, 3799, 'Industrials'],
  [3840, 3851, 'Health Care'], [3800, 3899, 'Technology'], [3900, 3999, 'Consumer Discretionary'],
  [4000, 4799, 'Industrials'], [4800, 4899, 'Communication Services'], [4950, 4959, 'Industrials'], [4900, 4999, 'Utilities'],
  [5120, 5122, 'Health Care'], [5140, 5149, 'Consumer Staples'], [5000, 5199, 'Industrials'],
  [5400, 5499, 'Consumer Staples'], [5912, 5912, 'Consumer Staples'], [5200, 5999, 'Consumer Discretionary'],
  [6500, 6553, 'Real Estate'], [6798, 6798, 'Real Estate'], [6000, 6799, 'Financials'],
  [7000, 7099, 'Consumer Discretionary'], [7200, 7299, 'Consumer Discretionary'],
  [7370, 7379, 'Technology'], [7300, 7399, 'Industrials'], [7500, 7599, 'Consumer Discretionary'],
  [7800, 7899, 'Communication Services'], [7900, 7999, 'Consumer Discretionary'],
  [8000, 8099, 'Health Care'], [8200, 8299, 'Consumer Discretionary'], [8100, 8999, 'Industrials'],
]

export function sectorFromSic(code) {
  const sic = Number(code)
  if (!/^\d{3,4}$/.test(String(code ?? '')) || !Number.isInteger(sic)) return null
  return SIC_RANGES.find(([from, to]) => sic >= from && sic <= to)?.[2] || null
}

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/** A company's sector from Polygon company details; null when unknown. */
export async function fetchPolygonSector(ticker, {
  fetchImpl = fetch, apiKey = process.env.POLYGON_API_KEY, baseUrl = process.env.POLYGON_API_BASE_URL || 'https://api.polygon.io',
  sleep = pause, signal, retries = 3,
} = {}) {
  if (!apiKey || !ticker) return null
  const url = `${baseUrl.replace(/\/$/, '')}/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${encodeURIComponent(apiKey)}`
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetchImpl(url, { signal })
    // The free plan allows five requests a minute.
    if (response.status === 429 && attempt < retries) { await sleep(13000); continue }
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Polygon company details ${response.status}`)
    const details = (await response.json())?.results
    const sector = sectorFromSic(details?.sic_code)
    return sector ? { sector, sicCode: String(details.sic_code), sicDescription: details.sic_description || null } : null
  }
  throw new Error('Polygon company details rate limited')
}

/**
 * Fills in the sector of the candidates the shared review accepted, best
 * first, so the constrained portfolio can size them. A company's sector is
 * archived once and reused. A lookup failure leaves the sector unknown; it
 * never fails the evaluation.
 */
export async function withSectors(archive, candidates, decisions, { lookup = fetchPolygonSector, limit = 8, signal } = {}) {
  const accepted = decisions.filter((d) => d?.status === 'accepted').sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const wanted = accepted.map((d) => candidates.find((c) => c.key === d.key))
    .filter((c) => c && !c.sector && c.securityId)
  const found = new Map()
  let lookups = 0
  for (const c of wanted) {
    if (found.has(c.securityId)) continue
    const cached = await archive.get('security-sector', c.securityId)
    if (cached?.sector) { found.set(c.securityId, cached.sector); continue }
    if (lookups >= limit) continue
    lookups += 1
    try {
      const result = await lookup(c.ticker, { signal })
      if (!result?.sector) continue
      const availableAt = new Date().toISOString()
      await archive.put('security-sector', c.securityId, { securityId: c.securityId, ticker: c.ticker, ...result,
        version: SIC_SECTOR_VERSION, source: 'polygon-company-details', availableAt }, 'security-sectors', availableAt)
      found.set(c.securityId, result.sector)
    } catch (error) {
      console.error(`[evaluation] sector lookup failed for ${c.ticker}: ${error.message}`)
    }
  }
  return candidates.map((c) => (!c.sector && found.has(c.securityId)
    ? { ...c, sector: found.get(c.securityId), sectorSource: SIC_SECTOR_VERSION } : c))
}
