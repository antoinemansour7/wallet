import { digest } from '../research/archive.js'
import { createOutcomeCapturePlan, OPTIONS_OBSERVATION_POLICY } from './observations.js'
import { marketDay } from './calendar.js'
import { OPTIONS_REPLAY_VERSIONS, replayOptionsScan, timestamp } from './evaluationReplay.js'

export const OPTIONS_EVALUATION_POLICY = Object.freeze({
  version: 'options-evaluation-v1', endpointSessions: [0, 1, 3, 5, 10],
  premiumTargetsPct: [25, 50, 100], stopLossPct: -25, timeExitSessions: 3,
  multiplier: 100, feePerSide: 0.70, slippagePerShare: 0.01,
  quoteToleranceMs: 30000, purgeSessions: 10, embargoSessions: 10,
  match: { delta: 0.10, dte: 7, spreadPct: 5 }, bootstrapReplicates: 300,
})
const finite = Number.isFinite
const round = (n) => finite(n) ? Number(n.toFixed(6)) : null
const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
const mid = (q) => q && finite(q.bid) && finite(q.ask) && q.bid >= 0 && q.ask >= q.bid && q.ask > 0 ? (q.bid + q.ask) / 2 : null
const spread = (q) => mid(q) > 0 ? round(100 * (q.ask - q.bid) / mid(q)) : null
const change = (a, b) => finite(a) && a > 0 && finite(b) ? round(100 * (b / a - 1)) : null

function quoteProblem(point, at, policy) {
  if (!point) return 'missing_exit_quote'
  if (point.status && point.status !== 'observed') return point.status
  const q = point.quote
  if (mid(q) == null) return 'invalid_quote'
  if (q.bid === 0) return 'zero_bid'
  if (!(q.bidSize >= 1 && q.askSize >= 1)) return 'insufficient_size'
  const age = timestamp(at) - timestamp(q.marketAt)
  if (age < 0 || age > policy.quoteToleranceMs) return 'stale_quote'
  return null
}

