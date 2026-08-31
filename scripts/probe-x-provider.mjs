/**
 * twitterapi.io feasibility probe.
 *
 * Answers the one thing the docs do not: is the data fresh enough, and does it
 * actually cover the 16 curated accounts the research pipeline depends on?
 *
 * Costs roughly 5 cents to run (17 requests, ~20 posts each at $0.15/1k).
 * Touches nothing in production — read-only, standalone.
 *
 *   TWITTERAPI_IO_KEY=xxx node scripts/probe-x-provider.mjs
 *   TWITTERAPI_IO_KEY=xxx node scripts/probe-x-provider.mjs --json
 */
import { CURATED_ACCOUNTS } from '../src/server/xSignals.js'

const API_KEY = process.env.TWITTERAPI_IO_KEY
const BASE = process.env.TWITTERAPI_IO_BASE || 'https://api.twitterapi.io'
const WINDOW_HOURS = 30 // must match SIGNAL_MAX_AGE_MS in xSignals.js
// Billing is per request, not per post: every observed call cost a flat 300
// credits whether it returned 20 posts or 2. Pricing only the posts we chose
// to keep understated the real cost roughly fourfold.
const CREDITS_PER_REQUEST = 300
const USD_PER_CREDIT = 0.00001 // 1M credits per USD 10
const JSON_OUT = process.argv.includes('--json')

if (!API_KEY) {
  console.error('TWITTERAPI_IO_KEY is not set.\n')
  console.error('  Windows PowerShell:  $env:TWITTERAPI_IO_KEY="your_key"; node scripts/probe-x-provider.mjs')
  console.error('  bash:                TWITTERAPI_IO_KEY=your_key node scripts/probe-x-provider.mjs')
  process.exit(1)
}

let requestCount = 0
let postCount = 0

// Free tier allows one request every 5 seconds; bursting earns a 429.
const QPS_DELAY_MS = Number(process.env.TWITTERAPI_IO_DELAY_MS || 5200)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastRequestAt = 0

