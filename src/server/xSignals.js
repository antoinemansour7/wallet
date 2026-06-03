import { Redis } from '@upstash/redis'

const X_API_BASE_URL = process.env.X_API_BASE_URL || 'https://api.x.com'

const CURATED_ACCOUNTS = [
  // Flow / unusual activity
  { username: 'unusualwhales',   lane: 'flow',         weight: 1.35, role: 'conviction' },
  { username: 'GRDecter',        lane: 'flow',         weight: 1.18, role: 'conviction' },
  { username: 'optionshawk',     lane: 'flow',         weight: 1.15, role: 'conviction' },
  { username: 'DarkPoolAlerts',  lane: 'flow',         weight: 1.12, role: 'conviction' },
  // US equities + growth
  { username: 'aleabitoreddit', lane: 'growth',       weight: 1.45, role: 'conviction' },
  { username: 'amitisinvesting', lane: 'growth',       weight: 1.1, role: 'context' },
  { username: 'TraderLion',      lane: 'growth',       weight: 1.1, role: 'conviction' },
  { username: 'IncredibleTrade', lane: 'growth',       weight: 1.08, role: 'conviction' },
  { username: 'ripaborern',      lane: 'growth',       weight: 1.0, role: 'conviction' },
  // Macro + rates (top 2 only)
  { username: 'LizAnnSonders',   lane: 'macro',        weight: 0.95, role: 'context' },
  { username: 'MacroAlf',        lane: 'macro',        weight: 0.94, role: 'context' },
  // Technical analysis
  { username: 'NorthmanTrader',  lane: 'technical',    weight: 0.9, role: 'conviction' },
  { username: 'MMatters22596',   lane: 'technical',    weight: 1.0, role: 'conviction' },
  { username: 'chartaborern',    lane: 'technical',    weight: 0.92, role: 'conviction' },
  // Catalyst / event-driven
  { username: 'biaborern',       lane: 'catalyst',     weight: 1.05, role: 'conviction' },
  { username: 'INArteCarlworx',  lane: 'catalyst',     weight: 0.96, role: 'conviction' },
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
    query: '(defense OR aerospace OR drone OR missile OR pentagon OR \"contract award\") lang:en -is:retweet',
    weight: 1,
  },
}

const SIGNAL_MAX_AGE_MS = 30 * 60 * 60 * 1000
const USER_ID_CACHE_KEY = 'research:x:user_ids'
const USER_ID_CACHE_TTL = 7 * 24 * 60 * 60 // 7 days — account IDs never change
const TIMELINE_CACHE_TTL = 4 * 60 * 60 // 4 hours — refresh more frequently for fresher signals