export function evaluateOptionsOutcome({ plan, entry, observations = [], asOf, policy = OPTIONS_EVALUATION_POLICY }) {
  const now = timestamp(asOf), start = timestamp(plan.entryAt)
  if (quoteProblem(entry, plan.entryAt, policy)) throw new Error('Entry requires a valid observed ask quote')
  const cost = entry.quote.ask * policy.multiplier + policy.slippagePerShare * policy.multiplier + policy.feePerSide
  const returnFor = (bid) => 100 * ((Math.max(0, bid - policy.slippagePerShare) * policy.multiplier - policy.feePerSide) / cost - 1)
  const worstCase = round(returnFor(0))
  const seen = new Set()
  const points = observations.filter((p) => {
    if (p.contractId !== plan.contract.contractId || p.securityId !== plan.contract.securityId || p.issuerId !== plan.contract.issuerId) throw new Error('Outcome identity mismatch')
    const at = timestamp(p.at)
    if (seen.has(at)) throw new Error('Duplicate outcome timestamp')
    seen.add(at)
    return at >= start && at <= now && timestamp(p.availableAt) <= now
  }).sort((a, b) => timestamp(a.at) - timestamp(b.at))
  const sample = (p, at) => {
    const reason = quoteProblem(p, at, policy)
    return { at, observedAt: p?.at || null, status: reason || 'observed', returnPct: reason ? null : round(returnFor(p.quote.bid)),
      midpointReturnPct: reason ? null : change(mid(entry.quote), mid(p.quote)), worstCaseReturnPct: worstCase,
      underlyingMovePct: change(entry.underlyingPrice, p?.underlyingPrice),
      ivChange: finite(entry.iv) && finite(p?.iv) ? round(p.iv - entry.iv) : null,
      spreadPct: spread(p?.quote), bidSize: p?.quote?.bidSize ?? null, askSize: p?.quote?.askSize ?? null, volume: p?.volume ?? null }
  }
  const atTarget = (at) => {
    const t = timestamp(at)
    return points.filter((p) => timestamp(p.at) <= t && t - timestamp(p.at) <= policy.quoteToleranceMs).at(-1)
  }
  const endpoints = plan.endpointTargets.map((target) => {
    const key = target.kind === 'expiry_close' ? 'expiry' : String(target.sessionOffset)
    if (target.status === 'unavailable') return { key, status: target.reason, returnPct: null, worstCaseReturnPct: worstCase }
    if (timestamp(target.scheduledAt) > now) return { key, at: target.scheduledAt, status: 'unexpired_horizon', returnPct: null, worstCaseReturnPct: worstCase }
    return { key, ...sample(atTarget(target.scheduledAt), target.scheduledAt) }
  })
  const expiryTarget = plan.endpointTargets.find((t) => t.kind === 'expiry_close')
  const lastTarget = Math.max(start, ...plan.endpointTargets.filter((t) => t.scheduledAt).map((t) => timestamp(t.scheduledAt)))
  const path = points.filter((p) => timestamp(p.at) <= lastTarget).map((p) => sample(p, p.at))
  const observed = path.filter((p) => p.returnPct != null)
  const scheduled = [...plan.pathSampling.samples, ...plan.endpointTargets.filter((t) => t.scheduledAt)]
    .filter((t) => timestamp(t.scheduledAt) <= now)
  const covered = scheduled.filter((t) => [null, 'zero_bid'].includes(quoteProblem(atTarget(t.scheduledAt), t.scheduledAt, policy))).length
  const values = observed.map((p) => p.returnPct)
  const drawdownBefore = (hit) => hit ? round(Math.min(0, ...observed.filter((p) => timestamp(p.at) < timestamp(hit.at)).map((p) => p.returnPct))) : null
  const firstGain = observed.find((p) => p.returnPct > 0)
  const targets = policy.premiumTargetsPct.map((targetPct) => {
    const hit = observed.find((p) => p.returnPct >= targetPct)
    return { targetPct, state: hit ? 'observed_hit' : 'unknown', at: hit?.at || null,
      minutesToTarget: hit ? round((timestamp(hit.at) - start) / 60000) : null,
      returnPct: hit?.returnPct ?? null, drawdownBeforeTargetPct: drawdownBefore(hit) }
  })
  const timeExit = endpoints.find((p) => p.key === String(policy.timeExitSessions))
  const exitAt = timeExit?.at ? timestamp(timeExit.at) : Infinity
  const strategies = policy.premiumTargetsPct.map((targetPct) => {
    const hit = observed.find((p) => timestamp(p.at) <= exitAt && (p.returnPct >= targetPct || p.returnPct <= policy.stopLossPct))
    const priorGap = hit && path.some((p) => timestamp(p.at) <= timestamp(hit.at) && p.returnPct == null)
    return { targetPct, trigger: hit ? hit.returnPct >= targetPct ? 'target' : 'stop' : 'time',
      ...(hit || timeExit || { status: 'missing_time_exit', returnPct: null }),
      execution: 'first_observed_bid_not_guaranteed_fill', pathUncertain: covered < scheduled.length || Boolean(priorGap) }
  })
  const itm = (p) => finite(p.underlyingPrice) && (plan.contract.type === 'call'
    ? p.underlyingPrice > plan.contract.strikePrice : p.underlyingPrice < plan.contract.strikePrice)
  const relevantPoints = points.filter((p) => timestamp(p.at) <= lastTarget)
  const expiry = expiryTarget?.scheduledAt ? atTarget(expiryTarget.scheduledAt) : null
  const fullyFollowedExpiry = Boolean(expiry && timestamp(expiryTarget.scheduledAt) <= now
    && plan.pathSampling.through >= expiryTarget.tradingDate && covered === scheduled.length
    && expiry.settlement?.status === 'confirmed' && finite(expiry.settlement.intrinsicValue) && expiry.settlement.intrinsicValue >= 0)
  return { contractId: plan.contract.contractId, cost, entry: { ask: entry.quote.ask, spreadPct: spread(entry.quote),
    bidSize: entry.quote.bidSize, askSize: entry.quote.askSize, volume: entry.volume ?? null },
  endpoints, path: { maximumObservedReturnPct: values.length ? round(Math.max(...values)) : null,
    maximumAdverseExcursionPct: values.length ? round(Math.min(0, ...values)) : null,
    drawdownBeforeGainPct: drawdownBefore(firstGain), itmCrossing: itm(entry) || relevantPoints.some(itm) ? 'observed_itm' : 'unknown',
    truePeakKnown: false, neverItmClaimAllowed: false, resolutionMinutes: plan.pathSampling.resolutionMinutes,
    scheduled: scheduled.length, observed: covered, coverage: scheduled.length ? covered / scheduled.length : null,
    gaps: path.filter((p) => p.returnPct == null), targets, strategies },
  expiry: { fullyFollowed: fullyFollowedExpiry, expiredWorthless: fullyFollowedExpiry ? expiry.settlement.intrinsicValue === 0 : null,
    reason: fullyFollowedExpiry ? null : 'expiry_or_full_path_not_observed' } }
}

