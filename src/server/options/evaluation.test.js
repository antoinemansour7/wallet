// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { digest } from '../research/archive.js'
import { createOutcomeCapturePlan } from './observations.js'
import { replayOptionsScan } from './evaluationReplay.js'
import {
  OPTIONS_EVALUATION_POLICY, assertEndpointHorizonAlignment, clusteredUncertainty, compareOptionsCohorts,
  evaluateOptionsArchive, evaluateOptionsOutcome, validateEvaluationProtocol,
} from './evaluation.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/evaluation/archive.json', import.meta.url)))
const scan = () => structuredClone(fixture.objects[fixture.manifest.scanHashes[0]])
const protocol = () => structuredClone(fixture.objects[fixture.manifest.protocolHash])
const security = { securityId: 'sec:EX', issuerId: 'iss:EX', ticker: 'EX' }
const contract = { ...security, contractId: 'contract-0', rawId: 'raw-0', type: 'call', strikePrice: 185, expirationDate: '2026-09-25' }
const entryAt = '2026-09-22T13:32:20.000Z'
const quote = (bid, ask, marketAt = entryAt) => ({ bid, ask, marketAt, bidSize: 20, askSize: 20 })
const entry = { quote: quote(5.4, 5.6), underlyingPrice: 180, iv: .4 }
const plan = () => createOutcomeCapturePlan({ scanId: 'scan', contract, tradingDate: '2026-09-22', entryAt })
function point(at, bid = 7.4, overrides = {}) {
  return { ...security, contractId: contract.contractId, at, availableAt: at, quote: quote(bid, bid + .2, at), underlyingPrice: 182, iv: .45, ...overrides }
}
const evaluate = (observations, overrides = {}) => evaluateOptionsOutcome({ plan: plan(), entry, observations, asOf: '2026-10-10T00:00:00Z', ...overrides })

describe('frozen two-stage replay', () => {
  it('rebuilds shortlist, gates and scores and retains all eligible contracts', () => {
    const result = replayOptionsScan(scan())
    expect(result.shortlist.candidates).toHaveLength(1)
    expect(result.ranking.ranked).toHaveLength(3)
    expect(result.ranking.suppressed.length).toBeGreaterThan(0)
    expect(result.referenceHashes.watchlist).toBe(digest(scan().references.watchlist))
  })

  it('does not use late news, revised events or same-day bars', () => {
    const input = scan(), original = replayOptionsScan(input)
    input.featureInputs.bars.push({ ...input.featureInputs.bars[0], date: input.tradingDate, close: 99999 })
    input.featureInputs.earnings = [{ ...security, eventId: 'late', eventDate: input.tradingDate,
      availableAt: '2026-09-22T21:00:00Z' }]
    input.featureInputs.news = [{ ...security, availableAt: '2026-09-22T21:00:00Z' }]
    expect(replayOptionsScan(input).ranking).toEqual(original.ranking)
    expect(replayOptionsScan(input).snapshot).toEqual(original.snapshot)
  })

  it('rejects full-day opening volume even with a falsely early acquisition time', () => {
    const input = scan()
    for (const c of input.chains[0].contracts) {
      c.previousDailyBar = null
      c.volume = { ...c.volume, semantics: 'full_day', value: 1000000 }
    }
    const result = replayOptionsScan(input)
    expect(result.ranking.ranked).toHaveLength(0)
    expect(result.exclusions.every((e) => e.reason === 'insufficient_volume')).toBe(true)
  })

  it.each(['quote', 'analytics', 'openInterest'])('cannot insert later %s into an opening signal', (field) => {
    const input = scan()
    input.chains[0].contracts.forEach((c) => { c[field].availableAt = '2026-09-22T21:00:00Z' })
    expect(replayOptionsScan(input).ranking.ranked).toHaveLength(0)
  })

  it('recomputes freshness instead of trusting provider ageMs and excludes wrong identities', () => {
    const input = scan()
    input.chains[0].contracts[0].quote.marketAt = '2026-09-22T13:31:00Z'
    input.chains[0].contracts[0].quote.ageMs = 0
    input.chains[0].contracts[1].issuerId = 'reused-ticker'
    const result = replayOptionsScan(input)
    expect(result.exclusions.map((e) => e.reason)).toEqual(expect.arrayContaining(['stale_contract_quote', 'historical_identity_or_deliverable_unavailable']))
  })

  it('freezes reference, policy and coverage versions at their own cutoff', () => {
    const input = scan()
    input.references.events.availableAt = '2026-09-23T00:00:00Z'
    expect(() => replayOptionsScan(input)).toThrow('version unavailable')
    input.references.events.availableAt = input.premarketAt
    input.versions.score = 'future-version'
    expect(() => replayOptionsScan(input)).toThrow('Unsupported replay policy')
    const lateCoverage = scan()
    lateCoverage.coverage.earnings.asOf = '2026-09-23T00:00:00Z'
    expect(replayOptionsScan(lateCoverage).snapshot.securities[0].coverage.earnings.status).toBe('unknown')
  })
})

