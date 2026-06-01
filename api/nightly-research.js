import { Redis } from '@upstash/redis'
import { collectXSignals } from '../src/server/xSignals.js'
import {
  fetchAllYahooNews,
  extractTickers,
  generateResearchReports,
} from '../src/server/researchEngine.js'
import { fetchBreakoutCandidates, candidatesToSignals } from '../src/server/technicalScreener.js'
import { runContrarianAgent } from '../src/server/agents/contrarianAgent.js'
import { runCatalystAgent } from '../src/server/agents/catalystAgent.js'
import { runExaDiscovery } from '../src/server/agents/exaDiscoveryAgent.js'
import { sendPickAlerts } from '../src/server/agents/slackAgent.js'

const RESEARCH_KEY = 'research:latest'
const RESEARCH_TTL = 48 * 60 * 60 // 48 hours
const HISTORY_TTL = 7 * 24 * 60 * 60 // 7 days
const HISTORY_INDEX_KEY = 'research:history-index'
const HISTORY_MAX_ENTRIES = 30

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

  // Step 2.5: technical screener (pre-breakout/squeeze detection)
  try {
    const candidates = await fetchBreakoutCandidates()
    const screenerSignals = candidatesToSignals(candidates)
    signals = [...signals, ...screenerSignals]
    console.log(`[nightly-research] screener signals: ${screenerSignals.length}`)
  } catch (err) {
    console.error('[nightly-research] technical screener failed:', err.message)
    errors.push({ step: 'screener', error: err.message })
  }

  // Step 2.7: Exa discovery (find stocks from financial media, not just X)
  let exaSignalCount = 0
  try {
    const { deriveAdaptiveSeed } = await import('../src/server/xSignals.js')
    const seed = deriveAdaptiveSeed({ baseSignals: signals })
    const exaSignals = await runExaDiscovery(seed)
    signals = [...signals, ...exaSignals]
    exaSignalCount = exaSignals.length
    console.log(`[nightly-research] exa discovery: ${exaSignals.length} signals`)
  } catch (err) {
    console.error('[nightly-research] exa discovery failed:', err.message)
    errors.push({ step: 'exa-discovery', error: err.message })
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

  // Step 3.5: Contrarian Agent — stress-test each pick with bear case
  if (tickers.length > 0) {
    try {
      tickers = await runContrarianAgent(tickers)
      const bearCases = tickers.filter((t) => t.bearCase).length
      console.log(`[nightly-research] contrarian agent: ${bearCases}/${tickers.length} bear cases generated`)
    } catch (err) {
      console.error('[nightly-research] contrarian agent failed:', err.message)
      errors.push({ step: 'contrarian', error: err.message })
    }
  }

  // Step 3.6: Catalyst Agent — verify catalysts via Exa search
  if (tickers.length > 0) {
    try {
      tickers = await runCatalystAgent(tickers)
      const verified = tickers.filter((t) => t.catalystVerified).length
      console.log(`[nightly-research] catalyst agent: ${verified}/${tickers.length} catalysts verified`)
    } catch (err) {
      console.error('[nightly-research] catalyst agent failed:', err.message)
      errors.push({ step: 'catalyst', error: err.message })
    }
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

    // Store history entry
    const dateKey = new Date().toISOString().slice(0, 10)
    const historyKey = `research:history:${dateKey}`
    await redis.set(historyKey, payload, { ex: HISTORY_TTL })
    await redis.lpush(HISTORY_INDEX_KEY, dateKey)
    await redis.ltrim(HISTORY_INDEX_KEY, 0, HISTORY_MAX_ENTRIES - 1)

    console.log('[nightly-research] stored research:latest + history in Redis')
  } else {
    console.warn('[nightly-research] Redis not configured — results not persisted')
  }

  // Step 6: Send Slack alerts
  if (picks.length > 0) {
    try {
      await sendPickAlerts(picks)
    } catch (err) {
      console.error('[nightly-research] slack alert failed:', err.message)
      errors.push({ step: 'slack', error: err.message })
    }
  }

  return res.status(200).json({
    stored: Boolean(redis),
    picks: picks.length,
    signalCount: signals.length,
    tweetCount: signals.length,
    queryCount: queries.length,
    articles: articles.length,
    exaSignals: exaSignalCount,
    tickers: tickers.map((t) => t.ticker),
    errors,
  })
}
