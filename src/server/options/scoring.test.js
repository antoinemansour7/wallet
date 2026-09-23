// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { digest } from '../research/archive.js'
import { buildContractScenarioSet, OPTIONS_SCENARIO_RANKING_PROFILE } from './scenarios.js'
import { validateOptionsAuditRecord } from './audit.js'
import {
  OPTIONS_SCORE_POLICY, OPTIONS_SCORE_POLICY_VERSION, createOptionsScoreAuditRecord,
  diagnoseOptionsScorePolicy, rankOptionsScores, scoreOptionsContract,
} from './scoring.js'

const TRADING_DATE = '2026-09-22' // a Tuesday
const AS_OF = '2026-09-22T14:00:00.000Z'
const PRIMARY_EXIT_DATE = '2026-09-25' // three sessions from Tuesday
const EXPIRATION = '2026-10-16'

function security(overrides = {}) {
  return { securityId: 'sec:EX', issuerId: 'iss:EX', ticker: 'EX', ...overrides }
}

// Only the fields scoring reads, in #206's shape. `directional` is built from
// the raw values here rather than hand-written, so a mirrored fixture really is
// the negation the feature builder would produce.
function features({
  relativeStrength20dPct = 8, return5dPct = 3, distanceFromSma20Pct = 4, realizedVolatility20dPct = 30,
  regimeScore = 8, earnings = [], nonEventState = 'eligible', recordId = 'a'.repeat(64),
} = {}) {
  const raw = { premarketMovePct: 1, return5dPct, return20dPct: 12, relativeStrength20dPct }
  return {
    recordId,
    security: security(),
    tradingDate: TRADING_DATE,
    technicals: {
      laggedThrough: '2026-09-21', historySessions: 60, return5dPct, return20dPct: 12,
      relativeStrength20dPct, realizedVolatility20dPct, distanceFromSma20Pct,
    },
    regime: regimeScore == null ? null : { score: regimeScore, label: 'constructive' },
    directional: {
      call: { ...raw },
      put: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value == null ? null : -value])),
    },
    events: { earnings, dividends: [], catalysts: [] },
    nonEventHorizon: { state: nonEventState, holdingDays: 5, through: '2026-09-27', reasons: [] },
    coverage: { earnings: { status: 'complete' }, catalysts: { status: 'complete' } },
  }
}

function contract({
  type = 'call', contractId = 'osi:EX261016C00185000', strikePrice = 185, todayVolume = 40,
  previousVolume = 800, openInterest = 1200, bidSize = 20, askSize = 20, bid = 5.4, ask = 5.6,
} = {}) {
  return {
    rawId: 'raw-1', contractId, osiSymbol: contractId.replace('osi:', ''), type, strikePrice,
    expirationDate: EXPIRATION, dte: 24, cohort: 'primary', absDelta: 0.42, analyticsAgeUnknown: true,
    openInterest, openInterestDate: '2026-09-21',
    quote: { bid, ask, bidSize, askSize, marketAt: AS_OF, ageMs: 4000 },
    volume: { value: todayVolume, session: 'rth', sessionDate: TRADING_DATE },
    previousVolume,
    analytics: { impliedVolatility: 0.34, greeks: { delta: 0.41 }, age: 'unknown' },
    fetchedAt: AS_OF, rawReferenceHash: 'b'.repeat(64),
  }
}

