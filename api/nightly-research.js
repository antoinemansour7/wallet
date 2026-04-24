import { Redis } from '@upstash/redis'
import { collectXSignals } from '../src/server/xSignals.js'
import {
  fetchAllYahooNews,
  extractTickers,
  generateResearchReports,
} from '../src/server/researchEngine.js'

const RESEARCH_KEY = 'research:latest'
const RESEARCH_TTL = 48 * 60 * 60 // 48 hours

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return false
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
}

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const errors = []

  // Step 1: collect adaptive X signals (primary discovery layer)
  let signals = []
  let queries = []
  let signalStats = { accountSignals: 0, searchSignals: 0 }
  try {
    const xResult = await collectXSignals()
    signals = xResult.signals
    queries = xResult.queries
    signalStats = xResult.stats
    console.log(`[nightly-research] collected ${signals.length} X signals across ${queries.length} adaptive queries`)
  } catch (err) {
    console.error('[nightly-research] x signal collection failed:', err.message)
    errors.push({ step: 'x', error: err.message })
  }

  // Step 2: fetch Yahoo Finance RSS (secondary context / confirmation layer)
  let articles = []
  try {
    articles = await fetchAllYahooNews()
    console.log(`[nightly-research] fetched ${articles.length} articles`)
  } catch (err) {
    console.error('[nightly-research] yahoo rss failed:', err.message)
    errors.push({ step: 'yahoo', error: err.message })
  }

  // Abort if no content
  if (signals.length === 0 && articles.length === 0) {
    return res.status(503).json({ error: 'No content available from any source', errors })
  }

  // Step 3: extract tickers via Claude
  let tickers = []
  try {
    tickers = await extractTickers(signals, articles)
    console.log(`[nightly-research] extracted ${tickers.length} tickers:`, tickers.map((t) => t.ticker))
  } catch (err) {
    console.error('[nightly-research] ticker extraction failed:', err.message)
    errors.push({ step: 'claude', error: err.message })
  }

  // Step 4: generate Perplexity reports
  let picks = tickers
  if (tickers.length > 0) {
    try {
      picks = await generateResearchReports(tickers)
      console.log(`[nightly-research] generated ${picks.length} reports`)
    } catch (err) {
      console.error('[nightly-research] report generation failed:', err.message)
      errors.push({ step: 'perplexity', error: err.message })
    }
  }

  // Step 5: store in Redis
  const payload = {
    generatedAt: new Date().toISOString(),
    picks,
    articles,
    signalCount: signals.length,
    tweetCount: signals.length,
    queryCount: queries.length,
    xBreakdown: signalStats,
    errors,
  }

  const redis = getRedis()
  if (redis) {
    await redis.set(RESEARCH_KEY, payload, { ex: RESEARCH_TTL })
    console.log('[nightly-research] stored research:latest in Redis')
  } else {
    console.warn('[nightly-research] Redis not configured — results not persisted')
  }

  return res.status(200).json({
    stored: Boolean(redis),
    picks: picks.length,
    signalCount: signals.length,
    tweetCount: signals.length,
    queryCount: queries.length,
    articles: articles.length,
    tickers: tickers.map((t) => t.ticker),
    errors,
  })
}