function sessionsBetween(a, b) {
  let count = 0
  for (let t = Date.parse(`${a}T12:00:00Z`) + 86400000; t < Date.parse(`${b}T12:00:00Z`); t += 86400000) {
    const day = marketDay(new Date(t).toISOString().slice(0, 10))
    if (!day.known) throw new Error('Split exceeds calendar coverage')
    if (day.open) count++
  }
  return count
}

// The outcome plan's endpoints come from the observation policy and the
// report's horizons from the evaluation policy -- two separately frozen
// constants. When they agree, every horizon resolves; when they drift, every
// horizon summarises as "missing" and the report still looks complete. That
// silent hole is worse than a failed run, so the divergence raises instead.
export function assertEndpointHorizonAlignment(
  evaluationSessions = OPTIONS_EVALUATION_POLICY.endpointSessions,
  captureSessions = OPTIONS_OBSERVATION_POLICY.endpointSessions,
) {
  const [evaluation, capture] = [[...evaluationSessions].sort((a, b) => a - b), [...captureSessions].sort((a, b) => a - b)]
  if (evaluation.length !== capture.length || evaluation.some((value, index) => value !== capture[index])) {
    throw new Error(`Evaluation endpoint horizons [${evaluation}] do not match captured endpoints [${capture}]`)
  }
  return true
}

export function validateEvaluationProtocol(protocol) {
  assertEndpointHorizonAlignment()
  if (digest(protocol.policy) !== digest(OPTIONS_EVALUATION_POLICY) || digest(protocol.versions) !== digest(OPTIONS_REPLAY_VERSIONS)) throw new Error('Unsupported frozen evaluation policy')
  if (!protocol.version || !protocol.folds?.length || !['synthetic', 'observed'].includes(protocol.dataKind)) throw new Error('Protocol requires a version, folds and data kind')
  timestamp(protocol.frozenAt)
  const holdouts = []
  for (const fold of protocol.folds) {
    if (!fold.version || fold.policyHash !== digest(protocol.policy) || fold.holdoutUsedForTuning !== false) throw new Error('Holdout must remain untouched by tuning')
    for (const key of ['train', 'validation', 'holdout']) {
      const block = fold[key]
      if (!block || !/^\d{4}-\d{2}-\d{2}$/.test(block.start) || !/^\d{4}-\d{2}-\d{2}$/.test(block.end)
        || !marketDay(block.start).open || !marketDay(block.end).open || block.end < block.start) throw new Error('Invalid chronological block')
    }
    if (timestamp(protocol.frozenAt) >= timestamp(`${fold.holdout.start}T00:00:00Z`)) throw new Error('Protocol must be frozen before holdout')
    if (sessionsBetween(fold.train.end, fold.validation.start) < protocol.policy.purgeSessions
      || sessionsBetween(fold.validation.end, fold.holdout.start) < protocol.policy.embargoSessions) throw new Error('At least 10 sessions purge/embargo required')
    if (holdouts.some((block) => fold.holdout.start <= block.end && fold.holdout.end >= block.start)) throw new Error('Walk-forward holdouts overlap')
    holdouts.push(fold.holdout)
  }
  return protocol
}