// #210's shape, reduced to what scoring reads. Built by hand so each component
// can be driven to its edges without repricing a lattice; `scores a real
// scenario set` below proves the shape matches what #210 actually emits.
function scenarioSet({
  publishable = true, blockers = [], type = 'call', delta = 0.42, gamma = 0.02, impliedVolatility = 0.35,
  bid = 5.4, ask = 5.6, decayPctOfEntryPremium = -6, ivDownReturnPct = -12,
  requiredMoveInImpliedMoves = 0.45, solved = true, primaryAvailable = true,
} = {}) {
  const mid = (bid + ask) / 2
  const horizon = {
    id: '3_sessions', sessions: 3, status: primaryAvailable ? 'available' : 'excluded',
    reason: primaryAvailable ? null : 'horizon_beyond_expiry', exitDate: PRIMARY_EXIT_DATE,
    exitAt: `${PRIMARY_EXIT_DATE}T20:00:00.000Z`, remainingYears: 0.058, calendarElapsedDays: 3.25,
  }
  return {
    policyVersion: 'options-scenario-matrix-v1',
    modelVersion: 'options-american-crr-vellekoop-v1',
    status: publishable ? 'ok' : 'blocked',
    publishable, blockers,
    contract: { contractId: 'osi:EX261016C00185000', type, strikePrice: 185, expirationDate: EXPIRATION },
    asOf: AS_OF, tradingDate: TRADING_DATE,
    horizons: [horizon],
    calibration: { status: 'calibrated', impliedVolatility },
    entry: {
      underlyingPrice: 180, bid, ask, mid, spreadPct: ((ask - bid) / mid) * 100, impliedVolatility,
      greeks: { delta: type === 'put' ? -Math.abs(delta) : delta, gamma, vega: 0.21, theta: -0.07 },
      theoreticalValue: mid, premiumAtRiskPerContract: ask * 100 + 1.4,
    },
    scenarios: primaryAvailable
      ? [{ horizonId: '3_sessions', movePct: 0, ivMultiplier: 0.9, midReturnPct: ivDownReturnPct }]
      : [],
    timeOnlyDecay: primaryAvailable ? [{ horizonId: '3_sessions', decayPctOfEntryPremium }] : [],
    premiumTargets: primaryAvailable
      ? [{
        targetPct: 25, horizonId: '3_sessions', ivMultiplier: 1, solved,
        requiredMovePct: (type === 'put' ? -1 : 1) * requiredMoveInImpliedMoves * 30 * Math.sqrt(3.25 / 365),
        requiredMoveInImpliedMoves: solved ? (type === 'put' ? -requiredMoveInImpliedMoves : requiredMoveInImpliedMoves) : null,
        reason: solved ? null : 'no_solution_within_search_bound',
      }]
      : [],
    summary: { primaryHorizonAvailable: primaryAvailable },
  }
}

function score(overrides = {}) {
  const { featureOverrides, contractOverrides, scenarioOverrides, ...rest } = overrides
  return scoreOptionsContract({
    security: security(),
    direction: 'call',
    contract: contract(contractOverrides),
    features: features(featureOverrides),
    scenarioSet: scenarioSet(scenarioOverrides),
    tradingDate: TRADING_DATE,
    ivContext: { percentile: 40, sampleSize: 180, window: '1y same-tenor same-moneyness', evidenceId: 'c'.repeat(64) },
    ...rest,
  })
}

function componentPoints(result, name) {
  return result.components.find((component) => component.component === name).points
}

function penalty(result, code) {
  return result.penalties.find((item) => item.code === code) || null
}

describe('OPTIONS_SCORE_POLICY', () => {
  it('declares component maxima that sum to exactly 100', () => {
    const maxima = OPTIONS_SCORE_POLICY.components
    expect(maxima).toMatchObject({
      underlyingSetup: 15, technicalConfirmation: 10, catalystQuality: 10, deltaExposure: 10,
      convexity: 10, thetaEfficiency: 10, ivVega: 10, liquidity: 15, expectedMoveCompatibility: 10,
    })
    expect(Object.values(maxima).reduce((sum, value) => sum + value, 0)).toBe(100)
  })

  it('records that the v0 weights are a frozen hypothesis fitted on no evaluation data', () => {
    expect(OPTIONS_SCORE_POLICY.version).toBe(OPTIONS_SCORE_POLICY_VERSION)
    expect(OPTIONS_SCORE_POLICY.weightsFittedOn).toBe('none-frozen-v0-hypothesis')
    expect(OPTIONS_SCORE_POLICY.missingDataPolicy).toEqual({
      featurePoints: 'zero',
      absentPenaltyInput: 'worst_case_existing_penalty_or_exclude_required_model_input',
      unknownEventCoverage: 'flag',
      hardGateOrModelInput: 'exclude',
    })
  })
})

