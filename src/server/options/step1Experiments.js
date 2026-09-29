import { digest } from '../research/archive.js'
import { buildOptionsShortlist } from './shortlist.js'
import { horizonEvents } from './scoring.js'
import { resolveOptionsHoldingExit } from './scenarios.js'
import { marketDay, OPTIONS_CALENDAR_2026, regularSessionClose } from './calendar.js'

export const STEP1_EXPERIMENT_POLICY = Object.freeze({
  version: 'options-step1-experiments-v1', maxCandidates: 15, holdSessions: 3,
  // All arms use fresh quotes from this separate scan, including the controls.
  entryWindow: '09:36–09:50 America/New_York', maxConcurrency: 2,
  // Scoring is CPU-bound, so a scan that outgrows one function run continues
  // on QStash's retries (2, 30 s apart) while the window has room for one.
  maxAttempts: 3, minRetryWindowMs: 90000,
  // Stop scanning this long before the attempt's deadline so the checkpoint
  // is returned (and saved) before the scheduler's timer abandons it.
  returnReserveMs: 30000,
  note: 'Exploratory, correlated comparisons. No automatic promotion or probability-of-profit claim.',
})

export const STEP1_EXPERIMENTS = Object.freeze([
  { id: 'current10', label: 'Current score · 10', control: null },
  { id: 'current15', label: 'Current score · 15', control: 'current10' },
  { id: 'ranks11_15', label: 'Current ranks 11–15', control: 'current10' },
  { id: 'no_regime15', label: 'No regime in Step 1 · 15', control: 'current15' },
  { id: 'no_regime_both', label: 'No regime in either step · 15', control: 'current15' },
  { id: 'all_calls', label: 'All eligible stocks · calls', control: null },
  { id: 'all_puts', label: 'All eligible stocks · puts', control: null },
  { id: 'all_both', label: 'All eligible stocks · both directions', control: null },
  { id: 'earnings_up', label: 'Verified earnings + gap up · calls', control: 'all_calls' },
  { id: 'earnings_down', label: 'Verified earnings + gap down · puts', control: 'all_puts' },
  { id: 'gap15', label: 'Unusual overnight gap · both directions', control: 'all_both' },
  { id: 'volume15', label: 'Prior-session volume surge · both directions', control: 'all_both' },
  { id: 'news15', label: 'Company news surge · both directions', control: 'all_both' },
  { id: 'movement15', label: 'Gap + volume + news · both directions', control: 'all_both' },
  { id: 'movement_trend60', label: 'Gap + volume + news · 60-day trend', control: 'movement15' },
])

function previousCloseAt(date, calendar) {
  for (let back = 1; back <= 10; back += 1) {
    const prior = new Date(Date.parse(`${date}T12:00:00Z`) - back * 86400000).toISOString().slice(0, 10)
    if (marketDay(prior, calendar).open) return regularSessionClose(prior, calendar)
  }
  return null
}

export function step1Signals(record, calendar = OPTIONS_CALENDAR_2026) {
  const gap = record.underlying?.premarketMovePct
  const scale = record.technicals?.overnightGapRms20dPct
  const freeze = Date.parse(record.freezeAt)
  const priorClose = previousCloseAt(record.tradingDate, calendar)
  const release = record.events?.earnings?.find((event) => event.status === 'reported' && event.confirmation === 'reported'
    && priorClose && Date.parse(event.publicAt) > Date.parse(priorClose) && Date.parse(event.publicAt) <= freeze)
  let newsRatio = null
  if (record.coverage?.news?.status === 'complete') {
    const counts = Array(21).fill(0)
    const seen = new Set()
    for (const item of record.evidence?.news || []) {
      // Multi-company mentions are excluded from the company-specific signal.
      if (item.symbolCount !== 1) continue
      const age = freeze - Date.parse(item.publishedAt)
      const key = `${item.headline.toLowerCase().trim()}:${item.publishedAt.slice(0, 10)}`
      if (seen.has(key) || age < 0 || age >= 21 * 86400000) continue
      seen.add(key)
      counts[Math.floor(age / 86400000)] += 1
    }
    newsRatio = (counts[0] + 1) / (counts.slice(1).reduce((sum, count) => sum + count, 0) / 20 + 1)
  }
  return { gapPct: Number.isFinite(gap) ? gap : null,
    gapRatio: Number.isFinite(gap) && scale > 0 ? Math.abs(gap) / scale : null,
    volumeRatio: record.technicals?.priorSessionVolumeRatio ?? null, newsRatio,
    trend60Pct: record.technicals?.return60dPct ?? null,
    verifiedRelease: release || null, regimeScore: record.regime?.score ?? null }
}