// Deterministic two-way pigeonhole bootstrap: independently resample date and
// underlying clusters and multiply their frequencies; never treat contracts as iid.
export function clusteredUncertainty(rows, seed = 214, replicates = OPTIONS_EVALUATION_POLICY.bootstrapReplicates) {
  const valid = rows.filter((r) => finite(r.value))
  const dates = [...new Set(valid.map((r) => r.tradingDate))], names = [...new Set(valid.map((r) => r.securityId))]
  if (dates.length < 2 || names.length < 2) return { interval95: null, replicates, dates: dates.length, underlyings: names.length, reason: 'insufficient_clusters' }
  let state = seed >>> 0
  const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296 }
  const weights = (keys) => {
    const counts = new Map()
    for (let i = 0; i < keys.length; i++) { const key = keys[Math.floor(random() * keys.length)]; counts.set(key, (counts.get(key) || 0) + 1) }
    return counts
  }
  const estimates = []
  for (let i = 0; i < replicates; i++) {
    const dw = weights(dates), nw = weights(names)
    let total = 0, n = 0
    for (const r of valid) { const w = (dw.get(r.tradingDate) || 0) * (nw.get(r.securityId) || 0); total += w * r.value; n += w }
    if (n) estimates.push(total / n)
  }
  estimates.sort((a, b) => a - b)
  return { method: 'date-underlying-pigeonhole-bootstrap', replicates, dates: dates.length, underlyings: names.length,
    interval95: estimates.length ? [round(estimates[Math.floor(estimates.length * .025)]), round(estimates[Math.floor(estimates.length * .975)])] : null }
}

function summarize(rows, horizon, policy = OPTIONS_EVALUATION_POLICY) {
  const values = rows.map((r) => ({ ...r, endpoint: r.outcome.endpoints.find((p) => p.key === horizon) }))
  const observed = values.filter((r) => finite(r.endpoint?.returnPct))
  const sensitivity = values.map((r) => r.endpoint?.returnPct ?? r.endpoint?.worstCaseReturnPct).filter(finite)
  return { eligible: rows.length, observed: observed.length, censored: rows.length - observed.length,
    meanReturnPct: round(mean(observed.map((r) => r.endpoint.returnPct))),
    midpointMeanReturnPct: round(mean(observed.map((r) => r.endpoint.midpointReturnPct).filter(finite))),
    meanUnderlyingDirectionReturnPct: round(mean(observed.map((r) => finite(r.endpoint.underlyingMovePct)
      ? r.endpoint.underlyingMovePct * (r.direction === 'put' ? -1 : 1) : null).filter(finite))),
    worstCaseMeanReturnPct: round(mean(sensitivity)),
    statuses: Object.fromEntries([...new Set(values.map((r) => r.endpoint?.status || 'missing'))].map((status) =>
      [status, values.filter((r) => (r.endpoint?.status || 'missing') === status).length])),
    uncertainty: clusteredUncertainty(observed.map((r) => ({ ...r, value: r.endpoint.returnPct })), 214, policy.bootstrapReplicates) }
}

