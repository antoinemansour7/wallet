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

// Exhaust all pages. Publish a snapshot only after the complete fetch succeeds;
// a provider outage must not make half the universe disappear.
export async function refreshSecurityMaster(archive, { date = new Date().toISOString().slice(0, 10), fetchImpl = fetch, now = () => new Date().toISOString() } = {}) {
  const key = process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY
  if (!key) throw new Error('A Massive/Polygon reference-data key is required for stable security identifiers')
  const base = process.env.POLYGON_API_BASE_URL || process.env.MASSIVE_API_BASE_URL || 'https://api.massive.com'
  let url = new URL('/v3/reference/tickers', base)
  url.search = new URLSearchParams({ market: 'stocks', locale: 'us', type: 'CS', active: 'true', limit: '1000', date }).toString()
  const rows = [], seen = new Set()
  while (url) {
    if (seen.has(url.href) || seen.size >= 100) throw new Error('Invalid security-master pagination')
    seen.add(url.href)
    const response = await fetchImpl(url.href, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`Security reference data failed (${response.status})`)
    const payload = await response.json()
    if (!Array.isArray(payload.results)) throw new Error('Invalid security reference response')
    rows.push(...payload.results)
    if (payload.next_url) {
      const next = new URL(payload.next_url, base)
      if (next.origin !== new URL(base).origin) throw new Error('Untrusted reference pagination URL')
      next.searchParams.delete('apiKey')
      url = next
    } else url = null
  }
  const securities = rows.map(referenceSecurity).filter(Boolean)
  if (!securities.length) throw new Error('Reference provider returned no resolvable US common stocks')
  const capturedAt = now()
  const snapshot = { asOf: `${date}T23:59:59.999Z`, capturedAt, availableAt: capturedAt, securities,
    dataVersion: DATA_VERSION, provider: 'massive-reference', rejectedRows: rows.length - securities.length }
  // Today's snapshot is usable immediately; historical snapshots are explicitly
  // end-of-day identity observations, not an intraday mapping reconstruction.
  if (date === capturedAt.slice(0, 10)) snapshot.asOf = capturedAt
  const id = digest(snapshot)
  await archive.put('master', id, snapshot, 'masters', capturedAt)
  return snapshot
}
export async function loadSecurityMaster(archive, asOf = Date.now()) {
  return createSecurityMaster(await archive.list('masters', asOf))
}
