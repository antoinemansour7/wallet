
import { collectXSignals } from './src/server/xSignals.js'
import { fetchAllYahooNews, extractTickers, generateResearchReports } from './src/server/researchEngine.js'
import { fetchBreakoutCandidates, candidatesToSignals } from './src/server/technicalScreener.js'
import { Redis } from '@upstash/redis'

const RESEARCH_KEY = 'research:latest'
const RESEARCH_TTL = 48 * 60 * 60

async function run() {
  console.log('[run] Step 1: collecting X signals...')
  let signals = []
  let queries = []
  let stats = { accountSignals: 0, searchSignals: 0 }
  try {
    const xResult = await collectXSignals()
    signals = xResult.signals
    queries = xResult.queries
    stats = xResult.stats
  } catch (err) {
    console.error('[run] X signals failed:', err.message)
  }
  console.log(`[run] ${signals.length} signals, ${queries.length} queries`)

  console.log('[run] Step 2: fetching Yahoo RSS...')
  const articles = await fetchAllYahooNews()
  console.log(`[run] ${articles.length} articles`)

  console.log('[run] Step 2.5: running technical screener...')
  try {
    const candidates = await fetchBreakoutCandidates()
    const screenerSignals = candidatesToSignals(candidates)
    signals = [...signals, ...screenerSignals]
    console.log(`[run] screener: ${screenerSignals.length} signals from ${candidates.length} candidates`)
  } catch (err) {
    console.error('[run] screener failed:', err.message)
  }

  console.log('[run] Step 3: extracting tickers via Claude...')
  const tickers = await extractTickers(signals, articles)
  console.log(`[run] tickers: ${tickers.map(t => `${t.ticker} (${t.conviction}/10)`).join(', ')}`)

  console.log('[run] Step 4: generating research reports via OpenAI...')
  const picks = await generateResearchReports(tickers)
  for (const p of picks) {
    if (p.error) console.error(`[run] ${p.ticker} FAILED: ${p.error}`)
    else console.log(`[run] ${p.ticker} report: ${p.report.slice(0, 100)}...`)
  }

  console.log('[run] Step 5: storing in Redis...')
  const redis = Redis.fromEnv()
  const payload = {
    generatedAt: new Date().toISOString(),
    picks,
    articles,
    signalCount: signals.length,
    tweetCount: signals.length,
    queryCount: queries.length,
    xBreakdown: stats,
    errors: [],
  }
  await redis.set(RESEARCH_KEY, payload, { ex: RESEARCH_TTL })

  // Store history
  const dateKey = new Date().toISOString().slice(0, 10)
  await redis.set(`research:history:${dateKey}`, payload, { ex: 7 * 24 * 60 * 60 })
  await redis.lpush('research:history-index', dateKey)
  await redis.ltrim('research:history-index', 0, 29)

  console.log('[run] Done! Research stored in Redis.')
}

run().catch(err => { console.error(err); process.exit(1) })
