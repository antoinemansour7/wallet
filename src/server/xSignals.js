import { currentSecurityMaster } from './research/securityMaster.js'
import { Redis } from '@upstash/redis'
import * as twitterApiIo from './xProviders/twitterApiIo.js'

const X_API_BASE_URL = process.env.X_API_BASE_URL || 'https://api.x.com'

// Read path selection. Explicit X_PROVIDER wins; otherwise fall back to
// twitterapi.io whenever it is configured and the official bearer token is not,
// so a missing X_BEARER_TOKEN degrades to the cheap provider instead of silence.
//
// The value is trimmed and punctuation-folded before matching. It arrives from
// a dashboard field or a .env line, and an unmatched value used to fall through
// to the official API in silence — with X_BEARER_TOKEN set the fallback below
// cannot catch it either, so one trailing space cost a whole night of X signals
// and reported only "x-official returned zero signals".
const TWITTERAPI_ALIASES = new Set(['twitterapiio', 'twitterapi', 'twitter-api-io', 'io'])
const OFFICIAL_ALIASES = new Set(['x', 'official', 'xofficial', 'x-official'])

function normalizeChoice(raw) {
  return String(raw || '').trim().toLowerCase()
}

function activeProvider() {
  const choice = normalizeChoice(process.env.X_PROVIDER)
  const folded = choice.replace(/[.-_s]/g, '')
  if (OFFICIAL_ALIASES.has(folded)) return null
  if (TWITTERAPI_ALIASES.has(folded)) return twitterApiIo
  if (!process.env.X_BEARER_TOKEN && twitterApiIo.isConfigured()) return twitterApiIo
  if (choice) {
    console.warn(
      `[xSignals] X_PROVIDER=${JSON.stringify(process.env.X_PROVIDER)} matched no known provider — `
      + 'using x-official. Expected "twitterapi.io" or "x".',
    )
  }
  return null
}

export function activeProviderName() {
  return activeProvider() ? 'twitterapi.io' : 'x-official'
}

// Lanes, weights and depth below are set from measured output rather than from
// follower count or reputation. Sampled 2026-08-31 across each account's last
// ~20 original posts (replies and retweets excluded). "tickered" is the share of
// posts naming at least one non-mega-cap cashtag — $AAPL and $SPY are real, but
// an account that only ever names them is not feeding a high-upside board.
//
//   account            tickered  distinct  medEng  promo  in-30h
//   aleabitoreddit          75%        44     533     0%      13
//   MMatters22596           85%        66     214    40%      10
//   wallstengine            42%        10      70     5%      19
//   optionshawk             44%        13      10     6%       2
//   CKCapitalxx             42%        11     110     0%       8
//   Mr_Derivatives          37%        12     328     5%      19
//   amitisinvesting         30%        26    1694    20%       2
//   unusual_whales           0%         0     544    11%      18
//   LizAnnSonders            0%         0      84     0%       7
//
// Four handles were dropped after this sample:
//   GRDecter, MacroAlf  last original post 399d / 229d ago, confirmed against
//                       snowflake IDs on both the timeline and search endpoints.
//   TraderLion          17 posts, zero cashtags — trading psychology and
//                       interview pull-quotes. Nothing here is tradeable.
//   IncredibleTrade     half its posts are subscription marketing, median
//                       engagement of 1, and its "tickers" are $SPX 0DTE
//                       screenshots plus Solana contract addresses.
//
// maxPosts sets how deep to paginate. Depth follows ticker productivity, not
// volume: unusual_whales fills the window every single run but has produced no
// cashtag at all, so paying for three pages of it would buy three pages of
// geopolitics. maxAgeHours widens the window for accounts that post in bursts.
//
// Re-measure any time with: node scripts/probe-x-provider.mjs
export const CURATED_ACCOUNTS = [
  // ── Discovery — the highest ticker density in the list, and what the board
  //    actually runs on. aleabitoreddit named 44 distinct non-mega tickers in
  //    20 posts with zero promotional content; MMatters22596 named 66.
  { username: 'aleabitoreddit',  lane: 'growth',    weight: 1.5,  role: 'conviction', maxPosts: 40 },
  { username: 'MMatters22596',   lane: 'growth',    weight: 1.35, role: 'conviction', maxPosts: 40 },
  { username: 'CKCapitalxx',     lane: 'growth',    weight: 1.2,  role: 'conviction' },

  // ── Catalyst wire — dated, checkable events (upgrades with price targets,
  //    earnings prints, partnerships). Posts every ~6min and saturates the
  //    window, so it is the one account worth paginating deeply.
  { username: 'wallstengine',    lane: 'catalyst',  weight: 1.28, role: 'conviction', maxPosts: 60 },

  // ── Flow — the only account in the list posting genuine options flow
  //    ("$NTRA $GH put buys", short puts with strikes and premiums). Engagement
  //    is low because flow is unglamorous, which is why it is weighted on
  //    content and not on likes. Bursty, but stale flow is not actionable, so
  //    it keeps the standard window.
  { username: 'optionshawk',     lane: 'flow',      weight: 1.28, role: 'conviction' },

  // ── Technical — chart levels on liquid large caps. Reliable but large-cap
  //    biased, which is the opposite of this board's mandate; weighted to
  //    corroborate a setup rather than to originate one.
  { username: 'Mr_Derivatives',  lane: 'technical', weight: 1.1,  role: 'conviction', maxPosts: 40 },

  // ── Macro backdrop — context role, so these shape regime and sizing but
  //    never carry a pick on their own (see the filter in researchEngine).
  //    amitisinvesting posts in bursts around events: 68h of silence, then a
  //    cluster of recaps and Fed reaction. At the standard 30h window he lands
  //    on the board roughly one run in three, so his window is widened to cover
  //    the gap. unusual_whales was previously the highest-weighted conviction
  //    source in this file at 1.35 while producing no cashtags in 18 posts —
  //    it is a geopolitics and headline wire, and is now priced as one.
  { username: 'amitisinvesting', lane: 'macro',     weight: 1.2,  role: 'context', maxAgeHours: 96 },
  { username: 'LizAnnSonders',   lane: 'macro',     weight: 0.9,  role: 'context', maxAgeHours: 48 },
  { username: 'unusual_whales',  lane: 'macro',     weight: 0.85, role: 'context' },
]