describe('scoreOptionsContract', () => {
  it('scores an eligible contract and never exceeds the declared range', () => {
    const result = score()
    expect(result.status).toBe('scored')
    expect(result.components).toHaveLength(9)
    expect(result.score).toBeGreaterThan(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.score).toBe(Math.max(0, Math.min(100, result.componentPoints - result.penaltyPoints)))
    for (const component of result.components) {
      expect(component.points).toBeGreaterThanOrEqual(0)
      expect(component.points).toBeLessThanOrEqual(component.max)
    }
  })

  it('traces every feature with its raw value, units, window, transform, evidence and reason', () => {
    const result = score()
    const traced = result.components.flatMap((component) => component.features)
    expect(traced.length).toBeGreaterThan(10)
    for (const item of traced) {
      expect(item).toHaveProperty('feature')
      expect(item).toHaveProperty('raw')
      expect(item).toHaveProperty('units')
      expect(item).toHaveProperty('window')
      expect(item).toHaveProperty('reason')
      expect(Array.isArray(item.evidenceIds)).toBe(true)
      expect(typeof item.transform).toBe('string')
      expect(typeof item.points).toBe('number')
    }
    // The evidence a reader needs to reconstruct the row: the frozen feature
    // record, the raw chain observation, and the scenario set.
    const evidence = new Set(traced.flatMap((item) => item.evidenceIds))
    expect(evidence.has('a'.repeat(64))).toBe(true)
    expect(evidence.has('b'.repeat(64))).toBe(true)
  })

  it('labels the score as neither a probability nor an expected return', () => {
    const result = score()
    expect(result.interpretation).toMatchObject({ isWinProbability: false, isExpectedReturnPct: false })
  })

  it('scores a mirrored put exactly as it scores the mirrored call', () => {
    const call = score()
    const put = score({
      direction: 'put',
      featureOverrides: { relativeStrength20dPct: -8, return5dPct: -3, distanceFromSma20Pct: -4, regimeScore: 2 },
      contractOverrides: { type: 'put', contractId: 'osi:EX261016P00175000', strikePrice: 175 },
      scenarioOverrides: { type: 'put' },
    })
    expect(put.status).toBe('scored')
    expect(put.score).toBe(call.score)
    expect(put.components.map((component) => component.points)).toEqual(call.components.map((component) => component.points))
  })
})

describe('hard-gate separation', () => {
  it('enforces locally calibrated signed delta, even if provider delta passed', () => {
    for (const delta of [null, NaN, -0.4, 0.05, 0.9]) {
      expect(score({ scenarioOverrides: { delta } }).blockers).toContainEqual(expect.objectContaining({ code: 'calibrated_delta_outside_window' }))
    }
  })

  it('excludes missing model decay rather than allowing it to remove a penalty', () => {
    expect(score({ scenarioOverrides: { decayPctOfEntryPremium: null } }).status).toBe('ineligible')
  })
  it('refuses to score a contract that failed a hard gate, and awards no partial points', () => {
    const result = score({ gate: { status: 'rejected', reason: 'stale_contract_quote' } })
    expect(result.status).toBe('ineligible')
    expect(result.score).toBeNull()
    expect(result.components).toEqual([])
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'hard_gate_failed', detail: 'stale_contract_quote' }))
  })

  it('refuses to score a contract whose model failed to calibrate', () => {
    const result = score({ scenarioOverrides: { publishable: false, blockers: [{ code: 'calibration_failed', detail: 'residual_above_tolerance' }] } })
    expect(result.status).toBe('ineligible')
    expect(result.penalties).toEqual([])
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'scenarios_not_publishable', detail: 'calibration_failed' }))
  })

  it('refuses to score a contract without the primary comparability horizon', () => {
    const result = score({ scenarioOverrides: { primaryAvailable: false } })
    expect(result.status).toBe('ineligible')
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'primary_horizon_unavailable' }))
  })

  it('excludes an earnings event inside the holding horizon rather than penalising it', () => {
    const earnings = [{ eventId: 'e1', eventDate: '2026-09-24', timing: 'after_close', revisionId: 'r1' }]
    const result = score({ featureOverrides: { earnings, nonEventState: 'excluded' } })
    expect(result.status).toBe('ineligible')
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'event_exposure_in_holding_horizon' }))
  })

  it('treats an unknown-timing event dated on the exit session as inside the horizon', () => {
    const earnings = [{ eventId: 'e1', eventDate: PRIMARY_EXIT_DATE, timing: 'unknown', revisionId: 'r1' }]
    expect(score({ featureOverrides: { earnings } }).status).toBe('ineligible')
    const afterClose = [{ eventId: 'e1', eventDate: PRIMARY_EXIT_DATE, timing: 'after_close', revisionId: 'r1' }]
    expect(score({ featureOverrides: { earnings: afterClose } }).status).toBe('scored')
  })

  it('keeps the earnings-event cohort out of the default non-event policy', () => {
    const result = score({ mode: 'earnings_event' })
    expect(result.eventCohort).toBe('earnings_event')
    expect(result.status).toBe('ineligible')
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'event_cohort_policy_not_implemented' }))
  })
})