export function buildStep1Experiments({ snapshot, watchlist, calendar = OPTIONS_CALENDAR_2026 }) {
  const exit = resolveOptionsHoldingExit(snapshot.tradingDate, STEP1_EXPERIMENT_POLICY.holdSessions)
  if (!exit) throw new Error('experiment_horizon_outside_calendar')
  const eligible = snapshot.securities.filter((record) => record.underlying?.premarketPrice > 0
    && !horizonEvents({ features: record, tradingDate: snapshot.tradingDate, exitDate: exit.exitDate, expirationDate: exit.exitDate }).inHorizon.length)
  const signals = Object.fromEntries(eligible.map((record) => [record.security.securityId, step1Signals(record, calendar)]))
  const current = buildOptionsShortlist({ snapshot, watchlist, maxCandidates: 15 }).candidates
  const withoutRegime = buildOptionsShortlist({ snapshot: { ...snapshot, securities: snapshot.securities.map((record) => ({ ...record, regime: null })) },
    watchlist, maxCandidates: 15 }).candidates
  const both = (record) => ['call', 'put'].map((direction) => ({ securityId: record.security.securityId, ticker: record.security.ticker, direction }))
  const one = (record, direction) => ({ securityId: record.security.securityId, ticker: record.security.ticker, direction })
  const pick = (list) => list.map(({ securityId, ticker, direction }) => ({ securityId, ticker, direction }))
  const bySignal = (name) => eligible.filter((record) => Number.isFinite(signals[record.security.securityId][name]))
    .sort((a, b) => signals[b.security.securityId][name] - signals[a.security.securityId][name]
      || digest([snapshot.tradingDate, a.security.securityId]).localeCompare(digest([snapshot.tradingDate, b.security.securityId])))
  const complete = eligible.filter((record) => ['gapRatio', 'volumeRatio', 'newsRatio'].every((key) => Number.isFinite(signals[record.security.securityId][key])))
  // Equal-weight cross-sectional percentiles: no clipped caps, fitted weights,
  // or dimensional mixing of news counts and percentage stock returns.
  for (const record of complete) {
    const value = signals[record.security.securityId]
    value.movement = ['gapRatio', 'volumeRatio', 'newsRatio'].reduce((sum, key) => sum + complete.reduce((total, other) => {
      const compare = signals[other.security.securityId][key]
      return total + (compare < value[key] ? 1 : compare === value[key] ? 0.5 : 0)
    }, 0) / complete.length, 0) / 3
  }
  const movement = bySignal('movement').slice(0, 15)
  const lists = {
    current10: pick(current.slice(0, 10)), current15: pick(current), ranks11_15: pick(current.slice(10, 15)),
    no_regime15: pick(withoutRegime), no_regime_both: pick(withoutRegime),
    all_calls: eligible.map((record) => one(record, 'call')), all_puts: eligible.map((record) => one(record, 'put')), all_both: eligible.flatMap(both),
    earnings_up: eligible.filter((record) => { const s = signals[record.security.securityId]; return s.verifiedRelease && s.gapPct > 0 }).map((record) => one(record, 'call')),
    earnings_down: eligible.filter((record) => { const s = signals[record.security.securityId]; return s.verifiedRelease && s.gapPct < 0 }).map((record) => one(record, 'put')),
    gap15: bySignal('gapRatio').slice(0, 15).flatMap(both), volume15: bySignal('volumeRatio').slice(0, 15).flatMap(both),
    news15: bySignal('newsRatio').slice(0, 15).flatMap(both), movement15: movement.flatMap(both),
    movement_trend60: movement.filter((record) => Number.isFinite(signals[record.security.securityId].trend60Pct) && signals[record.security.securityId].trend60Pct !== 0)
      .map((record) => one(record, signals[record.security.securityId].trend60Pct > 0 ? 'call' : 'put')),
  }
  return { policyVersion: STEP1_EXPERIMENT_POLICY.version, featureSnapshotId: snapshot.snapshotId, freezeAt: snapshot.freezeAt,
    tradingDate: snapshot.tradingDate, exitAt: exit.exitAt, signals,
    arms: STEP1_EXPERIMENTS.map((arm) => ({ ...arm, requested: lists[arm.id],
      signalCoverage: { eligibleStocks: eligible.length, withGap: bySignal('gapRatio').length, withVolume: bySignal('volumeRatio').length,
        withNews: bySignal('newsRatio').length, withAllSignals: complete.length } })) }
}