const BASE_SEARCH_QUERIES = [
  {
    id: 'smallcaps',
    type: 'hashtag',
    label: 'Small-cap catalysts',
    query: '(#smallcaps OR #microcap OR "small cap") (catalyst OR breakout OR squeeze OR earnings) lang:en -is:retweet',
    weight: 0.95,
  },
  {
    id: 'flow',
    type: 'theme',
    label: 'Unusual flow',
    query: '("options sweep" OR "unusual volume" OR "dark pool" OR "short squeeze") lang:en -is:retweet',
    weight: 1,
  },
  {
    id: 'guidance',
    type: 'theme',
    label: 'Guidance and contracts',
    query: '("raises guidance" OR "beat and raise" OR partnership OR contract OR acquisition) lang:en -is:retweet',
    weight: 0.96,
  },
  {
    id: 'space-defense',
    type: 'theme',
    label: 'Space and defense',
    query: '(space OR satellite OR launch OR rocket OR aerospace OR defense OR drone OR missile) lang:en -is:retweet',
    weight: 0.98,
  },
  // Focus-sector queries that run every night regardless of the adaptive seed
  // (issue #96). Theme-less like the other base queries — themes come from the
  // tweet text, so nothing here force-tags a sector onto a stray mention.
  {
    id: 'ai-compute',
    type: 'theme',
    label: 'AI and compute',
    query: '(#AIstocks OR "artificial intelligence" OR GPU OR GPUs OR semiconductor OR semis OR datacenter OR "AI infrastructure" OR inference) lang:en -is:retweet',
    weight: 1.05,
  },
  {
    id: 'software',
    type: 'theme',
    label: 'Software and cloud',
    query: '(SaaS OR "software stock" OR cloud OR cybersecurity OR "enterprise software" OR devops) lang:en -is:retweet',
    weight: 0.98,
  },
]