export function compareOptionsCohorts(rows, policy = OPTIONS_EVALUATION_POLICY) {
  const groups = new Map()
  for (const row of rows) {
    const key = [row.fold, row.split, row.direction, row.eventCohort, row.regime].join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.entries()].map(([cohort, members]) => {
    const byScan = new Map()
    for (const row of members) { if (!byScan.has(row.scanId)) byScan.set(row.scanId, []); byScan.get(row.scanId).push(row) }
    const assigned = [...byScan.values()].flatMap((daily) => daily.sort((a, b) => a.score - b.score || a.contractId.localeCompare(b.contractId))
      .map((r, i) => ({ ...r, decile: daily.length === 1 ? 5 : Math.min(10, Math.floor(i * 10 / daily.length) + 1) })))
    const top = assigned.filter((r) => r.decile === Math.max(...assigned.filter((x) => x.scanId === r.scanId).map((x) => x.decile)))
    const bottom = assigned.filter((r) => r.decile === 1)
    const matched = [], unmatched = []
    for (const r of top) {
      const candidates = assigned.filter((b) => b.scanId === r.scanId && b.contractId !== r.contractId
        && Math.abs(r.delta - b.delta) <= policy.match.delta && Math.abs(r.dte - b.dte) <= policy.match.dte
        && Math.abs(r.spreadPct - b.spreadPct) <= policy.match.spreadPct)
        .sort((a, b) => (Math.abs(a.delta - r.delta) / policy.match.delta + Math.abs(a.dte - r.dte) / policy.match.dte + Math.abs(a.spreadPct - r.spreadPct) / policy.match.spreadPct)
          - (Math.abs(b.delta - r.delta) / policy.match.delta + Math.abs(b.dte - r.dte) / policy.match.dte + Math.abs(b.spreadPct - r.spreadPct) / policy.match.spreadPct)
          || a.contractId.localeCompare(b.contractId))
      if (candidates[0]) matched.push({ selected: r, baseline: candidates[0] })
      else unmatched.push(r.contractId)
    }
    return { cohort, sampleSize: assigned.length, unmatched, matching: 'same-scan delta/DTE/spread calipers; replacement allowed',
      matchedPairs: matched.map((p) => ({ scanId: p.selected.scanId, selected: p.selected.contractId, baseline: p.baseline.contractId })),
      horizons: [...policy.endpointSessions.map(String), 'expiry'].map((horizon) => ({ horizon,
        all: summarize(assigned, horizon, policy), top: summarize(top, horizon, policy), bottom: summarize(bottom, horizon, policy),
        matchedBaseline: summarize(matched.map((p) => p.baseline), horizon, policy),
        matchedTop: summarize(matched.map((p) => p.selected), horizon, policy),
        deciles: Array.from({ length: 10 }, (_, i) => ({ decile: i + 1, ...summarize(assigned.filter((r) => r.decile === i + 1), horizon, policy) })) })) }
  })
}

