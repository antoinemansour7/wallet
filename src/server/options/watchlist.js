import { digest } from '../research/archive.js'

export const OPTIONS_WATCHLIST_VERSION = 'options-watchlist-2026-09-22-v1'
export const OPTIONS_WATCHLIST_SOURCE = Object.freeze({
  provider: 'cboe',
  url: 'https://cdn.cboe.com/data/us/options/market_statistics/symbol_reference/cone-underlying.csv',
  retrievedAt: '2026-09-22T00:00:00.000Z',
  sha256: '1cf90860e2740c71c88e91d4cc90c091a3558d44e1573e948ab50b2ddf98d718',
})

const securities = [
  ['SNDK', 'SanDisk Corp', 'sandisk', 'common'],
  ['ASTS', 'AST SpaceMobile Inc Class A', 'ast-spacemobile', 'class-a'],
  ['MU', 'Micron Technology Inc', 'micron-technology', 'common'],
  ['RKLB', 'Rocket Lab Corp', 'rocket-lab', 'common'],
  ['MRVL', 'Marvell Technology Inc', 'marvell-technology', 'common'],
  ['IREN', 'IREN Limited', 'iren-limited', 'ordinary'],
  ['CRDO', 'Credo Technology Group Holding Ltd', 'credo-technology-group', 'ordinary'],
  ['SOFI', 'SoFi Technologies Inc', 'sofi-technologies', 'common'],
  ['CRWV', 'CoreWeave Inc Class A', 'coreweave', 'class-a'],
  ['SPCX', 'Space Exploration Technologies Corp Class A', 'space-exploration-technologies', 'class-a'],
  ['NBIS', 'Nebius Group N.V. Class A', 'nebius-group', 'class-a'],
  ['PLTR', 'Palantir Technologies Inc Class A', 'palantir-technologies', 'class-a'],
  ['HOOD', 'Robinhood Markets Inc Class A', 'robinhood-markets', 'class-a'],
  ['NVDA', 'NVIDIA Corp', 'nvidia', 'common'],
  ['AMD', 'Advanced Micro Devices Inc', 'advanced-micro-devices', 'common'],
  ['ORCL', 'Oracle Corp', 'oracle', 'common'],
  ['MSTR', 'Strategy Inc Class A', 'strategy', 'class-a'],
  ['AVGO', 'Broadcom Inc', 'broadcom', 'common'],
  ['VST', 'Vistra Corp', 'vistra', 'common'],
  ['INTC', 'Intel Corp', 'intel', 'common'],
  ['SMCI', 'Super Micro Computer Inc', 'super-micro-computer', 'common'],
  ['NOW', 'ServiceNow Inc', 'servicenow', 'common'],
  ['APP', 'AppLovin Corp Class A', 'applovin', 'class-a'],
  ['AMZN', 'Amazon.com Inc', 'amazon', 'common'],
  ['AAOI', 'Applied Optoelectronics Inc', 'applied-optoelectronics', 'common'],
].map(([ticker, name, issuer, shareClass]) => Object.freeze({
  ticker,
  name,
  issuerId: `wallai:issuer:${issuer}`,
  securityId: `wallai:security:${issuer}:${shareClass}`,
  optionClass: ticker,
  optionType: 'standard',
  exerciseStyle: 'american',
  settlementStyle: 'physical',
  observedFrom: OPTIONS_WATCHLIST_SOURCE.retrievedAt,
  tickerValidFrom: ticker === 'SPCX' ? '2026-06-12T00:00:00.000Z' : null,
  identityBoundary: ticker === 'SPCX' ? 'Do not join to any predecessor that previously used SPCX.' : null,
}))

export const OPTIONS_WATCHLIST_SNAPSHOT = Object.freeze({
  version: OPTIONS_WATCHLIST_VERSION,
  asOf: OPTIONS_WATCHLIST_SOURCE.retrievedAt,
  availableAt: OPTIONS_WATCHLIST_SOURCE.retrievedAt,
  source: OPTIONS_WATCHLIST_SOURCE,
  securities: Object.freeze(securities),
})

export const OPTIONS_CONTEXTUAL_CORRECTIONS = Object.freeze({
  AVGOVST: Object.freeze({ symbols: Object.freeze(['AVGO', 'VST']), reason: 'Verified concatenation of two separately supplied watchlist symbols.' }),
  AMZ: Object.freeze({ symbols: Object.freeze(['AMZN']), reason: 'Verified only in the Options Opportunity Scanner source request.' }),
})

const tokenPattern = /^[A-Z][A-Z0-9.-]{0,14}$/

