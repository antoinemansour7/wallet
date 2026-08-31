// ─── twitterapi.io provider ────────────────────────────────────────────────────
// Drop-in replacement for the official X API read path, ~30x cheaper
// ($0.15/1k posts vs $5/1k). Every function here returns records already shaped
// like X API v2 objects, so toSignal() and everything downstream stays unchanged.
//
// Verified live 2026-08-31: timestamps match X's snowflake IDs to the second,
// and the search endpoint honours lang:en, -is:retweet and since_time.
//
// Known differences from the official API, handled here:
//   - Response nests posts under data.tweets (the published docs say `tweets`).
//   - Metrics are flat camelCase (likeCount) not nested snake_case.
//   - Pages are 20 posts and the timeline endpoint has no date filter, so the
//     30h window is applied client-side while paginating.
//   - entities.cashtags is never returned; extractTickersFromText() already
//     recovers $TICKER from the post body, so nothing is lost.
// ────────────────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.TWITTERAPI_IO_BASE || 'https://api.twitterapi.io'
const PAGE_SIZE = 20

// Free accounts are capped at 0.2 QPS (one request per 5s); any paid credit
// raises this to 200+ QPS. Default to no delay and let free-tier users opt in.
const REQUEST_DELAY_MS = Number(process.env.TWITTERAPI_IO_DELAY_MS || 0)
const MAX_PAGES = Number(process.env.TWITTERAPI_IO_MAX_PAGES || 3)

export function isConfigured() {
  return Boolean(process.env.TWITTERAPI_IO_KEY)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let lastRequestAt = 0

async function apiGet(path, params = {}) {
  const key = process.env.TWITTERAPI_IO_KEY
  if (!key) throw new Error('TWITTERAPI_IO_KEY is not set')

  if (REQUEST_DELAY_MS > 0) {
    const elapsed = Date.now() - lastRequestAt
    if (lastRequestAt && elapsed < REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS - elapsed)
  }
  lastRequestAt = Date.now()

  const url = new URL(path, BASE_URL)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }

  const res = await fetch(url, {
    headers: { 'x-api-key': key },
    signal: AbortSignal.timeout(20000),
  })

  const bodyText = await res.text()
  let body = {}
  try { body = bodyText ? JSON.parse(bodyText) : {} } catch { body = { msg: bodyText } }

  if (!res.ok) {
    // 402 means the credit balance is empty — worth naming explicitly, since a
    // generic failure here is what let the previous provider die unnoticed.
    const detail = body.msg || body.message || `HTTP ${res.status}`
    throw new Error(res.status === 402 ? `twitterapi.io out of credits: ${detail}` : detail)
  }
  if (body.status === 'error') throw new Error(body.msg || body.message || 'provider returned status=error')

  return body
}

// The provider returns posts under data.tweets; older docs promise a top-level
// `tweets`. Accept either rather than trusting one.
function readTweets(body) {
  const list = body?.data?.tweets ?? body?.tweets ?? []
  return Array.isArray(list) ? list : []
}

function readCursor(body) {
  const hasNext = body?.has_next_page ?? body?.data?.has_next_page
  const cursor = body?.next_cursor ?? body?.data?.next_cursor
  return hasNext && cursor ? cursor : null
}

/** Reshape one twitterapi.io post into the X API v2 shape toSignal() expects. */
export function normalizeTweet(raw) {
  const created = Date.parse(raw.createdAt ?? raw.created_at)
  return {
    id: String(raw.id),
    text: raw.text || '',
    created_at: Number.isFinite(created) ? new Date(created).toISOString() : null,
    lang: raw.lang,
    public_metrics: {
      like_count: raw.likeCount ?? 0,
      retweet_count: raw.retweetCount ?? 0,
      reply_count: raw.replyCount ?? 0,
      quote_count: raw.quoteCount ?? 0,
    },
    // cashtags are absent upstream; hashtags/urls/mentions pass through as-is
    entities: raw.entities || {},
    username: raw.author?.userName || raw.author?.username || '',
    isReply: Boolean(raw.isReply),
    isRetweet: Boolean(raw.retweeted_tweet),
  }
}

function withinWindow(record, sinceMs) {
  if (!sinceMs) return true
  const t = Date.parse(record.created_at)
  return Number.isFinite(t) ? t >= sinceMs : true
}

/**
 * Posts from one account's timeline, newest first.
 * Mirrors the official call's `exclude: 'replies,retweets'`, and stops as soon
 * as a page falls out of the window so we never pay for posts we would bin.
 */
export async function fetchUserTweets({ username, sinceMs, maxPosts = 25 }) {
  const collected = []
  let cursor = ''

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await apiGet('/twitter/user/last_tweets', {
      userName: username,
      cursor,
      includeReplies: 'false',
    })

    const raw = readTweets(body)
    if (raw.length === 0) break

    let exhausted = false
    for (const item of raw) {
      const record = normalizeTweet(item)
      if (!withinWindow(record, sinceMs)) { exhausted = true; continue }
      if (record.isReply || record.isRetweet) continue
      collected.push(record)
    }

    if (exhausted || collected.length >= maxPosts) break
    cursor = readCursor(body)
    if (!cursor) break
    // A short page means there is nothing more to walk.
    if (raw.length < PAGE_SIZE) break
  }

  return collected.slice(0, maxPosts)
}

/**
 * Recent search. The provider takes the time bound inside the query string as a
 * unix `since_time:` operator rather than as a separate parameter.
 */
export async function searchTweets({ query, sinceMs, maxPosts = 20 }) {
  const bounded = sinceMs
    ? `${query} since_time:${Math.floor(sinceMs / 1000)}`
    : query

  const collected = []
  let cursor = ''

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await apiGet('/twitter/tweet/advanced_search', {
      query: bounded,
      queryType: 'Latest',
      cursor,
    })

    const raw = readTweets(body)
    if (raw.length === 0) break

    for (const item of raw) {
      const record = normalizeTweet(item)
      if (!withinWindow(record, sinceMs)) continue
      if (record.isRetweet) continue
      collected.push(record)
    }

    if (collected.length >= maxPosts) break
    cursor = readCursor(body)
    if (!cursor || raw.length < PAGE_SIZE) break
  }

  return collected.slice(0, maxPosts)
}