describe('observed returns and censored paths', () => {
  it('uses ask plus costs then bid minus costs, with midpoint secondary', () => {
    const result = evaluate([point('2026-09-22T20:00:00.000Z')])
    // Independently calculated: entry 560 + 1 slippage + .70 = 561.70;
    // exit 740 - 1 - .70 = 738.30. Midpoint: 7.5 / 5.5 - 1.
    expect(result.cost).toBeCloseTo(561.7)
    expect(result.endpoints[0].returnPct).toBeCloseTo(100 * (738.3 / 561.7 - 1), 5)
    expect(result.endpoints[0].midpointReturnPct).toBeCloseTo(100 * (7.5 / 5.5 - 1), 5)
    expect(result.endpoints[0].underlyingMovePct).toBeCloseTo(100 * (182 / 180 - 1), 5)
    expect(result.endpoints[0].ivChange).toBe(.05)
  })

  it('records drawdown, observed target time and first observed stop independently of the later maximum', () => {
    const points = [point('2026-09-22T14:00:00Z', 3), point('2026-09-22T15:00:00Z', 7.4), point('2026-09-22T16:00:00Z', 12)]
    const result = evaluate(points)
    expect(result.path.maximumObservedReturnPct).toBeGreaterThan(100)
    expect(result.path.targets[0]).toMatchObject({ state: 'observed_hit', at: points[1].at })
    expect(result.path.targets[0].drawdownBeforeTargetPct).toBeLessThan(-40)
    expect(result.path.strategies[0]).toMatchObject({ trigger: 'stop', at: points[0].at, pathUncertain: true })
    expect(result.path.itmCrossing).toBe('unknown')
    expect(result.path.truePeakKnown).toBe(false)
    expect(result.path.neverItmClaimAllowed).toBe(false)
  })

  it.each(['halted', 'delisted', 'missing'])('keeps %s exits censored instead of inferring zero return', (status) => {
    const result = evaluate([point('2026-09-22T20:00:00Z', 7, { status })])
    expect(result.endpoints[0]).toMatchObject({ status, returnPct: null })
    expect(result.endpoints[0].worstCaseReturnPct).toBeLessThanOrEqual(-100)
    expect(result.expiry.expiredWorthless).toBeNull()
  })

  it('retains zero bids and future/unexpired endpoints as distinct unknowns', () => {
    const result = evaluate([point('2026-09-22T20:00:00Z', 0)], { asOf: '2026-09-22T21:00:00Z' })
    expect(result.endpoints[0]).toMatchObject({ status: 'zero_bid', returnPct: null })
    expect(result.endpoints.find((p) => p.key === '1').status).toBe('unexpired_horizon')
    expect(result.endpoints.find((p) => p.key === '5').status).toBe('contract_expired_before_endpoint')
  })

  it('cannot borrow a quote after an endpoint or before entry or after report availability', () => {
    const result = evaluate([point('2026-09-22T20:00:01Z'), point('2026-09-22T12:00:00Z', 100),
      point('2026-09-22T19:59:59Z', 8, { availableAt: '2026-11-01T00:00:00Z' })])
    expect(result.endpoints[0].status).toBe('missing_exit_quote')
    expect(result.path.maximumObservedReturnPct).toBeLessThan(100)
  })

  it('observes ITM for calls and puts but never asserts never-ITM on missing paths', () => {
    expect(evaluate([point('2026-09-22T20:00:00Z', 6, { underlyingPrice: 190 })]).path.itmCrossing).toBe('observed_itm')
    const putPlan = plan(); putPlan.contract.type = 'put'; putPlan.contract.strikePrice = 170
    expect(evaluate([point('2026-09-22T20:00:00Z', 6, { underlyingPrice: 160 })], { plan: putPlan }).path.itmCrossing).toBe('observed_itm')
    expect(evaluate([]).path.itmCrossing).toBe('unknown')
  })

  it('counts worthless only with a confirmed settlement and complete expiry follow-through', () => {
    const p = plan()
    const times = [...new Set([...p.pathSampling.samples, ...p.endpointTargets].map((t) => t.scheduledAt).filter(Boolean))]
    const observations = times.map((at) => point(at))
    const expiry = observations.find((o) => o.at === p.endpointTargets.find((t) => t.kind === 'expiry_close').scheduledAt)
    expiry.quote = quote(0, .01, expiry.at)
    expiry.settlement = { status: 'confirmed', intrinsicValue: 0 }
    expect(evaluate(observations).expiry).toMatchObject({ fullyFollowed: true, expiredWorthless: true })
    expect(evaluate(observations.slice(1)).expiry).toMatchObject({ fullyFollowed: false, expiredWorthless: null })
    delete expiry.settlement
    expect(evaluate(observations).expiry.expiredWorthless).toBeNull()
  })

  it('rejects wrong issuer/contract observations and duplicate timestamps', () => {
    expect(() => evaluate([point(entryAt, 6, { issuerId: 'wrong' })])).toThrow('identity mismatch')
    expect(() => evaluate([point(entryAt), point(entryAt)])).toThrow('Duplicate')
  })
})

