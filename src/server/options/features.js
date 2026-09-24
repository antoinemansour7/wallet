import { digest } from '../research/archive.js'
import { createOptionsAuditRecord } from './audit.js'

export const OPTIONS_FEATURE_VERSION = 'options-point-in-time-features-v2'
export const OPTIONS_FEATURE_SOURCE_POLICY = Object.freeze({
  version: 'options-feature-sources-phase0-v2',
  mode: 'free-validation',
  feeds: Object.freeze({
    underlying: Object.freeze({ providers: ['alpaca'], licenseIds: ['alpaca-basic-indicative'] }),
    bars: Object.freeze({ providers: ['alpaca'], licenseIds: ['alpaca-basic-indicative'] }),
    news: Object.freeze({ providers: ['alpaca', 'fixture'], licenseIds: ['alpaca-basic-news', 'test-fixture'] }),
    sec: Object.freeze({ providers: ['sec'], licenseIds: ['sec-edgar-public'] }),
    analyst: Object.freeze({ providers: ['fixture'], licenseIds: ['test-fixture'] }),
    earnings: Object.freeze({ providers: ['nasdaq', 'alpaca', 'fixture'], licenseIds: ['nasdaq-public-calendar', 'alpaca-basic-news', 'test-fixture'] }),
    dividends: Object.freeze({ providers: ['alpaca', 'fixture'], licenseIds: ['alpaca-corporate-actions', 'test-fixture'] }),
    rates: Object.freeze({ providers: ['federal-reserve', 'fixture'], licenseIds: ['federal-reserve-public', 'test-fixture'] }),
    catalysts: Object.freeze({ providers: ['issuer', 'sec', 'fixture'], licenseIds: ['issuer-primary', 'sec-edgar-public', 'test-fixture'] }),
    regime: Object.freeze({ providers: ['wallai', 'fixture'], licenseIds: ['derived-licensed-inputs', 'test-fixture'] }),
  }),
})

const FEEDS = Object.freeze(Object.keys(OPTIONS_FEATURE_SOURCE_POLICY.feeds))
const COVERAGE = new Set(['complete', 'partial', 'unavailable', 'unknown'])
const EARNINGS_TIMES = Object.freeze({
  BO: 'before_open', BMO: 'before_open', BEFORE_OPEN: 'before_open',
  AC: 'after_close', AMC: 'after_close', AFTER_CLOSE: 'after_close',
  UNKNOWN: 'unknown',
})
const DAY = 86400000

function instant(value, field) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) throw new Error(`${field} must be a valid timestamp`)
  return new Date(time).toISOString()
}

