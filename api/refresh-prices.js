import { refreshKnownMarketQuotes } from '../src/server/marketQuotes.js'
import { withRunLog } from '../src/server/runLog.js'

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return true
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
}

async function realHandler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const limit = Number(req.query?.limit ?? process.env.QUOTE_REFRESH_LIMIT ?? 100)
    const result = await refreshKnownMarketQuotes({ limit })
    return res.status(200).json({
      refreshed: result.cache.refreshed,
      quotes: result.quotes.length,
      missing: result.missing,
      errors: result.errors,
      cache: result.cache,
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

export default withRunLog('refresh-prices', realHandler)