function inputTokens(input) {
  if (Array.isArray(input)) return input.map(String)
  if (typeof input === 'string') return input.split(/[\s,]+/)
  throw new TypeError('Watchlist input must be a string or an array')
}

export function normalizeOptionsWatchlist(input, { allowContextualCorrections = false, snapshot = OPTIONS_WATCHLIST_SNAPSHOT } = {}) {
  const known = new Set(snapshot.securities.map((security) => security.ticker))
  const accepted = []
  const corrections = []
  const rejected = []

  for (const originalValue of inputTokens(input)) {
    const original = originalValue.trim()
    if (!original) continue
    const token = original.toUpperCase()
    if (!tokenPattern.test(token)) {
      rejected.push({ original, normalized: token, reason: 'invalid_symbol_format' })
      continue
    }
    if (known.has(token)) {
      accepted.push(token)
      continue
    }
    const correction = OPTIONS_CONTEXTUAL_CORRECTIONS[token]
    if (correction && allowContextualCorrections) {
      accepted.push(...correction.symbols)
      corrections.push({ original, symbols: [...correction.symbols], reason: correction.reason })
      continue
    }
    rejected.push({ original, normalized: token, reason: correction ? 'contextual_correction_requires_opt_in' : 'unknown_symbol' })
  }

  return { symbols: [...new Set(accepted)], corrections, rejected }
}

export function assertOptionsWatchlist(input, options) {
  const result = normalizeOptionsWatchlist(input, options)
  if (result.rejected.length) {
    const error = new Error(`Unresolved options watchlist symbols: ${result.rejected.map((item) => item.original).join(', ')}`)
    error.code = 'OPTIONS_WATCHLIST_REJECTED'
    error.rejected = result.rejected
    throw error
  }
  return result
}

export function createOptionsIdentityRegistry(snapshots = [OPTIONS_WATCHLIST_SNAPSHOT]) {
  const ordered = [...snapshots].sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt))
  for (const snapshot of ordered) {
    if (!snapshot.version || !Number.isFinite(Date.parse(snapshot.availableAt))) throw new Error('Invalid options identity snapshot')
    const tickers = snapshot.securities.map((security) => security.ticker)
    if (new Set(tickers).size !== tickers.length) throw new Error('Options identity snapshot contains duplicate tickers')
  }

  const snapshotAt = (asOf) => ordered.filter((snapshot) => Date.parse(snapshot.availableAt) <= new Date(asOf).getTime()).at(-1) ?? null
  function resolve({ ticker, securityId, issuerId, asOf = Date.now() }) {
    const snapshot = snapshotAt(asOf)
    if (!snapshot) return []
    const time = new Date(asOf).getTime()
    return snapshot.securities.filter((security) => (!ticker || security.ticker === String(ticker).trim().toUpperCase())
      && (!securityId || security.securityId === securityId)
      && (!issuerId || security.issuerId === issuerId)
      && (!security.tickerValidFrom || Date.parse(security.tickerValidFrom) <= time)
      && (!security.tickerValidThrough || Date.parse(security.tickerValidThrough) >= time))
  }
  return { snapshots: ordered, snapshotAt, resolve }
}

export function createOptionsIdentitySnapshot({ securities: nextSecurities, source, availableAt, version }) {
  if (!Array.isArray(nextSecurities) || !nextSecurities.length) throw new Error('Options identity refresh requires securities')
  if (!source?.provider || !source?.url || !Number.isFinite(Date.parse(source.retrievedAt))) throw new Error('Options identity refresh requires dated source evidence')
  if (!Number.isFinite(Date.parse(availableAt))) throw new Error('Options identity refresh requires availableAt')
  const seenTickers = new Set(), seenIds = new Set()
  const normalized = nextSecurities.map((security) => {
    const ticker = String(security.ticker || '').trim().toUpperCase()
    if (!tokenPattern.test(ticker) || !security.securityId || !security.issuerId) throw new Error('Options identity refresh contains an unresolved security')
    if (seenTickers.has(ticker) || seenIds.has(security.securityId)) throw new Error('Options identity refresh contains duplicate identity')
    seenTickers.add(ticker); seenIds.add(security.securityId)
    return { ...security, ticker }
  })
  const snapshot = { version, asOf: availableAt, availableAt, source, securities: normalized }
  return { ...snapshot, snapshotId: digest(snapshot) }
}

export function watchlistSnapshotId(snapshot = OPTIONS_WATCHLIST_SNAPSHOT) {
  return digest(snapshot)
}