describe('missing data', () => {
  it('treats invalid or future IV history as unavailable, never as cheap volatility', () => {
    const absent = score({ ivContext: null }).score
    for (const ivContext of [{ percentile: -1 }, { percentile: 101 }, { percentile: 10, availableAt: '2026-09-23T00:00:00Z' }]) {
      expect(score({ ivContext }).score).toBe(absent)
    }
  })
  it('gives no points and the existing worst-case penalty for absent historical IV context', () => {
    const withContext = score()
    const without = score({ ivContext: null })
    expect(componentPoints(without, 'ivVega')).toBeLessThan(componentPoints(withContext, 'ivVega'))
    const traced = without.components.find((component) => component.component === 'ivVega')
      .features.find((item) => item.feature === 'historicalIvPercentile')
    expect(traced).toMatchObject({ raw: null, points: 0, reason: 'historical_iv_context_unavailable' })
    expect(penalty(without, 'iv_above_90th_percentile')).toMatchObject({ points: 5, reason: 'missing_input_uses_existing_worst_case_penalty' })
    expect(without.score).toBeLessThanOrEqual(score({ ivContext: { percentile: 99 } }).score)
    expect(without.missing).toContainEqual(expect.objectContaining({ path: 'ivContext.percentile' }))
  })

  it('gives no points for a missing realized-volatility comparator', () => {
    const result = score({ featureOverrides: { realizedVolatility20dPct: null } })
    const traced = result.components.find((component) => component.component === 'ivVega')
      .features.find((item) => item.feature === 'impliedToRealizedVolatility')
    expect(traced).toMatchObject({ raw: null, points: 0 })
  })

  it('gives no points for missing session volume rather than assuming it is fine', () => {
    const result = score({ contractOverrides: { todayVolume: null, previousVolume: 800 } })
    const traced = result.components.find((component) => component.component === 'liquidity')
      .features.find((item) => item.feature === 'sessionVolume')
    expect(traced.points).toBe(0)
  })
})

