import { fetchMarketQuotes, fetchCachedMarketQuotes } from '../src/server/marketQuotes.js'
import { getPortfolioSeries, getIntradaySeries } from '../src/server/portfolioSeries.js'
import { isRateLimited } from '../src/server/rateLimit.js'
import { withRunLog } from '../src/server/runLog.js'

// A real portfolio has dozens of holdings, not thousands — this is nowhere
// near that, and rejecting above it closes the cheapest version of sending an
// unbounded array into a metered price lookup.
const MAX_SYMBOLS = 200
const MAX_POSITIONS = 500

function getBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') return JSON.parse(req.body)
  return req.body
}

// One function, two market-data actions (Vercel Hobby caps deployments at 12
// serverless functions, so portfolio history shares this route):
//   { symbols }   → live quotes
//   { positions } → reconstructed portfolio value history
async function realHandler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (await isRateLimited(req, res, 'live-prices', { requests: 30, window: '1 m' })) return

  try {
    const body = getBody(req)

    if (Array.isArray(body.symbols) && body.symbols.length > MAX_SYMBOLS) {
      return res.status(400).json({ error: `Maximum ${MAX_SYMBOLS} symbols allowed` })
    }
    if (Array.isArray(body.positions) && body.positions.length > MAX_POSITIONS) {
      return res.status(400).json({ error: `Maximum ${MAX_POSITIONS} positions allowed` })
    }

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

export default withRunLog('live-prices', realHandler)
