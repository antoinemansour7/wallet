
import { collectXSignals } from './src/server/xSignals.js'
import { fetchAllYahooNews, extractTickers, generateResearchReports } from './src/server/researchEngine.js'
import { Redis } from '@upstash/redis'

const RESEARCH_KEY = 'research:latest'
const RESEARCH_TTL = 48 * 60 * 60

async function run() {
  console.log('[run] Step 1: collecting X signals...')
  const { signals, queries, stats } = await collectXSignals()
  console.log(`[run] ${signals.length} signals, ${queries.length} queries`)

  console.log('[run] Step 2: fetching Yahoo RSS...')
  const articles = await fetchAllYahooNews()
  console.log(`[run] ${articles.length} articles`)

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
  console.log('[run] Done! Research stored in Redis.')
}

run().catch(err => { console.error(err); process.exit(1) })