describe('penalties', () => {
  it('makes risk deductions continuous at the original thresholds', () => {
    const before = score({ scenarioOverrides: { decayPctOfEntryPremium: -15, ivDownReturnPct: -25 } })
    const after = score({ scenarioOverrides: { decayPctOfEntryPremium: -15.001, ivDownReturnPct: -25.001 } })
    expect(Math.abs(before.score - after.score)).toBeLessThan(0.01)
    const iv90 = score({ ivContext: { percentile: 90 } })
    const ivOver = score({ ivContext: { percentile: 90.001 } })
    expect(Math.abs(iv90.score - ivOver.score)).toBeLessThan(0.01)
    const lowVolume = score({ contractOverrides: { todayVolume: 4 } })
    const fullVolume = score({ contractOverrides: { todayVolume: 5 } })
    expect(fullVolume.score - lowVolume.score).toBeCloseTo(0.6, 3)
  })
  it('scales the wide-spread penalty across the 5-10% band', () => {
    expect(penalty(score({ scenarioOverrides: { bid: 5.4, ask: 5.6 } }), 'wide_spread')).toBeNull()
    const mid = penalty(score({ scenarioOverrides: { bid: 5.31, ask: 5.72 } }), 'wide_spread')
    expect(mid.points).toBeGreaterThan(0)
    expect(mid.points).toBeLessThan(5)
    const wide = penalty(score({ scenarioOverrides: { bid: 5.25, ask: 5.8 } }), 'wide_spread')
    expect(wide.points).toBeGreaterThan(mid.points)
    expect(wide.points).toBeLessThanOrEqual(5)
  })

  it('penalises a contract that only cleared the volume gate on prior-session volume', () => {
    expect(penalty(score(), 'volume_only_by_prior_session')).toBeNull()
    const result = score({ contractOverrides: { todayVolume: 2, previousVolume: 800 } })
    expect(penalty(result, 'volume_only_by_prior_session').points).toBe(1.8)
  })

  it('penalises implied volatility above its own comparable-history 90th percentile', () => {
    const result = score({ ivContext: { percentile: 96, sampleSize: 180, window: '1y', evidenceId: 'c'.repeat(64) } })
    expect(penalty(result, 'iv_above_90th_percentile').points).toBe(3)
  })

  it('penalises time decay above 15% of entry premium over the primary horizon', () => {
    expect(penalty(score({ scenarioOverrides: { decayPctOfEntryPremium: -9 } }), 'decay_above_horizon_limit')).toBeNull()
    const result = score({ scenarioOverrides: { decayPctOfEntryPremium: -22 } })
    expect(penalty(result, 'decay_above_horizon_limit').points).toBe(5)
    expect(componentPoints(result, 'thetaEfficiency')).toBe(0)
  })

  it('penalises earnings after the intended exit but before expiry', () => {
    const earnings = [{ eventId: 'e1', eventDate: '2026-10-08', timing: 'after_close', revisionId: 'r1' }]
    const result = score({ featureOverrides: { earnings } })
    expect(result.status).toBe('scored')
    expect(penalty(result, 'event_before_expiry_after_exit').points).toBe(5)
  })

  it('clamps the score at zero when penalties exceed the points earned', () => {
    const result = score({
      featureOverrides: { relativeStrength20dPct: -20, return5dPct: -9, distanceFromSma20Pct: -8, regimeScore: 1, realizedVolatility20dPct: null },
      contractOverrides: { todayVolume: 1, previousVolume: 800, openInterest: 100, bidSize: 1, askSize: 1 },
      scenarioOverrides: { bid: 5.25, ask: 5.8, decayPctOfEntryPremium: -30, gamma: 0.0001, delta: 0.16, requiredMoveInImpliedMoves: 2.5 },
      ivContext: { percentile: 99, sampleSize: 180, window: '1y', evidenceId: 'c'.repeat(64) },
    })
    expect(result.score).toBe(0)
    expect(result.penaltyPoints).toBeGreaterThan(0)
  })
})

