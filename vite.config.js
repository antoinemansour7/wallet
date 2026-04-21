import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { extractPositionsWithGroq } from './src/server/extractPositions.js'
import { fetchYahooQuotes, refreshKnownYahooQuotes } from './src/server/yahooQuotes.js'

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
            const { symbols } = JSON.parse(body || '{}')
            const result = await fetchYahooQuotes(symbols)

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

// ─── Config ────────────────────────────────────────────────────────────────
export default defineConfig(({ mode }) => {
  // loadEnv with '' prefix loads ALL vars (not just VITE_) — API key stays server-side only
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      pdfExtractPlugin(env.GROQ_API_KEY),
      livePricesPlugin(),
      refreshPricesPlugin(),
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
