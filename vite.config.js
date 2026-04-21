import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import Anthropic from '@anthropic-ai/sdk'

// ─── Prompt ────────────────────────────────────────────────────────────────
function buildPrompt(text) {
  // Truncate to ~120k chars to stay within Claude's context limits
  const truncated = text.length > 120_000 ? text.slice(0, 120_000) + '\n[truncated]' : text

  return `You are a financial data extractor specialising in brokerage statements and portfolio documents.

Extract every stock, ETF, CDR, or equity position from the document text below.
Return a JSON array where each object uses EXACTLY these keys (empty string "" if unavailable):

"ACCOUNT NUMBER"          – account identifier
"ACCOUNT CURRENCY"        – currency code (CAD, USD, etc.)
"SYMBOL"                  – ticker symbol (e.g. AAPL, NVDA)
"DESCRIPTION"             – full security name
"QUANTITY"                – number of shares/units
"AVERAGE UNIT COST"       – average cost per unit (number, no $ sign)
"BOOK VALUE"              – total cost basis (number, no $ sign)
"MARKET PRICE"            – current price per unit (number, no $ sign)
"MARKET VALUE"            – current total value (number, no $ sign)
"DAY CHANGE"              – today's total dollar change (number, include – for negative)
"DAY CHANGE %"            – today's change as percentage string e.g. "2.14%"
"UNREALIZED GAIN/LOSS"    – total unrealized P&L (number, include – for negative)
"UNREALIZED GAIN/LOSS %"  – unrealized P&L as percentage string e.g. "-24.10%"

Rules:
- Return ONLY a valid JSON array — no markdown fences, no explanation, no trailing commas
- All numeric fields are plain number strings without currency symbols (e.g. "150.25" not "$150.25")
- Percentage fields include the % sign (e.g. "2.14%", "-24.10%")
- Skip cash balances, money-market funds, and non-equity entries
- If a position appears on multiple pages (e.g. split across accounts), include it once per account

Document text:
---
${truncated}
---`
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
            error: 'ANTHROPIC_API_KEY is not set. Add it to your .env file.',
          }))
        }

        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', async () => {
          try {
            const { text } = JSON.parse(body)
            if (!text || typeof text !== 'string') throw new Error('Missing text field in request')

            const client = new Anthropic({ apiKey })
            const message = await client.messages.create({
              model: 'claude-sonnet-4-6',
              max_tokens: 4096,
              messages: [{ role: 'user', content: buildPrompt(text) }],
            })

            // Strip any accidental markdown code fences
            const raw = message.content[0].text.trim()
              .replace(/^```json\s*/i, '')
              .replace(/^```\s*/i, '')
              .replace(/\s*```$/, '')

            const rows = JSON.parse(raw)
            if (!Array.isArray(rows)) throw new Error('Claude did not return a JSON array')

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

// ─── Config ────────────────────────────────────────────────────────────────
export default defineConfig(({ mode }) => {
  // loadEnv with '' prefix loads ALL vars (not just VITE_) — API key stays server-side only
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      pdfExtractPlugin(env.ANTHROPIC_API_KEY),
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