describe('component behaviour', () => {
  it('charges carry once when unchanged-IV and shocked-IV returns decay equally', () => {
    const lessCarry = score({ scenarioOverrides: { decayPctOfEntryPremium: -4, ivDownReturnPct: -16 } })
    const moreCarry = score({ scenarioOverrides: { decayPctOfEntryPremium: -10, ivDownReturnPct: -22 } })
    expect(componentPoints(lessCarry, 'ivVega')).toBe(componentPoints(moreCarry, 'ivVega'))
    expect(lessCarry.score - moreCarry.score).toBeCloseTo(componentPoints(lessCarry, 'thetaEfficiency') - componentPoints(moreCarry, 'thetaEfficiency'), 3)
  })

  it('does not expand the underlying move budget when option IV alone rises', () => {
    const low = score({ scenarioOverrides: { impliedVolatility: 0.3 } })
    const high = score({ scenarioOverrides: { impliedVolatility: 0.6 } })
    expect(componentPoints(low, 'expectedMoveCompatibility')).toBe(componentPoints(high, 'expectedMoveCompatibility'))
    expect(high.score).toBeLessThan(low.score)
  })
  it('plateaus delta exposure in the .25-.45 band and tapers to the .15/.60 shoulders', () => {
    const at = (delta) => componentPoints(score({ scenarioOverrides: { delta } }), 'deltaExposure')
    expect(at(0.35)).toBe(10)
    expect(at(0.25)).toBe(10)
    expect(at(0.45)).toBe(10)
    expect(at(0.15)).toBe(0)
    expect(at(0.60)).toBe(0)
    expect(at(0.20)).toBeCloseTo(5, 3)
    expect(at(0.525)).toBeCloseTo(5, 3)
    // A tiny delta must not out-score a sensible one just by being cheap.
    expect(at(0.16)).toBeLessThan(at(0.35))
  })

  it('saturates convexity instead of rewarding raw gamma without bound', () => {
    const at = (gamma) => componentPoints(score({ scenarioOverrides: { gamma } }), 'convexity')
    expect(at(0.04)).toBeGreaterThan(at(0.02))
    expect(at(2)).toBeLessThanOrEqual(10)
    expect(at(2) - at(1)).toBeLessThan(at(0.04) - at(0.02))
  })

  it('rewards a lower carry loss over the primary horizon', () => {
    const at = (decay) => componentPoints(score({ scenarioOverrides: { decayPctOfEntryPremium: decay } }), 'thetaEfficiency')
    expect(at(-2)).toBe(10)
    expect(at(-9)).toBeGreaterThan(0)
    expect(at(-9)).toBeLessThan(at(-4))
    expect(at(-15)).toBe(0)
  })

  it('rewards a required move well inside the horizon move budget', () => {
    const at = (moves) => componentPoints(score({ scenarioOverrides: { requiredMoveInImpliedMoves: moves } }), 'expectedMoveCompatibility')
    expect(at(0.2)).toBe(10)
    expect(at(0.6)).toBeLessThan(10)
    expect(at(1.2)).toBe(0)
    expect(componentPoints(score({ scenarioOverrides: { solved: false } }), 'expectedMoveCompatibility')).toBe(0)
  })

  it('scores percentage friction independently of premium denomination', () => {
    const tight = componentPoints(score({ scenarioOverrides: { bid: 5.48, ask: 5.52 } }), 'liquidity')
    const wide = componentPoints(score({ scenarioOverrides: { bid: 5.25, ask: 5.8 } }), 'liquidity')
    expect(tight).toBeGreaterThan(wide)
    const expensive = componentPoints(score({ scenarioOverrides: { bid: 39.6, ask: 40.4 } }), 'liquidity')
    expect(expensive).toBe(tight)
  })

  it('awards no catalyst points in non-event mode and records why', () => {
    const result = score()
    const catalyst = result.components.find((component) => component.component === 'catalystQuality')
    expect(catalyst).toMatchObject({ max: 10, attainable: 0, points: 0 })
    expect(catalyst.features[0].reason).toBe('non_event_mode_excludes_horizon_events')
  })
})