async function get(path, params) {
  const url = new URL(path, BASE)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const since = Date.now() - lastRequestAt
  if (lastRequestAt && since < QPS_DELAY_MS) await sleep(QPS_DELAY_MS - since)
  lastRequestAt = Date.now()
  requestCount += 1
  const res = await fetch(url, {
    headers: { 'x-api-key': API_KEY },
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = { raw: text } }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.message || body.msg || text.slice(0, 160)}`)
  if (body.status === 'error') throw new Error(body.message || 'provider returned status=error')
  return body
}

// The provider returns createdAt as "Tue Dec 10 07:00:30 +0000 2024" (Twitter's
// legacy format). Date.parse handles it, but guard anyway.
function ageHours(createdAt) {
  const t = Date.parse(createdAt)
  if (!Number.isFinite(t)) return null
  return (Date.now() - t) / 36e5
}

function fmtAge(h) {
  if (h == null) return 'unparseable'
  if (h < 1) return `${Math.round(h * 60)}m ago`
  if (h < 48) return `${h.toFixed(1)}h ago`
  return `${(h / 24).toFixed(1)}d ago`
}

async function probeAccount(account) {
  const row = { username: account.username, ok: false }
  try {
    const body = await get('/twitter/user/last_tweets', { userName: account.username })
    const tweets = body.data?.tweets || body.tweets || []
    postCount += tweets.length
    if (tweets.length === 0) return { ...row, error: 'no tweets returned' }

    const ages = tweets.map((t) => ageHours(t.createdAt || t.created_at)).filter((a) => a != null)
    const inWindow = ages.filter((a) => a <= WINDOW_HOURS).length
    const sample = tweets[0]

    return {
      ...row,
      ok: true,
      returned: tweets.length,
      newest: ages.length ? Math.min(...ages) : null,
      inWindow,
      // If the whole page is inside the window, one page is not enough coverage.
      pageSaturated: inWindow === tweets.length,
      hasText: Boolean(sample.text),
      hasLang: Boolean(sample.lang),
      hasMetrics: sample.likeCount != null || sample.public_metrics != null,
      hasCashtags: Boolean(sample.entities?.cashtags?.length),
    }
  } catch (err) {
    return { ...row, error: err.message }
  }
}

// Does the search endpoint honour the operators the pipeline's queries rely on?
async function probeSearch() {
  const sinceTime = Math.floor((Date.now() - WINDOW_HOURS * 36e5) / 1000)
  const query = '("options sweep" OR "unusual volume" OR "dark pool" OR "short squeeze") lang:en -is:retweet'
  try {
    const body = await get('/twitter/tweet/advanced_search', {
      query: `${query} since_time:${sinceTime}`,
      queryType: 'Latest',
    })
    const tweets = body.data?.tweets || body.tweets || []
    postCount += tweets.length
    if (tweets.length === 0) return { ok: false, error: 'no results' }

    const ages = tweets.map((t) => ageHours(t.createdAt || t.created_at)).filter((a) => a != null)
    const nonEnglish = tweets.filter((t) => t.lang && t.lang !== 'en').length
    const retweets = tweets.filter((t) => t.retweeted_tweet || /^RT @/.test(t.text || '')).length
    const outsideWindow = ages.filter((a) => a > WINDOW_HOURS).length

    return {
      ok: true,
      returned: tweets.length,
      newest: ages.length ? Math.min(...ages) : null,
      nonEnglish,
      retweets,
      outsideWindow,
      langHonoured: nonEnglish === 0,
      noRetweetHonoured: retweets === 0,
      sinceTimeHonoured: outsideWindow === 0,
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

const accounts = []
for (const account of CURATED_ACCOUNTS) {
  accounts.push(await probeAccount(account))
}
const search = await probeSearch()

if (JSON_OUT) {
  console.log(JSON.stringify({ accounts, search, requestCount, postCount }, null, 2))
  process.exit(0)
}

const pad = (s, n) => String(s).padEnd(n)
console.log(`\ntwitterapi.io probe — ${WINDOW_HOURS}h window, ${new Date().toISOString()}\n`)
console.log(`${pad('ACCOUNT', 20)}${pad('STATUS', 9)}${pad('GOT', 5)}${pad('NEWEST', 12)}${pad('IN 30h', 8)}NOTE`)
console.log('-'.repeat(72))

let live = 0
let fresh = 0
let totalInWindow = 0

for (const a of accounts) {
  if (!a.ok) {
    console.log(`${pad('@' + a.username, 20)}${pad('FAIL', 9)}${pad('-', 5)}${pad('-', 12)}${pad('-', 8)}${a.error}`)
    continue
  }
  live += 1
  totalInWindow += a.inWindow
  const isFresh = a.newest != null && a.newest <= WINDOW_HOURS
  if (isFresh) fresh += 1
  const note = a.pageSaturated ? 'needs pagination' : isFresh ? '' : 'STALE'
  console.log(
    `${pad('@' + a.username, 20)}${pad(isFresh ? 'ok' : 'stale', 9)}${pad(a.returned, 5)}` +
    `${pad(fmtAge(a.newest), 12)}${pad(a.inWindow, 8)}${note}`,
  )
}

console.log('\nSEARCH ENDPOINT')
if (!search.ok) {
  console.log(`  FAILED: ${search.error}`)
} else {
  console.log(`  returned          ${search.returned} posts, newest ${fmtAge(search.newest)}`)
  console.log(`  lang:en honoured  ${search.langHonoured ? 'yes' : `NO (${search.nonEnglish} non-English)`}`)
  console.log(`  -is:retweet       ${search.noRetweetHonoured ? 'yes' : `NO (${search.retweets} retweets)`}`)
  console.log(`  since_time        ${search.sinceTimeHonoured ? 'yes' : `NO (${search.outsideWindow} outside window)`}`)
}

const sample = accounts.find((a) => a.ok)
console.log('\nFIELD COVERAGE (first live account)')
if (sample) {
  console.log(`  text ${sample.hasText ? 'yes' : 'NO'} | lang ${sample.hasLang ? 'yes' : 'NO'} | ` +
    `metrics ${sample.hasMetrics ? 'yes' : 'NO'} | cashtags ${sample.hasCashtags ? 'yes' : 'no (regex fallback covers this)'}`)
}

const probeCredits = requestCount * CREDITS_PER_REQUEST
console.log('')
console.log('COST')
console.log('  this probe        ' + requestCount + ' requests, ' + postCount + ' posts, '
  + probeCredits + ' credits (USD ' + (probeCredits * USD_PER_CREDIT).toFixed(3) + ')')
console.log('  scope             the probe reads one page per account and skips the search')
console.log('                    lane, so this is not the pipeline cost. The nightly run')
console.log('                    logs its own as "[xSignals] provider spend".')

console.log('\nVERDICT')
console.log(`  ${live}/${accounts.length} accounts reachable, ${fresh}/${accounts.length} fresh inside ${WINDOW_HOURS}h`)
const verdict = live === accounts.length && fresh >= accounts.length * 0.75 && search.ok
console.log(`  ${verdict ? 'PASS — worth building the adapter' : 'REVIEW — see failures above before committing'}\n`)
