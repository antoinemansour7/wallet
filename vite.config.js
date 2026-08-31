import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { extractPositionsWithGroq } from './src/server/extractPositions.js'
import { fetchYahooQuotes, refreshKnownYahooQuotes } from './src/server/yahooQuotes.js'
import { Redis } from '@upstash/redis'

// ─── Vite server plugin — adds POST /api/extract-pdf ──────────────────────
function pdfExtractPlugin(apiKey) {
  return {
    name: 'pdf-extract-api',
    configureServer(server) {
      server.middlewares.use('/api/extract-pdf', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end(JSON.stringify({ error: 'Method not allowed' }))
        }

        if (!apiKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({
            error: 'GROQ_API_KEY is not set. Add it to your .env file.',
          }))
        }

        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', async () => {
          try {
            const { text } = JSON.parse(body)
            const rows = await extractPositionsWithGroq(text, apiKey)

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ rows }))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message }))
          }
        })
      })
    },
  }
}

function livePricesPlugin() {
  return {
    name: 'live-prices-api',
    configureServer(server) {
      server.middlewares.use('/api/live-prices', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end(JSON.stringify({ error: 'Method not allowed' }))
        }

        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body || '{}')

            // Mirror the deployed function: { cachedOnly } → instant cache read,
            // { positions } → history series, { symbols } → live quotes
            if (parsed.cachedOnly && Array.isArray(parsed.symbols)) {
              const { fetchCachedMarketQuotes } = await import('./src/server/marketQuotes.js')
              res.setHeader('Content-Type', 'application/json')
              return res.end(JSON.stringify(await fetchCachedMarketQuotes(parsed.symbols)))
            }

            if (Array.isArray(parsed.positions)) {
              const mod = await import('./src/server/portfolioSeries.js')
              const series = parsed.intraday
                ? await mod.getIntradaySeries({ positions: parsed.positions, cashValue: Number(parsed.cashValue) || 0 })
                : await mod.getPortfolioSeries({
                    positions: parsed.positions,
                    cashValue: Number(parsed.cashValue) || 0,
                    days: Math.min(Number(parsed.days) || 365, 365),
                  })
              res.setHeader('Content-Type', 'application/json')
              return res.end(JSON.stringify({ series }))
            }

            const result = await fetchYahooQuotes(parsed.symbols)

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(result))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message }))
          }
        })
      })
    },
  }
}

function liveQuotePlugin() {
  const seedCache = new Map() // symbol -> { seed, at } (dev-only, mirrors Redis TTL)
  const sparkCache = new Map()
  return {
    name: 'live-quote-api',
    configureServer(server) {
      server.middlewares.use('/api/live-quote', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'GET') {
          res.statusCode = 405
          return res.end(JSON.stringify({ error: 'Method not allowed' }))
        }

        const symbol = String(new URL(req.url, 'http://localhost').searchParams.get('symbol') || '')
          .toUpperCase().trim()
        if (!/^[A-Z]{1,6}(\.[A-Z]{1,3})?$/.test(symbol)) {
          res.statusCode = 400
          return res.end(JSON.stringify({ error: 'Enter a stock symbol, e.g. NVDA or ORAC.NE' }))
        }

        ;(async () => {
          try {
            const { computeSignal } = await import('./src/server/tradeSignal.js')
            const { analyzeTickersBatch } = await import('./src/server/technicalAnalysis.js')
            const { fetchYahooQuotes } = await import('./src/server/yahooQuotes.js')
            const { getSpark } = await import('./api/live-quote.js')

            const cached = seedCache.get(symbol)
            let seed = cached && Date.now() - cached.at < 300_000 ? cached.seed : null
            if (!seed) {
              let tech = null
              try { tech = (await analyzeTickersBatch([symbol], { concurrency: 1 })).get(symbol) } catch { /* */ }
              seed = tech?.analyzed
                ? { rsi: tech.rsi, sma20: tech.sma20, sma50: tech.sma50, macd: tech.macd, atr: tech.atr, relativeVolume: tech.relativeVolume, trend: tech.trend }
                : {}
              if (tech?.analyzed) seedCache.set(symbol, { seed, at: Date.now() })
            }

            let spark = sparkCache.get(symbol)
            if (!spark || Date.now() - spark.at > 60_000) {
              spark = { data: await getSpark(symbol), at: Date.now() }
              sparkCache.set(symbol, spark)
            }

            const { quotes } = await fetchYahooQuotes([symbol], { forceRefresh: true })
            const q = quotes.find((x) => Number.isFinite(x.price))
            if (!q) return res.end(JSON.stringify({ found: false, symbol }))

            const price = q.price
            const prevClose = Number.isFinite(q.previousClose) ? q.previousClose : null
            res.end(JSON.stringify({
              found: true, symbol, name: q.shortName || '', currency: q.currency || '',
              price,
              ts: q.marketTime ? new Date(q.marketTime * 1000).toISOString() : new Date().toISOString(),
              prevClose,
              dayChange: prevClose ? Number((price - prevClose).toFixed(2)) : null,
              dayChangePct: Number.isFinite(q.changePercent) ? Number(q.changePercent.toFixed(2)) : (prevClose ? Number((((price - prevClose) / prevClose) * 100).toFixed(2)) : null),
              spark: spark.data,
              indicators: { rsi: seed.rsi ?? null, macd: seed.macd ?? null, trend: seed.trend ?? null, atr: seed.atr ?? null, relativeVolume: seed.relativeVolume ?? null },
              signal: computeSignal({ price, ...seed, prevClose }),
            }))
          } catch (err) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: err.message }))
          }
        })()
      })
    },
  }
}

