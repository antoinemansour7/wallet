import { createAlpacaOptionsAdapter } from '../src/server/options/alpaca.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from '../src/server/options/watchlist.js'

try { process.loadEnvFile?.() } catch { /* Environment may already be configured by the runner. */ }

const ticker = String(process.argv[2] || 'NVDA').trim().toUpperCase()
const security = OPTIONS_WATCHLIST_SNAPSHOT.securities.find((item) => item.ticker === ticker)
if (!security) throw new Error('Acceptance symbol must be in the versioned options watchlist')

const addDays = (date, days) => new Date(date.getTime() + days * 86400000).toISOString().slice(0, 10)
const now = new Date()
const adapter = createAlpacaOptionsAdapter({ maxPages: 5, maxRequests: 12, maxAttempts: 2 })
const deadline = new Date(now.getTime() + 45000).toISOString()
const underlying = await adapter.underlyingSnapshots([security], { deadline })
const observation = underlying.observations[0]
if (!observation?.quote) throw new Error(`Alpaca acceptance could not obtain an underlying quote (${underlying.failure?.code || 'missing_quote'})`)

const midpoint = (observation.quote.bid + observation.quote.ask) / 2
const chain = await adapter.optionChain({
  security,
  expirationDateGte: addDays(now, 7),
  expirationDateLte: addDays(now, 21),
  strikePriceGte: Math.max(0.01, Math.floor(midpoint * 0.8)),
  strikePriceLte: Math.ceil(midpoint * 1.2),
  deadline,
})

console.log(JSON.stringify({
  provider: chain.provider,
  feed: chain.feed,
  entitlement: chain.entitlement,
  ticker,
  complete: chain.complete,
  pricingReady: chain.pricingReady,
  contracts: chain.contracts.length,
  rejected: chain.rejected.length,
  pages: chain.pageCounts,
  requests: underlying.requestCount + chain.requestCount,
  failures: chain.failures,
}, null, 2))

if (!chain.complete) process.exitCode = 1