export function evaluateOptionsArchive(archive) {
  const { manifest, objects } = archive
  if (manifest?.schemaVersion !== 'options-evaluation-archive-v1') throw new Error('Unsupported evaluation archive')
  const read = (hash) => { const object = objects?.[hash]; if (!object || digest(object) !== hash) throw new Error('Archive hash mismatch'); return object }
  const protocol = validateEvaluationProtocol(read(manifest.protocolHash))
  timestamp(manifest.asOf)
  const scans = manifest.scanHashes.map(read).sort((a, b) => a.tradingDate.localeCompare(b.tradingDate) || a.scanId.localeCompare(b.scanId))
  if (new Set(scans.map((s) => s.scanId)).size !== scans.length) throw new Error('Duplicate scan')
  const outcomeRecords = manifest.outcomeHashes.map(read), outcomeMap = new Map()
  for (const o of outcomeRecords) {
    const key = `${o.scanId}:${o.contractId}`
    if (outcomeMap.has(key)) throw new Error('Duplicate outcome record')
    outcomeMap.set(key, o)
  }
  const rows = [], replays = [], splitExclusions = []
  for (const scan of scans) {
    if (timestamp(scan.openingAt) > timestamp(manifest.asOf)) throw new Error('Scan is after report cutoff')
    const replay = replayOptionsScan(scan)
    replays.push(replay)
    for (const fold of protocol.folds) {
      const split = ['train', 'validation', 'holdout'].find((key) => scan.tradingDate >= fold[key].start && scan.tradingDate <= fold[key].end)
      if (!split) { splitExclusions.push({ scanId: scan.scanId, fold: fold.version, reason: 'outside_blocks_or_embargo' }); continue }
      for (const score of replay.ranking.ranked) {
        const entry = replay.entries.find((e) => e.security.securityId === score.securityId)
        const contract = entry.chain.contracts.find((c) => c.contractId === score.contract.contractId)
        const plan = createOutcomeCapturePlan({ scanId: scan.scanId, contract: { ...contract, ...entry.security }, tradingDate: scan.tradingDate, entryAt: scan.openingAt })
        // Expiry labels can extend beyond 10 sessions. Purge those too, never let
        // a training/validation outcome overlap the next evaluation block.
        const nextBlock = split === 'train' ? fold.validation : split === 'validation' ? fold.holdout : null
        const labelEnd = plan.endpointTargets.filter((t) => t.scheduledAt).map((t) => t.tradingDate).sort().at(-1)
        if (nextBlock && labelEnd >= nextBlock.start) { splitExclusions.push({ scanId: scan.scanId, contractId: contract.contractId, fold: fold.version, reason: 'expiry_label_overlap' }); continue }
        const outcome = evaluateOptionsOutcome({ plan, asOf: manifest.asOf,
          entry: { quote: contract.quote, underlyingPrice: mid(entry.underlying.quote), iv: contract.analytics?.impliedVolatility, volume: contract.volume?.value },
          observations: outcomeMap.get(`${scan.scanId}:${contract.contractId}`)?.observations || [], policy: protocol.policy })
        const feature = replay.snapshot.securities.find((f) => f.security.securityId === score.securityId)
        rows.push({ scanId: scan.scanId, tradingDate: scan.tradingDate, fold: fold.version, split,
          securityId: score.securityId, ticker: score.ticker, contractId: contract.contractId, direction: score.direction,
          eventCohort: score.eventCohort, regime: feature.regime?.label || 'unknown', score: score.score,
          delta: contract.absDelta, dte: contract.dte, spreadPct: spread(contract.quote), outcome })
      }
    }
  }
  const followed = rows.filter((r) => r.outcome.expiry.fullyFollowed)
  const report = { schemaVersion: 'options-evaluation-report-v1', manifestHash: digest(manifest), protocolHash: manifest.protocolHash,
    asOf: manifest.asOf, dataKind: protocol.dataKind, protocol, replays, rows, splitExclusions,
    comparisons: compareOptionsCohorts(rows, protocol.policy),
    expiry: { eligible: rows.length, fullyFollowed: followed.length, unknown: rows.length - followed.length,
      expiredWorthlessRate: mean(followed.map((r) => Number(r.outcome.expiry.expiredWorthless))) },
    limitations: [
      'Fixed handpicked watchlist: conditional study, not market-wide alpha; shortlist and gate exclusions retain selection bias.',
      'Observed ask entry and bid exit with stated costs are observations, not guaranteed fills; indicative feed remains indicative.',
      'Sampled paths cannot establish true peaks or never-ITM; missing exits are censored, not zero returns or worthlessness.',
      'Worst-case sensitivity assumes zero liquidation value plus exit fees for every censored horizon, including not-yet-mature horizons.',
      'Small samples, few clusters, overlapping contracts and multiple comparisons limit inference; intervals are descriptive, not adjusted significance tests.',
      'Holdout non-use is a predeclared protocol attestation; hashes establish integrity, not independent proof of when a protocol was registered.',
      'Engineering success is not evidence of profitability. Negative outcomes are retained. No policy fitting is performed.',
    ] }
  return { ...report, reportHash: digest(report) }
}