function refreshPricesPlugin() {
  return {
    name: 'refresh-prices-api',
    configureServer(server) {
      server.middlewares.use('/api/refresh-prices', (req, res) => {
        if (req.method !== 'GET' && req.method !== 'POST') {
          res.statusCode = 405
          return res.end(JSON.stringify({ error: 'Method not allowed' }))
        }

        req.on('data', () => {})
        req.on('end', async () => {
          try {
            const result = await refreshKnownYahooQuotes({ limit: 100 })

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              refreshed: result.cache.refreshed,
              quotes: result.quotes.length,
              missing: result.missing,
              errors: result.errors,
              cache: result.cache,
            }))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message }))
          }
        })
      })
    },
  }
}

function getRedisClient() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

const EMPTY_RESEARCH = { empty: true, picks: [], articles: [], tweetCount: 0, generatedAt: null, errors: [] }

function getResearchPlugin() {
  return {
    name: 'get-research-api',
    configureServer(server) {
      server.middlewares.use('/api/get-research', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          return res.end(JSON.stringify({ error: 'Method not allowed' }))
        }
        req.on('data', () => {})
        req.on('end', async () => {
          try {
            const redis = getRedisClient()
            if (!redis) {
              res.setHeader('Content-Type', 'application/json')
              return res.end(JSON.stringify(EMPTY_RESEARCH))
            }
            const data = await redis.get('research:latest')
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data ?? EMPTY_RESEARCH))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message }))
          }
        })
      })
    },
  }
}

function nightlyResearchPlugin(env) {
  return {
    name: 'nightly-research-api',
    configureServer(server) {
      server.middlewares.use('/api/nightly-research', (req, res) => {
        if (req.method !== 'GET' && req.method !== 'POST') {
          res.statusCode = 405
          return res.end(JSON.stringify({ error: 'Method not allowed' }))
        }

        const cronSecret = env.CRON_SECRET
        const authHeader = req.headers['authorization']
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
          res.statusCode = 401
          return res.end(JSON.stringify({ error: 'Unauthorized' }))
        }

        req.on('data', () => {})
        req.on('end', async () => {
          try {
            // Dynamic imports to pick up env at call time
            const { scrapeFinanceTweets } = await import('./src/server/twitterScraper.js')
            const { fetchAllYahooNews, extractTickers, generateResearchReports } = await import('./src/server/researchEngine.js')

            const errors = []
            let tweets = []
            try { tweets = await scrapeFinanceTweets() } catch (e) { errors.push({ step: 'twitter', error: e.message }) }

            let articles = []
            try { articles = await fetchAllYahooNews() } catch (e) { errors.push({ step: 'yahoo', error: e.message }) }

            if (tweets.length === 0 && articles.length === 0) {
              res.statusCode = 503
              res.setHeader('Content-Type', 'application/json')
              return res.end(JSON.stringify({ error: 'No content available', errors }))
            }

            let tickers = []
            try { tickers = await extractTickers(tweets, articles) } catch (e) { errors.push({ step: 'groq', error: e.message }) }

            let picks = tickers
            if (tickers.length > 0) {
              try { picks = await generateResearchReports(tickers) } catch (e) { errors.push({ step: 'perplexity', error: e.message }) }
            }

            const payload = { generatedAt: new Date().toISOString(), picks, articles, tweetCount: tweets.length, errors }
            const redis = getRedisClient()
            if (redis) await redis.set('research:latest', payload, { ex: 172800 })

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ stored: Boolean(redis), picks: picks.length, tweetCount: tweets.length, articles: articles.length, tickers: tickers.map(t => t.ticker), errors }))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message }))
          }
        })
      })
    },
  }
}

// ─── Config ────────────────────────────────────────────────────────────────
export default defineConfig(({ mode }) => {
  // loadEnv with '' prefix loads ALL vars (not just VITE_) — API key stays server-side only
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      pdfExtractPlugin(env.GROQ_API_KEY),
      livePricesPlugin(),
      liveQuotePlugin(),
      refreshPricesPlugin(),
      getResearchPlugin(),
      nightlyResearchPlugin(env),
    ],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
      coverage: {
        reporter: ['text', 'html'],
        exclude: ['node_modules/', 'src/test/'],
      },
    },
  }
})