describe('rankOptionsScores', () => {
  function scored({ contractId, score: total, spreadPct, securityId = 'sec:EX', direction = 'call', status = 'scored' }) {
    return {
      status, score: total, securityId, ticker: 'EX', direction, eventCohort: 'non_event',
      contract: { contractId }, tieBreakers: { spreadPct, contractId },
    }
  }

  it('breaks ties by tighter spread, then by contract ID', () => {
    const ranking = rankOptionsScores([
      scored({ contractId: 'osi:C', score: 70, spreadPct: 2 }),
      scored({ contractId: 'osi:A', score: 70, spreadPct: 4 }),
      scored({ contractId: 'osi:B', score: 70, spreadPct: 2 }),
      scored({ contractId: 'osi:D', score: 81, spreadPct: 9 }),
    ])
    expect(ranking.ranked.map((entry) => entry.contract.contractId)).toEqual(['osi:D', 'osi:B', 'osi:C', 'osi:A'])
    expect(ranking.ranked.map((entry) => entry.rank)).toEqual([1, 2, 3, 4])
  })

  it('preserves every eligible rank and caps display at two per underlying and direction', () => {
    const ranking = rankOptionsScores([
      scored({ contractId: 'osi:1', score: 90, spreadPct: 1 }),
      scored({ contractId: 'osi:2', score: 80, spreadPct: 1 }),
      scored({ contractId: 'osi:3', score: 70, spreadPct: 1 }),
      scored({ contractId: 'osi:4', score: 60, spreadPct: 1, direction: 'put' }),
      scored({ contractId: 'osi:5', score: 50, spreadPct: 1, securityId: 'sec:OTHER' }),
    ])
    expect(ranking.ranked).toHaveLength(5)
    expect(ranking.displayed.map((entry) => entry.contract.contractId)).toEqual(['osi:1', 'osi:2', 'osi:4', 'osi:5'])
    const hidden = ranking.ranked.find((entry) => entry.contract.contractId === 'osi:3')
    expect(hidden.rank).toBe(3)
    expect(hidden.display).toMatchObject({ visible: false, reason: 'underlying_direction_display_cap' })
  })

  it('keeps ineligible contracts out of the ranking but not out of the record', () => {
    const ranking = rankOptionsScores([
      scored({ contractId: 'osi:1', score: 90, spreadPct: 1 }),
      { status: 'ineligible', score: null, securityId: 'sec:EX', direction: 'call', eventCohort: 'non_event',
        contract: { contractId: 'osi:X' }, blockers: [{ code: 'hard_gate_failed', detail: 'zero_bid' }] },
    ])
    expect(ranking.ranked).toHaveLength(1)
    expect(ranking.ineligible).toHaveLength(1)
    expect(ranking.metrics).toMatchObject({ scoredCount: 1, ineligibleCount: 1, displayedCount: 1 })
  })

  it('refuses to rank event and non-event cohorts together', () => {
    expect(() => rankOptionsScores([
      scored({ contractId: 'osi:1', score: 90, spreadPct: 1 }),
      { ...scored({ contractId: 'osi:2', score: 80, spreadPct: 1 }), eventCohort: 'earnings_event' },
    ])).toThrow(/cohort/i)
  })

  it('produces the same order whatever order the contracts arrive in', () => {
    const entries = [
      scored({ contractId: 'osi:1', score: 90, spreadPct: 3 }),
      scored({ contractId: 'osi:2', score: 90, spreadPct: 1 }),
      scored({ contractId: 'osi:3', score: 44, spreadPct: 1 }),
    ]
    const forward = rankOptionsScores(entries).ranked.map((entry) => entry.contract.contractId)
    const backward = rankOptionsScores([...entries].reverse()).ranked.map((entry) => entry.contract.contractId)
    expect(backward).toEqual(forward)
  })
})

describe('determinism', () => {
  it('produces byte-identical scores from the same frozen inputs', () => {
    expect(digest(score())).toBe(digest(score()))
  })
})