function date(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${field} must be an ISO date`)
  }
  return value
}

function finite(value) {
  return Number.isFinite(value) ? value : null
}

function round(value, digits = 6) {
  return value == null ? null : Number(value.toFixed(digits))
}

function sourceFor(observation, feed) {
  const source = observation?.source
  if (!source?.provider || !source?.licenseId || !source?.url) throw new Error(`${feed} observation requires provider, licenseId and URL`)
  const policy = OPTIONS_FEATURE_SOURCE_POLICY.feeds[feed]
  if (!policy.providers.includes(source.provider) || !policy.licenseIds.includes(source.licenseId)) {
    throw new Error(`${feed} observation source is not allowed by ${OPTIONS_FEATURE_SOURCE_POLICY.version}`)
  }
  return { provider: source.provider, licenseId: source.licenseId, url: source.url }
}

function relevant(observation, security) {
  if (observation.securityId) return observation.securityId === security.securityId
  if (observation.issuerId) return observation.issuerId === security.issuerId
  return observation.ticker === security.ticker
}

function visible(observation, freezeTime) {
  return Number.isFinite(Date.parse(observation.availableAt)) && Date.parse(observation.availableAt) <= freezeTime
}

function normalizeCoverage(feed, supplied, hasVisible) {
  const status = supplied?.status || (hasVisible ? 'partial' : 'unknown')
  if (!COVERAGE.has(status)) throw new Error(`Invalid ${feed} coverage status`)
  const source = supplied?.source ? sourceFor({ source: supplied.source }, feed) : null
  return {
    status,
    reason: supplied?.reason || (status === 'unknown' ? 'feed_coverage_not_reported' : null),
    asOf: supplied?.asOf ? instant(supplied.asOf, `${feed} coverage asOf`) : null,
    source,
    ...(supplied?.from ? { from: date(supplied.from, 'coverage from') } : {}),
    ...(supplied?.through ? { through: date(supplied.through, 'coverage through') } : {}),
  }
}

function revisionId(feed, item) {
  return item.revisionId || digest([feed, item.eventId || item.documentId || item.id, item.availableAt, item])
}

function selectedRevisions(feed, items, security, freezeTime) {
  const selected = new Map()
  for (const item of items || []) {
    if (!relevant(item, security) || !visible(item, freezeTime)) continue
    sourceFor(item, feed)
    const key = item.eventId || item.documentId || item.id
    if (!key) throw new Error(`${feed} observation requires an event or document ID`)
    const prior = selected.get(key)
    if (!prior || Date.parse(item.availableAt) > Date.parse(prior.availableAt)) selected.set(key, item)
  }
  return [...selected.values()].sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt))
    .map((item) => ({ ...item, revisionId: revisionId(feed, item), source: sourceFor(item, feed) }))
}

function priorSessionBars(items, security, freezeTime, tradingDate) {
  const byDate = new Map()
  for (const item of items || []) {
    if (!relevant(item, security) || !visible(item, freezeTime) || item.date >= tradingDate) continue
    date(item.date, 'bar date')
    sourceFor(item, 'bars')
    if (!Number.isFinite(item.close) || item.close <= 0) continue
    const prior = byDate.get(item.date)
    if (!prior || Date.parse(item.availableAt) > Date.parse(prior.availableAt)) byDate.set(item.date, item)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function change(closes, bars) {
  if (closes.length < bars + 1) return null
  const previous = closes.at(-(bars + 1))
  return previous > 0 ? ((closes.at(-1) - previous) / previous) * 100 : null
}

function realizedVolatility(closes, periods = 20) {
  if (closes.length < periods + 1) return null
  const sample = closes.slice(-(periods + 1))
  const returns = sample.slice(1).map((value, index) => Math.log(value / sample[index]))
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252) * 100
}

function technicalFeatures(bars, benchmarkBars) {
  const closes = bars.map((item) => item.close)
  const benchmark = benchmarkBars.map((item) => item.close)
  const last = closes.at(-1) ?? null
  const sma20 = closes.length >= 20 ? closes.slice(-20).reduce((sum, value) => sum + value, 0) / 20 : null
  const return5d = change(closes, 5)
  const return20d = change(closes, 20)
  const benchmark20d = change(benchmark, 20)
  const overnightGaps = bars.slice(-21).slice(1).map((bar, index) => {
    const previous = bars.slice(-21)[index].close
    return Number.isFinite(bar.open) && previous > 0 ? (bar.open / previous - 1) * 100 : null
  }).filter(Number.isFinite)
  const priorVolumes = bars.slice(-21, -1).map((bar) => bar.volume).filter(Number.isFinite)
  const volumeMean = priorVolumes.length === 20 ? priorVolumes.reduce((a, b) => a + b, 0) / 20 : null
  return {
    laggedThrough: bars.at(-1)?.date || null,
    historySessions: closes.length,
    return5dPct: round(return5d),
    return20dPct: round(return20d),
    return60dPct: round(change(closes, 60)),
    overnightGapRms20dPct: overnightGaps.length === 20 ? round(Math.sqrt(overnightGaps.reduce((sum, gap) => sum + gap * gap, 0) / 20)) : null,
    priorSessionVolumeRatio: volumeMean > 0 && Number.isFinite(bars.at(-1)?.volume) ? round(bars.at(-1).volume / volumeMean) : null,
    relativeStrength20dPct: return20d == null || benchmark20d == null ? null : round(return20d - benchmark20d),
    realizedVolatility20dPct: round(realizedVolatility(closes)),
    distanceFromSma20Pct: last == null || sma20 == null ? null : round(((last - sma20) / sma20) * 100),
  }
}

function currentUnderlying(items, security, freezeTime) {
  const candidates = (items || []).filter((item) => relevant(item, security) && visible(item, freezeTime))
    .sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt))
  const item = candidates.at(-1)
  if (!item) return null
  sourceFor(item, 'underlying')
  const bid = finite(item.quote?.bid)
  const ask = finite(item.quote?.ask)
  const price = finite(item.price) ?? (bid != null && ask != null ? (bid + ask) / 2 : finite(item.trade?.price))
  if (price == null || price <= 0) return null
  return {
    price: round(price),
    marketAt: item.marketAt || item.quote?.marketAt || item.trade?.marketAt || null,
    availableAt: instant(item.availableAt, 'underlying availableAt'),
    source: sourceFor(item, 'underlying'),
    pricingReady: item.pricingReady === true,
  }
}

function newsItems(items, security, freezeTime) {
  return selectedRevisions('news', items, security, freezeTime).filter((item) => {
    const published = Date.parse(item.publishedAt)
    if (!Number.isFinite(published)) throw new Error('news observation requires publishedAt')
    return published <= freezeTime
  }).map((item) => ({
    eventId: item.eventId || item.id,
    headline: item.headline || '',
    symbolCount: item.symbolCount ?? null,
    publishedAt: instant(item.publishedAt, 'news publishedAt'),
    availableAt: instant(item.availableAt, 'news availableAt'),
    revisionId: item.revisionId,
    source: item.source,
  }))
}

function secItems(items, security, freezeTime) {
  return selectedRevisions('sec', items, security, freezeTime).filter((item) => {
    const published = Date.parse(item.publicAt)
    if (!Number.isFinite(published)) throw new Error('SEC observation requires publicAt')
    return published <= freezeTime
  }).map((item) => ({
    documentId: item.documentId || item.id,
    accession: item.accession || null,
    form: item.form || null,
    publicAt: instant(item.publicAt, 'SEC publicAt'),
    availableAt: instant(item.availableAt, 'SEC availableAt'),
    revisionId: item.revisionId,
    source: item.source,
  }))
}

function genericEvents(feed, items, security, freezeTime) {
  return selectedRevisions(feed, items, security, freezeTime)
    .filter((item) => !item.publicAt || Date.parse(instant(item.publicAt, `${feed} publicAt`)) <= freezeTime)
    .map((item) => ({
    eventId: item.eventId || item.id,
    eventDate: date(item.eventDate, `${feed} eventDate`),
    // Only the three states horizonEvents reads; anything else is unknown.
    timing: ['before_open', 'after_close'].includes(item.timing) ? item.timing : 'unknown',
    kind: item.kind || feed,
    label: item.label || '',
    publicAt: item.publicAt ? instant(item.publicAt, `${feed} publicAt`) : null,
    availableAt: instant(item.availableAt, `${feed} availableAt`),
    revisionId: item.revisionId,
    supersedesRevisionId: item.supersedesRevisionId || null,
    source: item.source,
  }))
}

function earningsEvents(items, security, freezeTime) {
  return selectedRevisions('earnings', items, security, freezeTime)
    .filter((item) => !item.publicAt || Date.parse(instant(item.publicAt, 'earnings publicAt')) <= freezeTime)
    .map((item) => {
    const rawTiming = String(item.timing || 'unknown').trim().toUpperCase().replaceAll(' ', '_')
    const timing = EARNINGS_TIMES[rawTiming]
    if (!timing) throw new Error(`Unsupported earnings timing: ${item.timing}`)
    return {
      eventId: item.eventId || item.id,
      eventDate: date(item.eventDate, 'earnings eventDate'),
      timing,
      status: item.status || 'scheduled',
      confirmation: item.confirmation || 'unknown',
      ...(item.headline ? { headline: item.headline } : {}),
      publicAt: item.publicAt ? instant(item.publicAt, 'earnings publicAt') : null,
      availableAt: instant(item.availableAt, 'earnings availableAt'),
      revisionId: item.revisionId,
      supersedesRevisionId: item.supersedesRevisionId || null,
      source: item.source,
    }
  })
}

function dividendEvents(items, security, freezeTime) {
  return selectedRevisions('dividends', items, security, freezeTime)
    .filter((item) => !item.publicAt || Date.parse(instant(item.publicAt, 'dividend publicAt')) <= freezeTime)
    .map((item) => ({
    eventId: item.eventId || item.id,
    exDate: date(item.exDate, 'dividend exDate'),
    paymentDate: item.paymentDate ? date(item.paymentDate, 'dividend paymentDate') : null,
    amount: finite(item.amount),
    currency: item.currency || 'USD',
    availableAt: instant(item.availableAt, 'dividend availableAt'),
    revisionId: item.revisionId,
    supersedesRevisionId: item.supersedesRevisionId || null,
    source: item.source,
  }))
}

function rateObservations(items, freezeTime) {
  return selectedRevisions('rates', items, {}, freezeTime).map((item) => ({
    eventId: item.eventId || item.id,
    tenor: item.tenor,
    ratePct: finite(item.ratePct),
    asOfDate: date(item.asOfDate, 'rate asOfDate'),
    availableAt: instant(item.availableAt, 'rate availableAt'),
    revisionId: item.revisionId,
    source: item.source,
  }))
}

export function evaluateNonEventHorizon({ earnings, catalysts, coverage, tradingDate }, { holdingDays = 5 } = {}) {
  if (!Number.isInteger(holdingDays) || holdingDays < 1) throw new Error('holdingDays must be a positive integer')
  const through = new Date(Date.parse(`${tradingDate}T00:00:00Z`) + holdingDays * DAY).toISOString().slice(0, 10)
  const known = [
    ...earnings.map((item) => ({ type: 'earnings', eventId: item.eventId, date: item.eventDate })),
    ...catalysts.map((item) => ({ type: item.kind, eventId: item.eventId, date: item.eventDate })),
  ].filter((item) => item.date >= tradingDate && item.date <= through)
  if (known.length) return { state: 'excluded', holdingDays, through, reasons: known }
  const incomplete = ['earnings', 'catalysts'].filter((feed) => coverage[feed].status !== 'complete')
  if (incomplete.length) return { state: 'unknown', holdingDays, through, reasons: incomplete.map((feed) => ({ type: 'coverage', feed, status: coverage[feed].status })) }
  return { state: 'eligible', holdingDays, through, reasons: [] }
}

function directionFeatures(technicals, premarketMovePct) {
  const raw = {
    premarketMovePct,
    return5dPct: technicals.return5dPct,
    return20dPct: technicals.return20dPct,
    relativeStrength20dPct: technicals.relativeStrength20dPct,
  }
  const call = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value]))
  const put = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value == null ? null : round(-value)]))
  return { call, put }
}

export function createOptionsFeatureSnapshot({
  securities,
  freezeAt,
  tradingDate,
  inputs = {},
  coverage: suppliedCoverage = {},
  benchmarkSecurityId = 'benchmark:SPY',
  nonEventHoldingDays = 5,
  mode = 'live',
} = {}) {
  if (!Array.isArray(securities) || !securities.length) throw new Error('Options features require securities')
  if (new Set(securities.map((item) => item.securityId)).size !== securities.length) throw new Error('Options features require unique security identities')
  const frozenAt = instant(freezeAt, 'freezeAt')
  const freezeTime = Date.parse(frozenAt)
  date(tradingDate, 'tradingDate')
  if (!['live', 'replay'].includes(mode)) throw new Error('Options feature mode must be live or replay')
  const rates = rateObservations(inputs.rates || [], freezeTime)

  const records = securities.map((security) => {
    if (!security.securityId || !security.issuerId || !security.ticker) throw new Error('Options feature security identity is incomplete')
    const bars = priorSessionBars(inputs.bars, security, freezeTime, tradingDate)
    const benchmarkBars = priorSessionBars(inputs.bars, { securityId: benchmarkSecurityId }, freezeTime, tradingDate)
    const underlying = currentUnderlying(inputs.underlyings, security, freezeTime)
    const technicals = technicalFeatures(bars, benchmarkBars)
    const previousClose = bars.at(-1)?.close ?? null
    const premarketMovePct = underlying && previousClose ? round(((underlying.price - previousClose) / previousClose) * 100) : null
    const news = newsItems(inputs.news, security, freezeTime)
    const sec = secItems(inputs.sec, security, freezeTime)
    const analyst = genericEvents('analyst', inputs.analyst, security, freezeTime)
    const earnings = earningsEvents(inputs.earnings, security, freezeTime)
    const dividends = dividendEvents(inputs.dividends, security, freezeTime)
    const catalysts = genericEvents('catalysts', inputs.catalysts, security, freezeTime)
    const regime = selectedRevisions('regime', inputs.regime, security, freezeTime).at(-1) || null
    const itemCounts = { underlying: underlying ? 1 : 0, bars: bars.length, news: news.length, sec: sec.length, analyst: analyst.length,
      earnings: earnings.length, dividends: dividends.length, rates: rates.length, catalysts: catalysts.length, regime: regime ? 1 : 0 }
    const coverage = Object.fromEntries(FEEDS.map((feed) => [feed, normalizeCoverage(feed, suppliedCoverage[security.securityId]?.[feed] || suppliedCoverage[feed], itemCounts[feed] > 0)]))
    const nonEventHorizon = evaluateNonEventHorizon({ earnings, catalysts, coverage, tradingDate }, { holdingDays: nonEventHoldingDays })
    const missing = []
    if (previousClose == null) missing.push({ path: 'underlying.previousClose', reason: 'no_prior_session_bar' })
    if (!underlying) missing.push({ path: 'underlying.premarketPrice', reason: 'no_point_in_time_underlying_observation' })
    for (const [key, value] of Object.entries(technicals)) if (value == null) missing.push({ path: `technicals.${key}`, reason: 'insufficient_lagged_history' })
    for (const feed of FEEDS) if (coverage[feed].status !== 'complete') missing.push({ path: `coverage.${feed}`, reason: coverage[feed].reason || `coverage_${coverage[feed].status}` })
    const record = {
      schemaVersion: 'options-security-features-v1',
      featureVersion: OPTIONS_FEATURE_VERSION,
      sourcePolicyVersion: OPTIONS_FEATURE_SOURCE_POLICY.version,
      mode,
      freezeAt: frozenAt,
      tradingDate,
      security: { securityId: security.securityId, issuerId: security.issuerId, ticker: security.ticker },
      underlying: { previousClose, premarketPrice: underlying?.price ?? null, premarketMovePct, observation: underlying },
      technicals,
      regime: regime ? { score: finite(regime.score), label: regime.label || null, availableAt: instant(regime.availableAt, 'regime availableAt'), revisionId: regime.revisionId, source: regime.source } : null,
      evidence: { news, sec, analyst },
      events: { earnings, dividends, catalysts },
      pricingInputs: { rates },
      coverage,
      nonEventHorizon,
      directional: directionFeatures(technicals, premarketMovePct),
      missing,
    }
    return { ...record, recordId: digest(record) }
  })

  const snapshot = {
    schemaVersion: 'options-feature-snapshot-v1',
    featureVersion: OPTIONS_FEATURE_VERSION,
    sourcePolicyVersion: OPTIONS_FEATURE_SOURCE_POLICY.version,
    mode,
    freezeAt: frozenAt,
    tradingDate,
    securities: records,
  }
  if (mode === 'live') {
    const fixturePath = JSON.stringify(snapshot).includes('"provider":"fixture"')
    if (fixturePath) throw new Error('Fixture observations are only allowed in replay mode')
  }
  return { ...snapshot, snapshotId: digest(snapshot) }
}

function collectNulls(value, path = 'payload', output = []) {
  if (value === null) { output.push({ path, reason: 'not_observed_at_freeze' }); return output }
  if (!value || typeof value !== 'object') return output
  for (const [key, child] of Object.entries(value)) collectNulls(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, output)
  return output
}

export function createOptionsFeatureAuditRecord({ snapshot, scanId } = {}) {
  if (snapshot?.schemaVersion !== 'options-feature-snapshot-v1' || !snapshot.snapshotId) throw new Error('Feature audit requires a completed snapshot')
  const payload = { snapshotId: snapshot.snapshotId, freezeAt: snapshot.freezeAt, tradingDate: snapshot.tradingDate, securities: snapshot.securities }
  return createOptionsAuditRecord({
    type: 'evidence',
    scanId,
    availableAt: snapshot.freezeAt,
    source: { provider: 'wallai', feed: 'point-in-time-feature-bundle', session: 'premarket', entitlement: snapshot.mode === 'replay' ? 'replay-fixtures' : 'mixed-free-public' },
    versions: { code: OPTIONS_FEATURE_VERSION, model: 'deterministic-no-model', policy: OPTIONS_FEATURE_SOURCE_POLICY.version },
    inputHashes: snapshot.securities.map((record) => record.recordId),
    payload,
    missing: collectNulls(payload),
  })
}

export function planCurrentDaySecRefresh({ securities, freezeAt, completed = [], securityMaster } = {}) {
  if (!Array.isArray(securities)) throw new Error('SEC refresh plan requires securities')
  const cutoff = instant(freezeAt, 'freezeAt')
  const completedIssuers = new Set(completed.filter((item) => Date.parse(item.completedAt) <= Date.parse(cutoff)
    && item.tradingDate === cutoff.slice(0, 10)).map((item) => item.secIssuerId))
  const requests = []
  const unresolved = []
  const planned = new Set()
  for (const security of securities) {
    const matches = security.secIssuerId ? [{ issuerId: security.secIssuerId }]
      : securityMaster?.resolve?.({ ticker: security.ticker, asOf: cutoff }) || []
    if (matches.length !== 1 || !/^cik:\d{10}$/.test(matches[0].issuerId || '')) {
      unresolved.push({ securityId: security.securityId, issuerId: security.issuerId, ticker: security.ticker, reason: matches.length > 1 ? 'ambiguous_sec_identity' : 'sec_identity_unresolved' })
      continue
    }
    const secIssuerId = matches[0].issuerId
    if (planned.has(secIssuerId) || completedIssuers.has(secIssuerId)) continue
    planned.add(secIssuerId)
    requests.push({ secIssuerId, issuerId: security.issuerId, ticker: security.ticker, through: cutoff, reason: 'current_day_refresh_required' })
  }
  return { through: cutoff, requests, unresolved }
}

export async function attachOptionsNarrative(record, generate) {
  if (typeof generate !== 'function') return { record, narrative: null, diagnostic: { code: 'narrative_not_configured' } }
  try {
    const narrative = await generate(structuredClone(record))
    const allowed = new Set([
      ...record.evidence.news.map((item) => item.source.url),
      ...record.evidence.sec.map((item) => item.source.url),
      ...record.evidence.analyst.map((item) => item.source.url),
      ...record.events.earnings.map((item) => item.source.url),
      ...record.events.catalysts.map((item) => item.source.url),
    ])
    const links = Array.isArray(narrative?.sourceUrls) ? narrative.sourceUrls : []
    if (links.some((url) => !allowed.has(url))) throw new Error('Narrative cited a source outside the frozen record')
    return { record, narrative: { text: String(narrative?.text || ''), sourceUrls: links }, diagnostic: null }
  } catch (error) {
    return { record, narrative: null, diagnostic: { code: 'narrative_unavailable', message: String(error?.message || error) } }
  }
}
