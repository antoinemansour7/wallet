import { fetchMarketQuotes, fetchCachedMarketQuotes } from '../src/server/marketQuotes.js'
import { resolveSecurityReference } from '../src/server/securitiesReference.js'
import { securitiesReferenceCache } from '../src/server/securitiesReferenceCache.js'
import { getPortfolioSeries, getIntradaySeries } from '../src/server/portfolioSeries.js'
import { getPortfolioComparison } from '../src/server/portfolioComparison.js'
import { isRateLimited } from '../src/server/rateLimit.js'

// A real portfolio has dozens of holdings, not thousands — this is nowhere
// near that, and rejecting above it closes the cheapest version of sending an
// unbounded array into a metered price lookup.
const MAX_SYMBOLS = 200
const MAX_POSITIONS = 500
const PUBLIC_PRICE_ERROR = 'Market prices are temporarily unavailable.'

function getBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') return JSON.parse(req.body)
  return req.body
}

function reportProviderErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return errors
  console.warn('[live-prices] provider errors:', errors)
  return errors.map((error) => ({
    symbol: error?.symbol,
    error: 'Price unavailable',
  }))
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

    // A third market-data action on this route rather than a route of its own:
    // the deployment is at its serverless-function ceiling, which is the same
    // reason portfolio history shares it. Reference data is per-security and
    // slow-moving, and every field independently degrades to null rather than
    // to a plausible default — a tax figure built on a guessed yield is worse
    // than one that says it is an assumption.
    if (Array.isArray(body.reference)) {
      if (body.reference.length > MAX_SYMBOLS) {
        return res.status(400).json({ error: `Maximum ${MAX_SYMBOLS} symbols allowed` })
      }
      const cache = securitiesReferenceCache()
      const symbols = [...new Set(body.reference.map((symbol) => String(symbol ?? '').trim().toUpperCase()).filter(Boolean))]
      const resolved = await Promise.all(symbols.map((symbol) => resolveSecurityReference(symbol, { cache }).catch(() => null)))
      return res.status(200).json({
        securities: Object.fromEntries(resolved.filter(Boolean).map((record) => [record.symbol, record])),
      })
    }

    // Instant first paint: serve Redis-cached quotes without a live fetch
    if (body.cachedOnly && Array.isArray(body.symbols)) {
      return res.status(200).json(await fetchCachedMarketQuotes(body.symbols))
    }

    if (Array.isArray(body.positions)) {
      if (body.comparison) {
        return res.status(200).json(await getPortfolioComparison({ positions: body.positions, cashValue: Number(body.cashValue) || 0, currency: body.currency, benchmark: body.benchmark }))
      }
      if (body.intraday) {
        const result = await getIntradaySeries({
          positions: body.positions,
          cashValue: Number(body.cashValue) || 0,
          includeSession: true,
        })
        return res.status(200).json(result)
      }
      const series = await getPortfolioSeries({
        positions: body.positions,
        cashValue: Number(body.cashValue) || 0,
        days: Math.min(Number(body.days) || 365, 365),
      })
      return res.status(200).json({ series })
    }

    const result = await fetchMarketQuotes(body.symbols)
    return res.status(200).json({
      ...result,
      errors: reportProviderErrors(result.errors),
    })
  } catch (err) {
    // Vercel retains the diagnostic; clients receive stable copy without
    // provider names, infrastructure details, quotas, or command output.
    console.error('[live-prices] request failed:', err)
    return res.status(500).json({ error: PUBLIC_PRICE_ERROR })
  }
}

// This user-driven endpoint runs on load and every five minutes. Persisting a
// run record for every successful request consumed more Redis commands than
// the quote cache itself and provided little operational value.
export default realHandler
