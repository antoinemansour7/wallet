import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { extractPositionsWithGroq } from './src/server/extractPositions.js'
import { fetchYahooQuotes, refreshKnownYahooQuotes } from './src/server/yahooQuotes.js'
import { Redis } from '@upstash/redis'

/**
 * Give a Vercel-style function the small request/response contract it expects.
 * The route still executes the production handler; this only adapts Vite's
 * Connect request to `req.body`, `res.status()` and `res.json()`.
 */
function serverlessHandlerPlugin({ name, route, loadHandler }) {
  return {
    name,
    configureServer(server) {
      server.middlewares.use(route, async (req, res) => {
        try {
          req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams)
          req.setEncoding('utf8')
          let rawBody = ''
          for await (const chunk of req) rawBody += chunk
          req.body = rawBody ? JSON.parse(rawBody) : {}

          res.status = (code) => {
            res.statusCode = code
            return res
          }
          res.json = (payload) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(payload))
            return res
          }

          const { default: handler } = await loadHandler()
          await handler(req, res)
        } catch (err) {
          if (res.writableEnded) return
          res.statusCode = err instanceof SyntaxError ? 400 : 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            error: err instanceof SyntaxError ? 'Invalid JSON body' : (err.message || 'Local API request failed'),
          }))
        }
      })
    },
  }
}

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
            if (Array.isArray(parsed.reference)) {
              // Use the production handler so reference fields and limits stay identical.
              const { default: handler } = await import('./api/live-prices.js')
              req.body = parsed
              res.status = (code) => { res.statusCode = code; return res }
              res.json = (payload) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)); return res }
              return await handler(req, res)
            }

            if (parsed.cachedOnly && Array.isArray(parsed.symbols)) {
              const { fetchCachedMarketQuotes } = await import('./src/server/marketQuotes.js')
              res.setHeader('Content-Type', 'application/json')
              return res.end(JSON.stringify(await fetchCachedMarketQuotes(parsed.symbols)))
            }

            if (Array.isArray(parsed.positions)) {
              if (parsed.comparison) {
                const { getPortfolioComparison } = await import('./src/server/portfolioComparison.js')
                res.setHeader('Content-Type', 'application/json')
                return res.end(JSON.stringify(await getPortfolioComparison({ positions: parsed.positions, cashValue: Number(parsed.cashValue) || 0, currency: parsed.currency, benchmark: parsed.benchmark })))
              }
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

export default defineConfig(({ mode }) => {
  // loadEnv with '' prefix loads ALL vars (not just VITE_) — API key stays server-side only
  const env = loadEnv(mode, process.cwd(), '')

  // Vercel functions read server credentials from process.env. loadEnv returns
  // values without mutating it, so mirror that contract for handlers mounted
  // locally. Shell variables keep precedence over values from .env files.
  if (mode !== 'test') {
    for (const [key, value] of Object.entries(env)) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  }

  return {
    plugins: [
      react(),
      pdfExtractPlugin(env.GROQ_API_KEY),
      livePricesPlugin(),
      refreshPricesPlugin(),
      getResearchPlugin(),
      serverlessHandlerPlugin({
        name: 'nightly-research-api',
        route: '/api/nightly-research',
        loadHandler: () => import('./api/nightly-research.js'),
      }),
      serverlessHandlerPlugin({
        name: 'research-foundation-api',
        route: '/api/research-foundation',
        loadHandler: () => import('./api/research-foundation.js'),
      }),
      serverlessHandlerPlugin({
        name: 'plaid-api',
        route: '/api/plaid',
        loadHandler: () => import('./api/plaid.js'),
      }),
      serverlessHandlerPlugin({
        name: 'market-regime-api',
        route: '/api/market-regime',
        loadHandler: () => import('./api/market-regime.js'),
      }),
    ],
    server: {
      // Vite rejects Host headers it does not recognise, which blocks the dev
      // server whenever it is reached through a tunnel rather than localhost —
      // Vercel's preview sandboxes (*.vercel.run), ngrok, Codespaces. Allowing
      // those hosts by suffix keeps the protection against arbitrary hosts.
      allowedHosts: ['.vercel.run', '.ngrok-free.app', '.github.dev', 'localhost'],
    },
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
