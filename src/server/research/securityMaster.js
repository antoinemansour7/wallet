import { AsyncLocalStorage } from 'node:async_hooks'
import { digest } from './archive.js'
import { DATA_VERSION } from './policy.js'

const context = new AsyncLocalStorage()
export const withSecurityMaster = (master, fn) => context.run(master, fn)
export const currentSecurityMaster = () => context.getStore()
export const issuerId = (cik) => /^\d{1,10}$/.test(String(cik)) ? `cik:${String(cik).padStart(10, '0')}` : null

export function createSecurityMaster(snapshots) {
  const ordered = [...snapshots].sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf))
  const snapshotAt = (asOf) => ordered.filter((s) => Date.parse(s.asOf) <= new Date(asOf).getTime()).at(-1)
  function securities(asOf = Date.now()) { return snapshotAt(asOf)?.securities || [] }
  function resolve({ ticker, issuer, securityId, exchange, asOf = Date.now() }) {
    return securities(asOf).filter((s) => (!ticker || s.ticker === String(ticker).trim().toUpperCase())
      && (!issuer || s.issuerId === (String(issuer).startsWith('cik:') ? issuer : issuerId(issuer)))
      && (!securityId || s.securityId === securityId) && (!exchange || s.exchange === exchange))
  }
  function text(text, asOf = Date.now()) {
    const content = String(text || '')
    const found = new Map()
    const add = (matches) => { if (matches.length === 1) found.set(matches[0].securityId, matches[0]) }
    // Match explicit references against the master, never a financial stoplist.
    for (const match of content.matchAll(/\$([A-Za-z][A-Za-z0-9.-]{0,14})\b/g)) add(resolve({ ticker: match[1], asOf }))
    for (const match of content.matchAll(/\b(NASDAQ|NYSE|AMEX|XNAS|XNYS|XASE)\s*:\s*([A-Za-z][A-Za-z0-9.-]{0,14})\b/g)) {
      const exchange = ({ NASDAQ: 'XNAS', NYSE: 'XNYS', AMEX: 'XASE' })[match[1]] || match[1]
      add(resolve({ ticker: match[2], exchange, asOf }))
    }
    // Exact company names need a unique security; dual classes stay ambiguous.
    const names = new Map()
    for (const s of securities(asOf)) {
      const name = s.name.toLowerCase()
      if (!names.has(name)) names.set(name, [])
      names.get(name).push(s)
    }
    const lower = content.toLowerCase()
    for (const [name, matches] of names) if (name.length > 3 && lower.includes(name)) {
      const at = lower.indexOf(name)
      if (!/[a-z0-9]/.test(lower[at - 1] || '') && !/[a-z0-9]/.test(lower[at + name.length] || '')) add(matches)
    }
    return [...found.values()]
  }
  return { resolve, securities, text, snapshots: ordered }
}

export function referenceSecurity(row) {
  if (row.market !== 'stocks' || row.locale !== 'us' || row.type !== 'CS' || row.active !== true) return null
  const issuer = issuerId(row.cik)
  if (!issuer || !row.composite_figi || !row.primary_exchange || !row.currency_name || !row.ticker || !row.name) return null
  return {
    securityId: `figi:${row.composite_figi}`, issuerId: issuer,
    shareClassId: row.share_class_figi ? `figi:${row.share_class_figi}` : null,
    ticker: row.ticker, name: row.name, exchange: row.primary_exchange,
    currency: row.currency_name.toUpperCase(), type: 'common_stock', countryOfListing: 'US',
  }
}

export const MASTER_MAX_AGE_MS = 30 * 86400000
export const MASTER_REFRESH_KEY = 'research:master:refresh:v1'
const REQUEST_INTERVAL_MS = 13000 // Basic: five requests/minute, with margin.

