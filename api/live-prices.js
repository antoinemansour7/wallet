import { fetchMarketQuotes, fetchCachedMarketQuotes } from '../src/server/marketQuotes.js'
import { getPortfolioSeries, getIntradaySeries } from '../src/server/portfolioSeries.js'

function getBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') return JSON.parse(req.body)
  return req.body
}

// One function, two market-data actions (Vercel Hobby caps deployments at 12
// serverless functions, so portfolio history shares this route):
//   { symbols }   → live quotes
//   { positions } → reconstructed portfolio value history
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const body = getBody(req)

    // Instant first paint: serve Redis-cached quotes without a live fetch
    if (body.cachedOnly && Array.isArray(body.symbols)) {
      return res.status(200).json(await fetchCachedMarketQuotes(body.symbols))
    }

    if (Array.isArray(body.positions)) {
      if (body.intraday) {
        const series = await getIntradaySeries({
          positions: body.positions,
          cashValue: Number(body.cashValue) || 0,
        })
        return res.status(200).json({ series })
      }
      const series = await getPortfolioSeries({
        positions: body.positions,
        cashValue: Number(body.cashValue) || 0,
        days: Math.min(Number(body.days) || 365, 365),
      })
      return res.status(200).json({ series })
    }

    const result = await fetchMarketQuotes(body.symbols)
    return res.status(200).json(result)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