const TICKER_STOPWORDS = new Set([
  'A', 'AI', 'ALL', 'AMD', 'AM', 'API', 'ARE', 'AS', 'AT', 'ATH', 'BE', 'BEAT', 'BLS', 'BULL', 'BEAR', 'BUY', 'BY',
  'CALL', 'CASH', 'CEO', 'CFO', 'CNBC', 'COME', 'CPI', 'CTA', 'CUT',
  'DATA', 'DAY', 'DD', 'DEAL', 'DM', 'DOE', 'DOJ', 'DREAM', 'DROP', 'DUMP',
  'EDIT', 'EPS', 'ETF', 'ETFS', 'EU', 'EV',
  'FACE', 'FACT', 'FALL', 'FAST', 'FDA', 'FED', 'FLAT', 'FLOW', 'FOR', 'FREE', 'FROM', 'FULL', 'FUND',
  'GAIN', 'GDP', 'GM', 'GPT', 'GROSS', 'GROW',
  'HALF', 'HANG', 'HAS', 'HELP', 'HERE', 'HHS', 'HIGH', 'HOLD', 'HOME', 'HOPE', 'HUGE',
  'IDEA', 'IN', 'INTO', 'IPO', 'IRS', 'IS', 'IT',
  'JUMP', 'JUST',
  'KEEP',
  'LAST', 'LATE', 'LEAD', 'LIKE', 'LIST', 'LIVE', 'LLM', 'LONG', 'LOOK', 'LOSE', 'LOSS', 'LOW',
  'MAKE', 'MANY', 'MASS', 'MBA', 'MEAN', 'MISS', 'MNA', 'MODE', 'MORE', 'MOST', 'MOVE', 'MUCH', 'MUST',
  'NEAR', 'NEED', 'NEWS', 'NEXT', 'NOTE', 'NOW', 'NYSE',
  'OF', 'ON', 'ONLY', 'OPEN', 'OR', 'OVER',
  'PAID', 'PART', 'PAST', 'PAUSE', 'PDUFA', 'PICK', 'PLAN', 'PLAY', 'POST', 'PULL', 'PUMP', 'PUSH', 'PUTS',
  'QQQ',
  'RATE', 'READY', 'REAL', 'RISK', 'ROAD', 'ROLL', 'RULE',
  'SAFE', 'SALE', 'SAME', 'SAVE', 'SEC', 'SEED', 'SEEN', 'SELL', 'SEMI', 'SEND', 'SENT', 'SHOW', 'SHUT', 'SIDE', 'SIVE', 'SIZE', 'SLOW', 'SOME', 'SOON', 'SORT', 'SPY', 'STAY', 'STEP', 'STOP', 'SURE',
  'TAKE', 'TALK', 'TERM', 'TESLA', 'TEST', 'THAT', 'THE', 'THEM', 'THEN', 'THIS', 'TIME', 'TO', 'TOLD', 'TOOK', 'TOPS', 'TRUE', 'TRUMP', 'TSX', 'TURN',
  'UK', 'USA', 'USD', 'US', 'USED',
  'VERY', 'VIEW', 'VIX',
  'WAIT', 'WAKE', 'WANT', 'WARN', 'WASH', 'WAYS', 'WEEK', 'WENT', 'WHAT', 'WHEN', 'WHO', 'WIDE', 'WILL', 'WITH', 'WORK', 'WRAP', 'WSB',
  'X',
  'YEAR', 'YOY',
  'ZERO',
])

const SEED_TICKER_EXCLUSIONS = new Set([
  'AAPL', 'AMZN', 'GOOG', 'GOOGL', 'IGV', 'IWM', 'META', 'MSFT', 'NVDA', 'QQQ', 'SPY', 'TSLA',
])

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

export function extractTickersFromText(text) {
  if (!text) return []

  const found = []
  const seen = new Set()
  const raw = String(text)

  for (const match of raw.matchAll(/\$([A-Z]{1,5})\b/g)) {
    const ticker = normalizeTicker(match[1])
    if (!ticker || TICKER_STOPWORDS.has(ticker) || seen.has(ticker)) continue
    seen.add(ticker)
    found.push(ticker)
  }

  for (const match of raw.matchAll(/\b([A-Z]{2,5})\b/g)) {
    const ticker = normalizeTicker(match[1])
    if (!ticker || TICKER_STOPWORDS.has(ticker) || seen.has(ticker)) continue
    seen.add(ticker)
    found.push(ticker)
  }

  return found.slice(0, 6)
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
    .filter(([ticker]) => !SEED_TICKER_EXCLUSIONS.has(ticker))
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
    } catch (err) {
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
  const entityCashtags = (record.entities?.cashtags || []).map((item) => normalizeTicker(item.tag))
  const tickers = unique([
    ...entityCashtags,
    ...extractTickersFromText(record.text),
    ...(meta.ticker ? [normalizeTicker(meta.ticker)] : []),
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

async function fetchAccountSignals(token, { perAccount = 25 } = {}) {
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
          max_results: perAccount,
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
      if (tweet.created_at && Date.now() - new Date(tweet.created_at).getTime() > SIGNAL_MAX_AGE_MS) continue
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

async function fetchSearchSignals(queries, token, { perQuery = 20 } = {}) {
  const signals = []
  const startTime = new Date(Date.now() - SIGNAL_MAX_AGE_MS).toISOString()

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
  const token = process.env.X_BEARER_TOKEN
  if (!token) {
    console.warn('[xSignals] X_BEARER_TOKEN is not set; skipping X collection')
    return { signals: [], queries: [], seed: { topThemes: [], topTickers: [] }, stats: { accountSignals: 0, searchSignals: 0 } }
  }

  const accountSignals = await fetchAccountSignals(token)
  const seed = deriveAdaptiveSeed({ articles: useNewsSeed ? articles : [], baseSignals: accountSignals })
  const queries = buildAdaptiveQueries(seed)
  const searchSignals = await fetchSearchSignals(queries, token)

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
    },
  }
}
