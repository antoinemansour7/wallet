// API health/credits check for every external service the pipeline uses.
// Run: node scripts/api-health.mjs   (never prints key material)
import { readFileSync } from 'fs'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const results = []
const t = () => AbortSignal.timeout(12000)

async function check(name, fn) {
  try {
    const [status, note] = await fn()
    results.push({ name, status, note })
  } catch (err) {
    results.push({ name, status: 'DEAD', note: String(err.message).slice(0, 90) })
  }
}

await Promise.all([
  check('Anthropic (picker/agents)', async () => {
    const r = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, signal: t(),
    })
    return r.ok ? ['ALIVE', 'key valid'] : ['DEAD', `HTTP ${r.status}`]
  }),

  check('OpenAI (research reports)', async () => {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1-mini', input: 'ping', max_output_tokens: 16 }),
      signal: t(),
    })
    if (r.ok) return ['ALIVE', 'key valid, credits available']
    const body = await r.json().catch(() => ({}))
    const code = body?.error?.code || `HTTP ${r.status}`
    if (code === 'insufficient_quota') return ['NO CREDITS', 'key valid but balance exhausted']
    return ['DEAD', code]
  }),

  check('Groq (PDF extraction)', async () => {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, signal: t(),
    })
    return r.ok ? ['ALIVE', 'key valid'] : ['DEAD', `HTTP ${r.status}`]
  }),

  check('Exa (discovery/catalyst/contrarian)', async () => {
    const r = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': env.EXA_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'AAPL stock', numResults: 1 }),
      signal: t(),
    })
    if (r.ok) return ['ALIVE', 'search ok']
    const body = await r.text()
    return ['DEAD', `HTTP ${r.status} ${body.slice(0, 60)}`]
  }),

  check('Polygon (quotes/premarket movers)', async () => {
    const r = await fetch(`https://api.polygon.io/v3/reference/tickers?limit=1&apiKey=${env.POLYGON_API_KEY}`, { signal: t() })
    if (r.ok) return ['ALIVE', 'key valid']
    return ['DEAD', `HTTP ${r.status}${r.status === 429 ? ' (rate limited — free tier 5/min)' : ''}`]
  }),

  check('X API (signal collection)', async () => {
    const r = await fetch('https://api.x.com/2/usage/tweets', {
      headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` }, signal: t(),
    })
    if (!r.ok) return ['DEAD', `HTTP ${r.status}`]
    const body = await r.json()
    const usage = body?.data?.project_usage
    const cap = body?.data?.project_cap
    const reset = body?.data?.cap_reset_day
    return ['ALIVE', usage != null ? `${usage}/${cap} posts used this month (resets day ${reset})` : 'key valid']
  }),

  check('Upstash Redis (storage)', async () => {
    const r = await fetch(`${env.UPSTASH_REDIS_REST_URL}/ping`, {
      headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` }, signal: t(),
    })
    const body = await r.json().catch(() => ({}))
    return body?.result === 'PONG' ? ['ALIVE', 'PONG'] : ['DEAD', `HTTP ${r.status}`]
  }),

  check('Slack (pick alerts)', async () => {
    const r = await fetch('https://slack.com/api/auth.test', {
      method: 'POST', headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` }, signal: t(),
    })
    const body = await r.json()
    return body.ok ? ['ALIVE', `workspace: ${body.team}`] : ['DEAD', body.error || 'auth failed']
  }),

  check('Plaid (brokerage sync)', async () => {
    const host = env.PLAID_ENV === 'production' ? 'production' : env.PLAID_ENV === 'development' ? 'development' : 'sandbox'
    const r = await fetch(`https://${host}.plaid.com/institutions/get`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, count: 1, offset: 0, country_codes: ['US', 'CA'] }),
      signal: t(),
    })
    return r.ok ? ['ALIVE', `env: ${host}`] : ['DEAD', `HTTP ${r.status} (env: ${host})`]
  }),

  check('Perplexity (in .env, UNUSED in code)', async () => {
    const r = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      signal: t(),
    })
    if (r.ok) return ['ALIVE', 'key valid (but nothing calls it)']
    const body = await r.json().catch(() => ({}))
    return ['DEAD', body?.error?.message?.slice(0, 60) || `HTTP ${r.status}`]
  }),

  // Keyless dependencies
  check('Yahoo Finance (quotes/candles)', async () => {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: t(),
    })
    return r.ok ? ['ALIVE', 'no key needed'] : ['DEAD', `HTTP ${r.status}`]
  }),

  check('Finviz (screeners/earnings)', async () => {
    const r = await fetch('https://finviz.com/screener.ashx?v=111&f=cap_smallover&ft=4&r=1', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }, signal: t(),
    })
    return r.ok ? ['ALIVE', 'no key needed'] : ['DEAD', `HTTP ${r.status}`]
  }),

  check('Parqet (company logos)', async () => {
    const r = await fetch('https://assets.parqet.com/logos/symbol/AAPL?format=png', { signal: t() })
    return r.ok ? ['ALIVE', 'no key needed'] : ['DEAD', `HTTP ${r.status}`]
  }),
])

const pad = (s, n) => String(s).padEnd(n)
console.log(pad('SERVICE', 38) + pad('STATUS', 12) + 'NOTE')
console.log('-'.repeat(100))
for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) {
  const icon = r.status === 'ALIVE' ? '✅' : r.status === 'NO CREDITS' ? '🟡' : '❌'
  console.log(pad(`${icon} ${r.name}`, 38) + pad(r.status, 12) + r.note)
}
