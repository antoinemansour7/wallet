import { Scraper } from 'agent-twitter-client'
import { Redis } from '@upstash/redis'

const TARGET_ACCOUNTS = [
  // Flow / unusual activity
  'unusualwhales',       // options flow, dark pool
  'GRDecter',            // options flow + momentum
  'optionshawk',         // options sweeps

  // US equities + growth
  'amitisinvesting',     // fundamentals, growth
  'aleabitoreddit',      // retail sentiment aggregator
  'StockMKTNewz',        // breaking market news
  'TraderLion',          // growth stocks, breakouts

  // Macro + rates
  'ReformedBroker',      // Josh Brown — broad market
  'MrTopStep',           // S&P futures, macro
  'LizAnnSonders',       // Schwab chief strategist
  'zerohedge',           // macro / contrarian

  // Technical analysis
  'NorthmanTrader',      // technical analysis, SPX
  'alphatrends',         // technical + tape reading
]

const COOKIE_KEY = 'research:twitter:cookies'
const COOKIE_TTL = 23 * 60 * 60 // 23 hours

function unique(items) {
  return [...new Set(items.filter(Boolean))]
}

function encodeCookieString(key, value) {
  if (!key || value == null || value === '') return null
  return `${key}=${value}; Domain=.twitter.com; Path=/; Secure`
}

function normalizeCookieCandidate(cookie) {
  if (!cookie) return null
  if (typeof cookie === 'string') return cookie.trim() || null

  const key = cookie.key ?? cookie.name
  const value = cookie.value
  if (!key || value == null || value === '') return null

  const parts = [`${key}=${value}`]
  if (cookie.domain) parts.push(`Domain=${cookie.domain}`)
  parts.push(`Path=${cookie.path || '/'}`)
  if (cookie.secure !== false) parts.push('Secure')
  if (cookie.httpOnly) parts.push('HttpOnly')

  const expires = cookie.expires && cookie.expires !== 'Infinity'
    ? new Date(cookie.expires)
    : null
  if (expires && !Number.isNaN(expires.getTime())) {
    parts.push(`Expires=${expires.toUTCString()}`)
  }

  return parts.join('; ')
}

export function parseTwitterCookieInput(raw) {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return unique(parsed.map(normalizeCookieCandidate))
    }
  } catch {
    // Fall through. The env may already be a cookie header string.
  }

  return unique(
    String(raw)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean),
  )
}

export function getTwitterCookieStrings(env = process.env) {
  const direct = [
    ...parseTwitterCookieInput(env.TWITTER_COOKIES_JSON),
    ...parseTwitterCookieInput(env.TWITTER_COOKIES_BASE64 ? Buffer.from(env.TWITTER_COOKIES_BASE64, 'base64').toString('utf8') : ''),
  ]

  const tokenCookies = [
    encodeCookieString('auth_token', env.TWITTER_AUTH_TOKEN),
    encodeCookieString('ct0', env.TWITTER_CT0),
  ]

  return unique([
    ...direct,
    ...tokenCookies,
  ])
}

function passwordEnvLooksSwapped(env = process.env) {
  return Boolean(
    env.TWITTER_PASSWORD?.includes('@')
    && env.TWITTER_EMAIL
    && !env.TWITTER_EMAIL.includes('@'),
  )
}

function twitterAuthHint(err) {
  const message = err?.message ?? String(err)
  if (
    message.includes('guest/activate')
    || message.includes('"code":34')
    || message.includes('Authentication error (34)')
    || message.includes('Sorry, that page does not exist')
  ) {
    return 'X/Twitter blocked password login during guest-token bootstrap. Prefer TWITTER_COOKIES_JSON or TWITTER_AUTH_TOKEN + TWITTER_CT0.'
  }
  return message
}

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

async function collectAsync(gen, limit) {
  const results = []
  for await (const item of gen) {
    results.push(item)
    if (results.length >= limit) break
  }
  return results
}

async function rememberCookies(scraper, redis) {
  if (!redis) return
  const cookies = await scraper.getCookies()
  const cookieStrings = cookies.map(normalizeCookieCandidate).filter(Boolean)
  if (cookieStrings.length > 0) {
    await redis.set(COOKIE_KEY, JSON.stringify(cookieStrings), { ex: COOKIE_TTL })
  }
}

async function tryCookieLogin(scraper, cookieStrings, redis) {
  if (!cookieStrings.length) return false
  await scraper.setCookies(cookieStrings)
  const loggedIn = await scraper.isLoggedIn()
  if (loggedIn) {
    await rememberCookies(scraper, redis)
    return true
  }
  return false
}

async function buildScraper() {
  const scraper = new Scraper()

  const redis = getRedis()
  if (redis) {
    const cached = await redis.get(COOKIE_KEY)
    if (cached) {
      try {
        const cookies = Array.isArray(cached)
          ? cached
          : parseTwitterCookieInput(typeof cached === 'string' ? cached : JSON.stringify(cached))
        if (await tryCookieLogin(scraper, cookies, redis)) return scraper
      } catch {
        // stale cookies — fall through to fresh login
      }
    }
  }

  const envCookies = getTwitterCookieStrings()
  if (envCookies.length > 0 && await tryCookieLogin(scraper, envCookies, redis)) {
    return scraper
  }

  const {
    TWITTER_USERNAME,
    TWITTER_PASSWORD,
    TWITTER_EMAIL,
    TWITTER_2FA_SECRET,
  } = process.env
  if (!TWITTER_USERNAME || !TWITTER_PASSWORD) {
    throw new Error(
      'Twitter auth not configured. Set TWITTER_COOKIES_JSON or TWITTER_AUTH_TOKEN/TWITTER_CT0, or provide TWITTER_USERNAME and TWITTER_PASSWORD.',
    )
  }

  if (passwordEnvLooksSwapped()) {
    console.warn('[twitterScraper] TWITTER_PASSWORD looks like an email address and TWITTER_EMAIL does not. Check your env values.')
  }

  try {
    await scraper.login(TWITTER_USERNAME, TWITTER_PASSWORD, TWITTER_EMAIL, TWITTER_2FA_SECRET)
  } catch (err) {
    throw new Error(twitterAuthHint(err))
  }

  await rememberCookies(scraper, redis)

  return scraper
}

export async function scrapeFinanceTweets() {
  let scraper
  try {
    scraper = await buildScraper()
  } catch (err) {
    console.error('[twitterScraper] login failed:', err.message)
    return []
  }

  const allTweets = []

  for (const username of TARGET_ACCOUNTS) {
    try {
      const tweets = await collectAsync(scraper.getTweets(username, 20), 20)
      for (const tweet of tweets) {
        allTweets.push({
          id:        tweet.id ?? tweet.id_str,
          text:      tweet.text ?? tweet.full_text ?? '',
          username,
          createdAt: tweet.createdAt ?? tweet.created_at ?? null,
        })
      }
    } catch (err) {
      console.error(`[twitterScraper] failed for @${username}:`, err.message)
    }
  }

  return allTweets
}