const THEME_LIBRARY = {
  biotech: {
    label: 'Biotech',
    keywords: ['biotech', 'fda', 'pdufa', 'clinical', 'phase 1', 'phase 2', 'phase 3', 'trial', 'drug approval'],
    query: '(#biotech OR biotech OR FDA OR PDUFA OR "phase 2" OR "phase 3") lang:en -is:retweet',
    weight: 1.04,
  },
  ai: {
    label: 'AI',
    keywords: ['ai','ai infrastructure', 'artificial intelligence', 'llm', 'gpu', 'datacenter', 'semiconductor', 'chip', 'inference'],
    query: '(#AIstocks OR AI OR GPUs OR semis OR semiconductor OR datacenter) lang:en -is:retweet',
    weight: 1.05,
  },
  crypto: {
    label: 'Crypto',
    keywords: ['crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'blockchain'],
    query: '(#crypto OR #bitcoin OR bitcoin OR ethereum OR solana) lang:en -is:retweet',
    weight: 0.94,
  },
  earnings: {
    label: 'Earnings',
    keywords: ['earnings', 'eps', 'revenue', 'guidance', 'beat', 'miss', 'quarter', 'q1', 'q2', 'q3', 'q4'],
    query: '(earnings OR EPS OR revenue OR guidance OR "beat and raise") lang:en -is:retweet',
    weight: 0.98,
  },
  squeeze: {
    label: 'Squeeze',
    keywords: ['short squeeze', 'short interest', 'gamma squeeze', 'options sweep', 'unusual volume', 'dark pool'],
    query: '("short squeeze" OR "short interest" OR "options sweep" OR "unusual volume") lang:en -is:retweet',
    weight: 1.08,
  },
  macro: {
    label: 'Macro',
    keywords: ['fed', 'inflation', 'cpi', 'yield', 'rates', 'gdp', 'treasury', 'recession'],
    query: '(Fed OR CPI OR inflation OR yields OR GDP OR recession) lang:en -is:retweet',
    weight: 0.82,
  },
  mna: {
    label: 'M&A',
    keywords: ['merger', 'acquisition', 'buyout', 'takeover', 'partnership', 'contract'],
    query: '(acquisition OR merger OR buyout OR takeover OR partnership OR contract) lang:en -is:retweet',
    weight: 0.96,
  },
  space: {
    label: 'Space',
    keywords: ['space', 'satellite', 'launch', 'rocket', 'payload', 'orbital', 'spacecraft'],
    query: '(space OR satellite OR launch OR rocket OR orbital OR payload) lang:en -is:retweet',
    weight: 1.01,
  },
  defense: {
    label: 'Defense',
    keywords: ['defense', 'drone', 'missile', 'aerospace', 'military', 'pentagon', 'contract award'],
    query: '(defense OR aerospace OR drone OR missile OR pentagon OR "contract award") lang:en -is:retweet',
    weight: 1,
  },
}

const SIGNAL_MAX_AGE_MS = 30 * 60 * 60 * 1000

// Most accounts post steadily enough that a flat 30h window is right. A few post
// in bursts around events and go silent for days between; for those the window
// is not a freshness guarantee so much as a coin flip on whether the run happens
// to land inside a burst. Accounts declaring maxAgeHours opt out of the flat
// window. Only context-role accounts do: a macro read from three days ago still
// describes the regime, whereas a three-day-old options sweep is not tradeable,
// so every conviction lane keeps the tight window.
function accountWindowMs(account) {
  return account.maxAgeHours ? account.maxAgeHours * 60 * 60 * 1000 : SIGNAL_MAX_AGE_MS
}
const USER_ID_CACHE_KEY = 'research:x:user_ids'
const USER_ID_CACHE_TTL = 7 * 24 * 60 * 60 // 7 days — account IDs never change
const TIMELINE_CACHE_TTL = 4 * 60 * 60 // 4 hours — refresh more frequently for fresher signals

const CATALYST_REGEX = /(earnings|guidance|beat|miss|partnership|contract|launch|approval|fda|pdufa|trial|phase [123]|short squeeze|short interest|options sweep|unusual volume|acquisition|merger|buyout|breakout)/i

function unique(items) {
  return [...new Set(items.filter(Boolean))]
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function chunk(items, size) {
  const parts = []
  for (let i = 0; i < items.length; i += size) {
    parts.push(items.slice(i, i + size))
  }
  return parts
}

function buildTextBlob(...parts) {
  return parts.filter(Boolean).join(' ')
}

function normalizeTicker(symbol) {
  return String(symbol || '').toUpperCase().replace(/[^A-Z.]/g, '')
}

// Only explicit cashtags, exchange-qualified symbols or unambiguous issuer
// names resolve. Without a master we fail closed; uppercase prose is not identity.
export function extractTickersFromText(text, master = currentSecurityMaster()) {
  return master ? master.text(text).map((security) => security.ticker) : []
}

export function extractThemesFromText(text) {
  if (!text) return []
  const haystack = String(text).toLowerCase()
  return Object.entries(THEME_LIBRARY)
    .filter(([, theme]) => theme.keywords.some((keyword) => haystack.includes(keyword)))
    .map(([key]) => key)
}

function parseDate(dateStr) {
  if (!dateStr) return 0
  const time = new Date(dateStr).getTime()
  return Number.isNaN(time) ? 0 : time
}

function escapeQueryTerm(term) {
  return String(term).replace(/"/g, '')
}

export function deriveAdaptiveSeed({ articles = [], baseSignals = [] } = {}) {
  const themeScores = new Map()
  const tickerScores = new Map()

  const absorb = (text, weight) => {
    for (const theme of extractThemesFromText(text)) {
      themeScores.set(theme, (themeScores.get(theme) || 0) + weight)
    }
    for (const ticker of extractTickersFromText(text)) {
      tickerScores.set(ticker, (tickerScores.get(ticker) || 0) + weight)
    }
  }

  for (const article of articles.slice(0, 40)) {
    absorb(buildTextBlob(article.title, article.description), 2)
  }

  for (const signal of baseSignals.slice(0, 120)) {
    const roleWeight = signal.sourceRole === 'context' ? 0.6 : 1
    absorb(signal.text, 1.2 * roleWeight)
    for (const ticker of signal.tickers || []) {
      tickerScores.set(ticker, (tickerScores.get(ticker) || 0) + (1.4 * roleWeight))
    }
    for (const theme of signal.themes || []) {
      themeScores.set(theme, (themeScores.get(theme) || 0) + (1.1 * roleWeight))
    }
  }

  const topThemes = [...themeScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([theme]) => theme)

  const topTickers = [...tickerScores.entries()]
    .filter(([, score]) => score >= 2.2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([ticker]) => ticker)

  return { topThemes, topTickers }
}

export function buildAdaptiveQueries(seed = {}) {
  const queries = [...BASE_SEARCH_QUERIES]

  for (const themeKey of seed.topThemes || []) {
    const theme = THEME_LIBRARY[themeKey]
    if (!theme) continue
    queries.push({
      id: `theme:${themeKey}`,
      type: 'theme',
      label: `${theme.label} momentum`,
      query: theme.query,
      weight: theme.weight,
      theme: themeKey,
    })
  }

  for (const ticker of seed.topTickers || []) {
    const symbol = escapeQueryTerm(ticker)
    queries.push({
      id: `ticker:${ticker}`,
      type: 'ticker',
      label: `${ticker} catalyst search`,
      query: `("$${symbol}" OR "${symbol}") (earnings OR guidance OR partnership OR contract OR FDA OR launch OR squeeze OR breakout) lang:en -is:retweet`,
      weight: 1.16,
      ticker,
    })
  }

  const seen = new Set()
  return queries.filter((query) => {
    if (!query?.query || seen.has(query.query)) return false
    seen.add(query.query)
    return true
  }).slice(0, 10)
}

async function xApiGet(path, params = {}, token = process.env.X_BEARER_TOKEN) {
  if (!token) throw new Error('X_BEARER_TOKEN is not set')

  const url = new URL(path, X_API_BASE_URL)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  })

  const bodyText = await res.text()
  let body = {}
  try {
    body = bodyText ? JSON.parse(bodyText) : {}
  } catch {
    body = { detail: bodyText }
  }

  if (!res.ok) {
    throw new Error(body.detail || body.title || `X API error ${res.status}`)
  }

  return body
}

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

async function lookupUsersByUsername(usernames, token) {
  const usersByName = new Map()
  const uniqueUsernames = unique(usernames.map((name) => String(name || '').trim())).slice(0, 100)

  // Try Redis cache first
  const redis = getRedis()
  const uncached = []
  if (redis) {
    try {
      const cached = await redis.get(USER_ID_CACHE_KEY)
      if (cached) {
        const entries = typeof cached === 'string' ? JSON.parse(cached) : cached
        for (const user of entries) {
          usersByName.set(user.username.toLowerCase(), user)
        }
      }
    } catch {
      // cache miss — fall through
    }
  }

  for (const name of uniqueUsernames) {
    if (!usersByName.has(name.toLowerCase())) uncached.push(name)
  }

  if (uncached.length === 0) return usersByName

  for (const batch of chunk(uncached, 100)) {
    try {
      const data = await xApiGet('/2/users/by', {
        usernames: batch.join(','),
        'user.fields': 'name,username',
      }, token)

      for (const user of data.data || []) {
        usersByName.set(user.username.toLowerCase(), user)
      }
    } catch {
      for (const username of batch) {
        try {
          const data = await xApiGet(`/2/users/by/username/${encodeURIComponent(username)}`, {
            'user.fields': 'name,username',
          }, token)
          if (data.data) {
            usersByName.set(data.data.username.toLowerCase(), data.data)
          }
        } catch (innerErr) {
          console.warn(`[xSignals] skipping invalid or unavailable account @${username}:`, innerErr.message)
        }
      }
    }
  }

  // Persist to Redis for next run
  if (redis && usersByName.size > 0) {
    try {
      await redis.set(USER_ID_CACHE_KEY, JSON.stringify([...usersByName.values()]), { ex: USER_ID_CACHE_TTL })
    } catch {
      // non-critical
    }
  }

  return usersByName
}

function engagementScore(metrics = {}) {
  const total = (metrics.like_count || 0)
    + (metrics.retweet_count || 0)
    + (metrics.reply_count || 0)
    + (metrics.quote_count || 0)

  if (total <= 0) return 0
  return clamp(Math.log10(total + 1), 0, 1.5)
}

export function scoreSignal(signal) {
  const sourceCount = unique(signal.sourceLabels || []).length
  const themeCount = (signal.themes || []).length
  const tickerCount = (signal.tickers || []).length
  const isExa = (signal.sourceLabels || []).includes('exa-discovery')

  let score = signal.sourceType === 'account' ? 3.7 : isExa ? 3.5 : 2.5
  if (signal.sourceRole === 'context') score -= 1.05
  score += (signal.sourceWeight || 1) * 1.4
  score += Math.min(themeCount, 2) * 0.55
  score += Math.min(tickerCount, 2) * 0.8
  score += sourceCount > 1 ? 0.6 : 0
  score += CATALYST_REGEX.test(signal.text) ? 0.8 : 0
  score += engagementScore(signal.publicMetrics)

  const ageMs = signal.createdAt ? Date.now() - parseDate(signal.createdAt) : Infinity
  const ageHours = ageMs / (60 * 60 * 1000)
  if (ageHours < 4) score += 0.5
  else if (ageHours < 12) score += 0.25
  else if (ageHours < 24) score += 0.1
  // 24-72h signals are kept at base score — they provide multi-day persistence

  return Number(clamp(score, 0, 10).toFixed(2))
}

function toSignal(record, meta = {}) {
  const entityCashtags = (record.entities?.cashtags || []).flatMap((item) => extractTickersFromText(`$${normalizeTicker(item.tag)}`))
  const tickers = unique([
    ...entityCashtags,
    ...extractTickersFromText(record.text),
    ...(meta.ticker ? extractTickersFromText(`$${normalizeTicker(meta.ticker)}`) : []),
  ])
  const themes = unique([
    ...extractThemesFromText(record.text),
    ...(meta.theme ? [meta.theme] : []),
  ])

  return {
    id: String(record.id),
    text: record.text || '',
    username: meta.username || record.username || '',
    createdAt: record.created_at || record.createdAt || null,
    url: meta.username ? `https://x.com/${meta.username}/status/${record.id}` : null,
    sourceType: meta.sourceType || 'search',
    sourceRole: meta.sourceRole || 'conviction',
    sourceLabels: unique([meta.sourceLabel].filter(Boolean)),
    queryLabels: unique([meta.queryLabel].filter(Boolean)),
    queryTypes: unique([meta.queryType].filter(Boolean)),
    sourceWeight: meta.sourceWeight || 1,
    tickers,
    themes,
    publicMetrics: record.public_metrics || {},
  }
}

function mergeSignals(existing, incoming) {
  return {
    ...existing,
    text: existing.text || incoming.text,
    username: existing.username || incoming.username,
    createdAt: parseDate(incoming.createdAt) > parseDate(existing.createdAt) ? incoming.createdAt : existing.createdAt,
    url: existing.url || incoming.url,
    sourceType: existing.sourceType === 'account' || incoming.sourceType === 'account' ? 'account' : existing.sourceType,
    sourceLabels: unique([...(existing.sourceLabels || []), ...(incoming.sourceLabels || [])]),
    queryLabels: unique([...(existing.queryLabels || []), ...(incoming.queryLabels || [])]),
    queryTypes: unique([...(existing.queryTypes || []), ...(incoming.queryTypes || [])]),
    sourceWeight: Math.max(existing.sourceWeight || 1, incoming.sourceWeight || 1),
    tickers: unique([...(existing.tickers || []), ...(incoming.tickers || [])]),
    themes: unique([...(existing.themes || []), ...(incoming.themes || [])]),
    publicMetrics: Object.keys(existing.publicMetrics || {}).length > 0 ? existing.publicMetrics : incoming.publicMetrics,
  }
}

async function fetchAccountSignals(token, { perAccount = 25, errors = [] } = {}) {
  const provider = activeProvider()

  // twitterapi.io addresses accounts by handle, so the /2/users/by lookup (and
  // its Redis id cache) is skipped entirely — one fewer billed call per run.
  if (provider) {
    const signals = []
    for (const account of CURATED_ACCOUNTS) {
      const sinceMs = Date.now() - accountWindowMs(account)
      try {
        const tweets = await provider.fetchUserTweets({
          username: account.username,
          sinceMs,
          maxPosts: account.maxPosts || perAccount,
        })
        if (tweets.length === 0) {
          errors.push({ scope: 'account', username: account.username, error: 'no posts in window' })
        }
        for (const tweet of tweets) {
          signals.push(toSignal(tweet, {
            username: tweet.username || account.username,
            sourceType: 'account',
            sourceRole: account.role || 'conviction',
            sourceLabel: `@${tweet.username || account.username}`,
            sourceWeight: account.weight,
          }))
        }
      } catch (err) {
        console.error(`[xSignals] ${account.username} failed:`, err.message)
        errors.push({ scope: 'account', username: account.username, error: err.message })
      }
    }
    return signals
  }

  const users = await lookupUsersByUsername(CURATED_ACCOUNTS.map((account) => account.username), token)
  const signals = []
  const redis = getRedis()

  for (const account of CURATED_ACCOUNTS) {
    const user = users.get(account.username.toLowerCase())
    if (!user) continue

    const cacheKey = `research:x:timeline:${user.id}`
    let tweets = null

    // Try cache first
    if (redis) {
      try {
        const cached = await redis.get(cacheKey)
        if (cached) tweets = typeof cached === 'string' ? JSON.parse(cached) : cached
      } catch { /* cache miss */ }
    }

    if (!tweets) {
      try {
        const data = await xApiGet(`/2/users/${user.id}/tweets`, {
          max_results: Math.min(account.maxPosts || perAccount, 100),
          exclude: 'replies,retweets',
          'tweet.fields': 'created_at,public_metrics,entities,lang',
        }, token)
        tweets = data.data || []

        // Cache for next run
        if (redis && tweets.length > 0) {
          try { await redis.set(cacheKey, JSON.stringify(tweets), { ex: TIMELINE_CACHE_TTL }) } catch { /* non-critical */ }
        }
      } catch (err) {
        console.error(`[xSignals] account fetch failed for @${account.username}:`, err.message)
        continue
      }
    }

    for (const tweet of tweets) {
      if (tweet.created_at && Date.now() - new Date(tweet.created_at).getTime() > accountWindowMs(account)) continue
      signals.push(toSignal(tweet, {
        username: user.username,
        sourceType: 'account',
        sourceRole: account.role || 'conviction',
        sourceLabel: `@${user.username}`,
        sourceWeight: account.weight,
      }))
    }
  }

  return signals
}

async function fetchSearchSignals(queries, token, { perQuery = 20, errors = [] } = {}) {
  const provider = activeProvider()
  const signals = []
  const startTime = new Date(Date.now() - SIGNAL_MAX_AGE_MS).toISOString()

  if (provider) {
    const sinceMs = Date.now() - SIGNAL_MAX_AGE_MS
    for (const query of queries) {
      try {
        const tweets = await provider.searchTweets({ query: query.query, sinceMs, maxPosts: perQuery })
        for (const tweet of tweets) {
          signals.push(toSignal(tweet, {
            username: tweet.username,
            sourceType: 'search',
            sourceLabel: query.label,
            queryLabel: query.label,
            queryType: query.type,
            sourceWeight: query.weight,
            ticker: query.ticker,
            theme: query.theme,
          }))
        }
      } catch (err) {
        console.error(`[xSignals] search "${query.label}" failed:`, err.message)
        errors.push({ scope: 'search', query: query.label, error: err.message })
      }
    }
    return signals
  }

  for (const query of queries) {
    try {
      const data = await xApiGet('/2/tweets/search/recent', {
        query: query.query,
        max_results: perQuery,
        start_time: startTime,
        expansions: 'author_id',
        'tweet.fields': 'created_at,public_metrics,entities,lang',
        'user.fields': 'name,username',
      }, token)

      const usersById = new Map((data.includes?.users || []).map((user) => [user.id, user]))
      for (const tweet of data.data || []) {
        const author = usersById.get(tweet.author_id)
        signals.push(toSignal(tweet, {
          username: author?.username,
          sourceType: 'search',
          sourceLabel: query.label,
          queryLabel: query.label,
          queryType: query.type,
          sourceWeight: query.weight,
          ticker: query.ticker,
          theme: query.theme,
        }))
      }
    } catch (err) {
      console.error(`[xSignals] recent search failed for "${query.label}":`, err.message)
    }
  }

  return signals
}

export async function collectXSignals({ articles = [], useNewsSeed = false } = {}) {
  const provider = activeProvider()
  const providerName = activeProviderName()
  const token = process.env.X_BEARER_TOKEN

  if (!provider && !token) {
    const error = 'no X provider configured (set TWITTERAPI_IO_KEY or X_BEARER_TOKEN)'
    console.warn(`[xSignals] ${error}`)
    return {
      signals: [], queries: [], seed: { topThemes: [], topTickers: [] },
      stats: { accountSignals: 0, searchSignals: 0, provider: providerName, errors: [{ scope: 'config', error }] },
    }
  }

  // Collected rather than swallowed: the previous silent per-account catch is
  // why a fully dead X leg went unnoticed for a week.
  const errors = []

  // Module state survives between invocations on a warm container, so the
  // counters must start from zero or every run after the first over-reports.
  provider?.resetUsage?.()

  const accountSignals = await fetchAccountSignals(token, { errors })
  const seed = deriveAdaptiveSeed({ articles: useNewsSeed ? articles : [], baseSignals: accountSignals })
  const queries = buildAdaptiveQueries(seed)
  const searchSignals = await fetchSearchSignals(queries, token, { errors })

  if (accountSignals.length === 0 && searchSignals.length === 0) {
    errors.push({ scope: 'x', error: `${providerName} returned zero signals across ${CURATED_ACCOUNTS.length} accounts and ${queries.length} queries` })
  }
  console.log(`[xSignals] provider=${providerName} accounts=${accountSignals.length} search=${searchSignals.length} errors=${errors.length}`)
  if (provider?.getUsage) {
    const usage = provider.getUsage()
    // Requests are the billable unit: every observed call cost a flat 300
    // credits whether it returned 20 posts or 2.
    const usd = (usage.credits / 100000).toFixed(3)
    console.log(
      `[xSignals] provider spend: ${usage.requests} requests, ${usage.posts} posts, `
      + `${usage.credits} credits (USD ${usd} at 1M credits per USD 10)`,
    )
  }

  const merged = new Map()
  for (const signal of [...accountSignals, ...searchSignals]) {
    const current = merged.get(signal.id)
    merged.set(signal.id, current ? mergeSignals(current, signal) : signal)
  }

  const signals = [...merged.values()]
    .map((signal) => ({ ...signal, score: scoreSignal(signal) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return parseDate(b.createdAt) - parseDate(a.createdAt)
    })

  return {
    signals,
    queries,
    seed,
    stats: {
      accountSignals: accountSignals.length,
      searchSignals: searchSignals.length,
      provider: providerName,
      errors,
    },
  }
}