describe('diagnoseOptionsScorePolicy', () => {
  function population() {
    return [0.35, 0.3, 0.28, 0.4, 0.22, 0.5].map((delta, index) => score({
      contractOverrides: { contractId: `osi:EX261016C0018500${index}` },
      scenarioOverrides: { delta, gamma: 0.01 + index * 0.004, decayPctOfEntryPremium: -4 - index },
    }))
  }

  it('reports pairwise component correlation and flags duplicated signals', () => {
    const diagnostics = diagnoseOptionsScorePolicy(population())
    expect(diagnostics.sampleSize).toBe(6)
    const pair = diagnostics.correlations.find((item) => item.components.includes('convexity') && item.components.includes('thetaEfficiency'))
    expect(typeof pair.correlation).toBe('number')
    expect(diagnostics.flagged.every((item) => Math.abs(item.correlation) >= diagnostics.correlationThreshold)).toBe(true)
  })

  it('reports how far the ranking moves when each component is ablated', () => {
    const diagnostics = diagnoseOptionsScorePolicy(population())
    const ablation = diagnostics.ablations.find((item) => item.component === 'deltaExposure')
    expect(ablation).toMatchObject({ component: 'deltaExposure' })
    expect(ablation.maxRankDisplacement).toBeGreaterThanOrEqual(0)
    expect(diagnostics.ablations).toHaveLength(9)
  })

  it('declines to report correlations it has no sample for', () => {
    const diagnostics = diagnoseOptionsScorePolicy([score()])
    expect(diagnostics.insufficientSample).toBe(true)
    expect(diagnostics.correlations).toEqual([])
  })
})

describe('createOptionsScoreAuditRecord', () => {
  it('archives the full ranking, the display caps and the frozen policy', () => {
    const ranking = rankOptionsScores([score(), score({ contractOverrides: { contractId: 'osi:EX261016C00190000' } })])
    const record = createOptionsScoreAuditRecord({
      scanId: `${TRADING_DATE}:opening:options-morning-schedule-v1`,
      ranking,
      availableAt: '2026-09-22T13:33:00.000Z',
      modelVersion: 'options-american-crr-vellekoop-v1',
      inputHashes: ['b'.repeat(64)],
    })
    expect(record.recordType).toBe('score')
    expect(record.archiveKind).toBe('options-score')
    expect(record.versions).toMatchObject({ policy: OPTIONS_SCORE_POLICY_VERSION, model: 'options-american-crr-vellekoop-v1' })
    expect(record.payload.scores).toHaveLength(2)
    expect(record.payload.display.maxPerUnderlyingDirection).toBe(2)
    expect(record.payload.policy.components).toEqual(OPTIONS_SCORE_POLICY.components)
    expect(validateOptionsAuditRecord(record)).toBe(record)
  })

  it('keeps a rejected contract trace beside the selected one', () => {
    const ranking = rankOptionsScores([
      score(),
      score({ contractOverrides: { contractId: 'osi:EX261016C00190000' }, gate: { status: 'rejected', reason: 'zero_bid' } }),
    ])
    const record = createOptionsScoreAuditRecord({
      scanId: 'scan', ranking, availableAt: '2026-09-22T13:33:00.000Z', modelVersion: 'm',
    })
    expect(record.payload.ineligible[0].blockers[0]).toMatchObject({ code: 'hard_gate_failed', detail: 'zero_bid' })
  })
})

describe('integration with #210 scenario sets', () => {
  it('scores a contract against a real, repriced scenario set', () => {
    const real = buildContractScenarioSet({
      contract: {
        contractId: 'osi:EX261016C00185000', osiSymbol: 'EX261016C00185000', type: 'call', strikePrice: 185,
        expirationDate: EXPIRATION, quote: { bid: 5.4, ask: 5.6, marketAt: AS_OF },
      },
      underlyingPrice: 180, asOf: AS_OF, tradingDate: TRADING_DATE, riskFreeRate: 0.04,
      horizons: OPTIONS_SCENARIO_RANKING_PROFILE.horizons, targets: OPTIONS_SCENARIO_RANKING_PROFILE.targets,
    })
    expect(real.publishable).toBe(true)
    const result = score({ scenarioSet: real })
    expect(result.status).toBe('scored')
    expect(result.score).toBeGreaterThan(0)
    expect(componentPoints(result, 'thetaEfficiency')).toBeGreaterThan(0)
    expect(componentPoints(result, 'deltaExposure')).toBeGreaterThan(0)
  })
})