describe('holdouts, baselines, uncertainty and independent archives', () => {
  it('enforces ten-session gaps, pre-registration and no holdout tuning', () => {
    expect(validateEvaluationProtocol(protocol())).toBeTruthy()
    const shortGap = protocol(); shortGap.folds[0].validation.start = '2026-06-17'
    expect(() => validateEvaluationProtocol(shortGap)).toThrow('purge/embargo')
    const tuned = protocol(); tuned.folds[0].holdoutUsedForTuning = true
    expect(() => validateEvaluationProtocol(tuned)).toThrow('untouched')
    const late = protocol(); late.frozenAt = '2026-10-01T00:00:00Z'
    expect(() => validateEvaluationProtocol(late)).toThrow('before holdout')
    const overlap = protocol(); overlap.folds.push(overlap.folds[0])
    expect(() => validateEvaluationProtocol(overlap)).toThrow('overlap')
  })

  it('retains losses, missing denominators, suppressed eligible contracts and separate cohorts', () => {
    const report = evaluateOptionsArchive(fixture)
    expect(report.rows).toHaveLength(3)
    expect(report.comparisons[0].horizons[0].all.meanReturnPct).toBeLessThan(0)
    expect(report.comparisons[0].horizons[1].all).toMatchObject({ eligible: 3, observed: 0, censored: 3, meanReturnPct: null })
    expect(report.expiry).toMatchObject({ fullyFollowed: 0, expiredWorthlessRate: null })
    const rows = report.rows
    const cohorts = compareOptionsCohorts([...rows, { ...rows[0], direction: 'put' }, { ...rows[0], regime: 'downturn' }, { ...rows[0], eventCohort: 'event' }])
    expect(cohorts).toHaveLength(4)
    expect(report.comparisons[0].matchedPairs.length).toBeGreaterThan(0)
  })

  it('uses deterministic cluster uncertainty and discloses insufficient clusters', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ value: i - 20, tradingDate: String(i % 5), securityId: String(i % 3) }))
    expect(clusteredUncertainty(rows)).toEqual(clusteredUncertainty(rows))
    expect(clusteredUncertainty(rows).interval95).toHaveLength(2)
    expect(clusteredUncertainty(rows.map((r) => ({ ...r, securityId: 'only-one' }))).reason).toBe('insufficient_clusters')
  })

  it('reports intervals at the frozen replicate count rather than a private default', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ value: i - 20, tradingDate: String(i % 5), securityId: String(i % 3) }))
    // An interval a reader cannot attribute to a declared replicate count is
    // not reproducible, so the count travels with the interval.
    expect(clusteredUncertainty(rows).replicates).toBe(OPTIONS_EVALUATION_POLICY.bootstrapReplicates)
    expect(clusteredUncertainty(rows, 214, 40).replicates).toBe(40)
    const report = evaluateOptionsArchive(fixture)
    const uncertainty = report.comparisons[0].horizons[0].all.uncertainty
    expect(uncertainty.replicates).toBe(OPTIONS_EVALUATION_POLICY.bootstrapReplicates)
  })

  it('fails closed when the capture plan and the report disagree on endpoint horizons', () => {
    // The outcome plan's endpoints come from the observation policy and the
    // report's horizons from the evaluation policy. If they ever drift apart,
    // every horizon summarises as "missing" and the report still looks whole,
    // so the divergence has to raise instead.
    expect(assertEndpointHorizonAlignment([0, 1, 3, 5, 10], [0, 1, 3, 5, 10])).toBe(true)
    expect(() => assertEndpointHorizonAlignment([0, 1, 3, 5, 10], [0, 1, 3, 5])).toThrow(/endpoint/i)
    expect(() => assertEndpointHorizonAlignment([0, 1, 3, 5, 10], [0, 1, 3, 5, 20])).toThrow(/endpoint/i)
    expect(validateEvaluationProtocol(protocol())).toBeTruthy()
  })

  it('verifies every archived object and produces stable reports across independent JSON reads', () => {
    const report = evaluateOptionsArchive(fixture)
    expect(evaluateOptionsArchive(JSON.parse(JSON.stringify(fixture))).reportHash).toBe(report.reportHash)
    const changed = structuredClone(fixture)
    changed.objects[changed.manifest.scanHashes[0]].featureInputs.bars[0].close = 999
    expect(() => evaluateOptionsArchive(changed)).toThrow('hash mismatch')
    const { reportHash, ...body } = report
    expect(digest(body)).toBe(reportHash)
    expect(report.protocol.policy).toEqual(OPTIONS_EVALUATION_POLICY)
  })
})