// A refresh can span daily runs. The last complete snapshot stays usable until
// every page of a single dated reference query has been captured successfully.
export async function refreshSecurityMaster(archive, {
  date = new Date().toISOString().slice(0, 10), fetchImpl = fetch,
  now = () => new Date().toISOString(), pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  redis, deadline = Date.parse(now()) + 120000,
} = {}) {
  const key = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY
  if (!key) throw new Error('A free Massive Basic reference-data key is required for stable security identifiers')
  const base = new URL(process.env.MASSIVE_API_BASE_URL || process.env.POLYGON_API_BASE_URL || 'https://api.massive.com')
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Reference endpoint must use HTTPS')
  const cleanUrl = (value) => {
    const url = new URL(value, base)
    if (url.origin !== base.origin || url.username || url.password) throw new Error('Untrusted reference pagination URL')
    url.searchParams.delete('apiKey')
    return url.href
  }
  const first = new URL('/v3/reference/tickers', base)
  first.search = new URLSearchParams({ market: 'stocks', locale: 'us', type: 'CS', active: 'true', limit: '1000', date, sort: 'ticker', order: 'asc' }).toString()
  let state = await redis?.get(MASTER_REFRESH_KEY)
  // Cursors are temporary; restart an abandoned build, never expire a published master.
  if (!state || state.origin !== base.origin || Date.parse(now()) - Date.parse(state.startedAt) > 7 * 86400000) {
    state = { origin: base.origin, date, startedAt: now(), url: first.href, securities: [], rejectedRows: 0, seen: [], nextRequestAt: 0 }
  }
  const save = () => redis?.set(MASTER_REFRESH_KEY, state, { ex: 7 * 86400 })
  const deferred = () => ({ complete: false, pages: state.seen.length, nextRequestAt: state.nextRequestAt })
  while (state.url) {
    const url = cleanUrl(state.url)
    if (state.seen.includes(url) || state.seen.length >= 100) throw new Error('Invalid security-master pagination')
    let payload
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(0, state.nextRequestAt - Date.parse(now()))
      if (Date.parse(now()) + wait + 20000 > deadline) { await save(); return deferred() }
      if (wait) await pause(wait)
      state.nextRequestAt = Date.parse(now()) + REQUEST_INTERVAL_MS
      await save()
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000), redirect: 'error' })
      if (response.status === 429) {
        const header = response.headers?.get('retry-after')
        const seconds = header == null ? NaN : Number(header)
        const retryAt = Number.isFinite(seconds) ? Date.parse(now()) + seconds * 1000 : Date.parse(header)
        state.nextRequestAt = Math.max(state.nextRequestAt, Number.isFinite(retryAt) ? retryAt : Date.parse(now()) + 60000)
        await save()
        if (attempt >= 2) return deferred()
        continue
      }
      if (!response.ok) throw new Error(`Security reference data failed (${response.status})`)
      payload = await response.json()
      break
    }
    if (!Array.isArray(payload.results)) throw new Error('Invalid security reference response')
    const next = payload.next_url ? cleanUrl(payload.next_url) : null
    const securities = payload.results.map(referenceSecurity).filter(Boolean)
    state.securities.push(...securities)
    state.rejectedRows += payload.results.length - securities.length
    state.seen.push(url)
    state.url = next
    await save()
  }
  if (!state.securities.length) throw new Error('Reference provider returned no resolvable US common stocks')
  const capturedAt = now()
  const snapshot = { asOf: `${state.date}T23:59:59.999Z`, capturedAt, availableAt: capturedAt, securities: state.securities,
    dataVersion: DATA_VERSION, provider: 'massive-reference', rejectedRows: state.rejectedRows }
  if (state.date === capturedAt.slice(0, 10)) snapshot.asOf = capturedAt
  const id = digest(snapshot)
  await archive.put('master', id, snapshot, 'masters', capturedAt)
  await redis?.del(MASTER_REFRESH_KEY)
  return { ...snapshot, complete: true }
}
export async function loadSecurityMaster(archive, asOf = Date.now()) {
  // One indexed read, rather than loading every historical universe each night.
  const snapshot = await archive.latest('masters', asOf)
  return createSecurityMaster(snapshot ? [snapshot] : [])
}
