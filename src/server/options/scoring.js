// Deterministic contract scoring and explanation traces (epic #201 section 10, story #211).
//
// Answers "why was this contract shown, ahead of that one, that morning?" with
// a number a reader can rebuild by hand from the frozen inputs. Everything here
// is arithmetic over values that were already observed and archived: no model
// is called, no LLM is consulted, and no ordering depends on the order the
// contracts arrived in.
//
// Three rules shape the whole module.
//
// Hard failures are not penalties. A stale quote, a failed calibration or an
// event inside the holding horizon makes a contract INELIGIBLE -- it carries
// blockers and no components at all. A contract that cannot be valued must not
// be able to out-rank one that can by being strong somewhere else.
//
// Missing data never scores well. Every feature that is absent scores zero and
// says why. Missing risk inputs retain the existing worst-case deduction;
// required model attributions fail closed. Silence never improves a score.
//
// The weights are a v0 hypothesis. They were fitted on nothing, they are frozen
// before any holdout is touched, and the score they produce is a ranking device,
// not a probability of profit or an expected return.

import { digest } from '../research/archive.js'
import { createOptionsAuditRecord } from './audit.js'
import { OPTIONS_SCENARIO_PRIMARY_HORIZON } from './scenarios.js'
import { OPTIONS_CHAIN_DELTA_RANGE, optionsContractCohort } from './chainGates.js'

export const OPTIONS_SCORE_POLICY_VERSION = 'options-deterministic-score-v1'
export const OPTIONS_SCORE_CODE_VERSION = 'options-scoring-v2'

// Transform identities. They are stored on every feature trace so a score can
// be rebuilt years later against the transform that actually produced it,
// rather than against whatever the function is called today.
const RAMP = 'clipped-linear-ramp-v1'
const PLATEAU = 'plateau-with-linear-shoulders-v1'
const SATURATING = 'saturating-ratio-v1'
const LOG_RAMP = 'log10-scaled-ramp-v1'
const DIRECT = 'constant-v1'

export const OPTIONS_SCORE_POLICY = Object.freeze({
  version: OPTIONS_SCORE_POLICY_VERSION,
  codeVersion: OPTIONS_SCORE_CODE_VERSION,
  // Stated, not implied: nothing below was chosen by looking at outcomes.
  weightsFittedOn: 'none-frozen-v0-hypothesis',
  scoreRange: Object.freeze({ min: 0, max: 100 }),
  attainableComponentPoints: 90,
  // Scores are only comparable across contracts because every one of them is
  // measured at the same horizon against the same premium target.
  primaryHorizonId: OPTIONS_SCENARIO_PRIMARY_HORIZON,
  primaryPremiumTargetPct: 25,
  primaryIvMultiplier: 1,
  ivDownMultiplier: 0.9,
  components: Object.freeze({
    underlyingSetup: 15,
    technicalConfirmation: 10,
    catalystQuality: 10,
    deltaExposure: 10,
    convexity: 10,
    thetaEfficiency: 10,
    ivVega: 10,
    liquidity: 15,
    expectedMoveCompatibility: 10,
  }),
  transforms: Object.freeze({
    relativeStrength: Object.freeze({ id: RAMP, zero: 0, full: 10, max: 10 }),
    regimeAgreement: Object.freeze({ id: RAMP, zero: 4, full: 8, max: 5 }),
    trendAlignment: Object.freeze({ id: RAMP, zero: 0, full: 5, max: 5 }),
    breakoutProximity: Object.freeze({ id: RAMP, zero: 0, full: 5, max: 5 }),
    deltaExposure: Object.freeze({ id: PLATEAU, lowZero: 0.15, lowFull: 0.25, highFull: 0.45, highZero: 0.60, max: 10 }),
    // The fixed move the gamma contribution is measured over, and the
    // half-saturation point: a contract whose convexity term equals 1% of its
    // own premium scores half of the ten points. Raw gamma is never compared
    // across underlyings -- a $40 stock's gamma is not a $400 stock's gamma.
    convexity: Object.freeze({ id: SATURATING, movePct: 1, half: 0.01, max: 10 }),
    // Zero points land exactly on the decay penalty threshold, so the two
    // never grade the same dollar of carry twice.
    thetaEfficiency: Object.freeze({ id: RAMP, zero: 15, full: 3, max: 10 }),
    historicalIvPercentile: Object.freeze({ id: RAMP, zero: 70, full: 30, max: 4 }),
    impliedToRealized: Object.freeze({ id: RAMP, zero: 1.6, full: 1.0, max: 3 }),
    ivDownResilience: Object.freeze({ id: RAMP, zero: -25, full: -5, max: 3 }),
    relativeSpread: Object.freeze({ id: RAMP, zero: 10, full: 2, max: 8 }),
    openInterest: Object.freeze({ id: LOG_RAMP, zero: 100, full: 10000, max: 4 }),
    sessionVolume: Object.freeze({ id: LOG_RAMP, zero: 5, full: 500, max: 2 }),
    quoteSizes: Object.freeze({ id: LOG_RAMP, zero: 1, full: 25, max: 1 }),
    expectedMove: Object.freeze({ id: RAMP, zero: 1.0, full: 0.25, max: 10 }),
  }),
  penalties: Object.freeze({
    // Inside the gates (spread <= 10%), the upper half of the band still costs.
    wide_spread: Object.freeze({ transform: RAMP, zero: 5, full: 10, max: 5, units: 'percent of mid' }),
    volume_only_by_prior_session: Object.freeze({ transform: RAMP, points: 3, minTodayVolume: 5, zero: 5, full: 0, max: 3 }),
    iv_above_90th_percentile: Object.freeze({ transform: RAMP, points: 5, percentile: 90, zero: 90, full: 100, max: 5 }),
    // Continue the existing theta shoulder's slope (10 / (15 - 3)) until the
    // existing five-point cap: 15 + 5 / (10 / 12) = 21. No new slope fitted.
    decay_above_horizon_limit: Object.freeze({ transform: RAMP, points: 5, maxDecayPctOfEntry: 15, zero: 15, full: 21, max: 5 }),
    event_before_expiry_after_exit: Object.freeze({ transform: DIRECT, points: 5 }),
  }),
  // A dated event inside the holding horizon is an exclusion in the default
  // cohort, not a deduction: the scenario matrix's +-10% IV shocks are not
  // calibrated for an earnings crush, so a scored event contract would be
  // priced by a model that does not describe it.
  eventPolicy: Object.freeze({
    defaultCohort: 'non_event',
    onKnownEventInHorizon: 'exclude',
    onUnknownCoverage: 'flag',
    unknownTimingCountsAsInHorizon: true,
  }),
  missingDataPolicy: Object.freeze({
    featurePoints: 'zero',
    absentPenaltyInput: 'worst_case_existing_penalty_or_exclude_required_model_input',
    unknownEventCoverage: 'flag',
    hardGateOrModelInput: 'exclude',
  }),
  display: Object.freeze({ maxPerUnderlyingDirection: 2 }),
  // Declared rather than silently skipped: term structure needs the sibling
  // expirations of the same chain, which the v0 record does not carry.
  deferredFeatures: Object.freeze([
    Object.freeze({ feature: 'ivTermStructure', allocatedPoints: 0, reason: 'sibling_expiration_observations_not_in_v0_record' }),
  ]),
})

const COMPONENT_ORDER = Object.freeze(Object.keys(OPTIONS_SCORE_POLICY.components))

export const OPTIONS_SCORE_INTERPRETATION = Object.freeze({
  scale: '0-100 deterministic research score',
  isWinProbability: false,
  isExpectedReturnPct: false,
  note: 'A frozen v0 ranking hypothesis over observed inputs. Not a probability of profit, not an expected return, not a recommendation.',
})

function round(value, digits = 3) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits))
}

function numeric(value) {
  return Number.isFinite(value) ? value : null
}

// Clipped linear ramp: `zero` points at or beyond `zero`, `max` at or beyond
// `full`, linear between. Works in both directions -- `zero > full` is a
// declining ramp, which is how "less decay is better" is expressed.
export function clippedLinearRamp(value, { zero, full, max }) {
  if (value == null || !Number.isFinite(value)) return 0
  if (zero === full) throw new Error('A ramp needs distinct zero and full points')
  const fraction = (value - zero) / (full - zero)
  return round(Math.max(0, Math.min(1, fraction)) * max)
}

function plateauWithShoulders(value, { lowZero, lowFull, highFull, highZero, max }) {
  if (value == null || !Number.isFinite(value)) return 0
  if (value <= lowZero || value >= highZero) return 0
  if (value >= lowFull && value <= highFull) return round(max)
  return value < lowFull
    ? round(((value - lowZero) / (lowFull - lowZero)) * max)
    : round(((highZero - value) / (highZero - highFull)) * max)
}

function saturatingRatio(value, { half, max }) {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0
  return round((max * value) / (value + half))
}

function log10ScaledRamp(value, { zero, full, max }) {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0
  return clippedLinearRamp(Math.log10(value), { zero: Math.log10(zero), full: Math.log10(full), max })
}

function feature({ name, raw, units, window, transform, params, points, reason = null, evidenceIds = [] }) {
  return {
    feature: name,
    raw: raw == null || !Number.isFinite(raw) ? (typeof raw === 'string' ? raw : null) : round(raw, 6),
    units,
    window,
    transform,
    transformParams: params ? { ...params } : null,
    points: round(points),
    reason,
    evidenceIds,
  }
}

function component(name, features, { attainable = null } = {}) {
  const max = OPTIONS_SCORE_POLICY.components[name]
  const points = round(features.reduce((sum, item) => sum + item.points, 0))
  if (points > max + 1e-9) throw new Error(`${name} scored ${points} above its declared maximum ${max}`)
  return { component: name, max, attainable: attainable == null ? max : attainable, points, features }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function underlyingSetup({ features: record, direction, evidence }) {
  const transforms = OPTIONS_SCORE_POLICY.transforms
  const signed = record.directional[direction]
  const regimeScore = record.regime?.score ?? null
  // A constructive tape supports calls and a defensive one supports puts, so
  // the put reads the mirrored score rather than a second hand-written rule.
  const regimeAligned = regimeScore == null ? null : direction === 'call' ? regimeScore : 10 - regimeScore
  return component('underlyingSetup', [
    feature({
      name: 'relativeStrength20d', raw: signed.relativeStrength20dPct, units: 'percent vs benchmark',
      window: `20 sessions lagged through ${record.technicals.laggedThrough}`,
      transform: transforms.relativeStrength.id, params: transforms.relativeStrength,
      points: clippedLinearRamp(signed.relativeStrength20dPct, transforms.relativeStrength),
      reason: signed.relativeStrength20dPct == null ? 'insufficient_lagged_history' : null,
      evidenceIds: evidence.features,
    }),
    feature({
      name: 'marketRegimeAgreement', raw: regimeAligned, units: 'regime score 0-10 aligned to direction',
      window: 'latest regime observation visible at freeze',
      transform: transforms.regimeAgreement.id, params: transforms.regimeAgreement,
      points: clippedLinearRamp(regimeAligned, transforms.regimeAgreement),
      reason: regimeScore == null ? 'regime_observation_unavailable' : null,
      evidenceIds: evidence.features,
    }),
  ])
}

function technicalConfirmation({ features: record, direction, evidence }) {
  const transforms = OPTIONS_SCORE_POLICY.transforms
  const signed = record.directional[direction]
  const distance = record.technicals.distanceFromSma20Pct
  const signedDistance = distance == null ? null : direction === 'call' ? distance : -distance
  return component('technicalConfirmation', [
    feature({
      name: 'trendAlignment5d', raw: signed.return5dPct, units: 'percent',
      window: `5 sessions lagged through ${record.technicals.laggedThrough}`,
      transform: transforms.trendAlignment.id, params: transforms.trendAlignment,
      points: clippedLinearRamp(signed.return5dPct, transforms.trendAlignment),
      reason: signed.return5dPct == null ? 'insufficient_lagged_history' : null,
      evidenceIds: evidence.features,
    }),
    feature({
      name: 'breakoutProximity', raw: signedDistance, units: 'percent from 20-session SMA',
      window: `20 sessions lagged through ${record.technicals.laggedThrough}`,
      transform: transforms.breakoutProximity.id, params: transforms.breakoutProximity,
      points: clippedLinearRamp(signedDistance, transforms.breakoutProximity),
      reason: signedDistance == null ? 'insufficient_lagged_history' : null,
      evidenceIds: evidence.features,
    }),
  ])
}

// Nominally ten points, attainably zero. In the default non-event cohort a
// dated event inside the holding horizon excludes the contract outright, and
// the epic's own rule is that no event scores zero -- so there is no input
// today that can put a point here. The maximum stays at ten so the declared
// component maxima still sum to 100; `attainable` is what a reader should
// compare against.
function catalystQuality({ features: record, mode, evidence }) {
  const coverage = record.nonEventHorizon?.state ?? 'unknown'
  return component('catalystQuality', [
    feature({
      name: 'horizonCatalyst', raw: coverage, units: 'non-event horizon state',
      window: `holding horizon through ${record.nonEventHorizon?.through ?? 'unknown'}`,
      transform: DIRECT, params: null, points: 0,
      reason: mode === 'non_event' ? 'non_event_mode_excludes_horizon_events' : 'event_cohort_policy_not_implemented',
      evidenceIds: evidence.features,
    }),
  ], { attainable: 0 })
}

function deltaExposure({ entry, evidence }) {
  const transforms = OPTIONS_SCORE_POLICY.transforms
  // The locally calibrated delta, not the provider's: provider analytics here
  // carry no timestamp, and an undated Greek cannot anchor a score.
  const absDelta = entry.greeks?.delta == null ? null : Math.abs(entry.greeks.delta)
  return component('deltaExposure', [
    feature({
      name: 'absoluteDelta', raw: absDelta, units: 'delta per $1 of underlying',
      window: 'entry state, locally calibrated',
      transform: transforms.deltaExposure.id, params: transforms.deltaExposure,
      points: plateauWithShoulders(absDelta, transforms.deltaExposure),
      reason: absDelta == null ? 'model_delta_unavailable' : null,
      evidenceIds: evidence.scenarios,
    }),
  ])
}

function convexity({ entry, evidence }) {
  const transforms = OPTIONS_SCORE_POLICY.transforms
  const gamma = numeric(entry.greeks?.gamma)
  const move = entry.underlyingPrice * (transforms.convexity.movePct / 100)
  // Second-order value of a fixed 1% move, expressed as a fraction of the
  // premium paid for it. Normalising by premium is what makes it comparable
  // across a $4 contract and a $40 one.
  const ratio = gamma == null || !(entry.mid > 0) ? null : (0.5 * gamma * move * move) / entry.mid
  return component('convexity', [
    feature({
      name: 'gammaValuePerPremium', raw: ratio, units: `fraction of entry premium per ${transforms.convexity.movePct}% move`,
      window: 'entry state, locally calibrated',
      transform: transforms.convexity.id, params: transforms.convexity,
      points: saturatingRatio(ratio, transforms.convexity),
      reason: ratio == null ? 'model_gamma_unavailable' : null,
      evidenceIds: evidence.scenarios,
    }),
  ])
}

function thetaEfficiency({ decay, evidence }) {
  const transforms = OPTIONS_SCORE_POLICY.transforms
  // Carry loss is the full repricing difference at unchanged stock and IV, as
  // a positive percentage of the entry premium. Theta itself is never used:
  // it is a point-in-time rate, and the repriced loss is the real number.
  const carryLossPct = decay?.decayPctOfEntryPremium == null ? null : -decay.decayPctOfEntryPremium
  return component('thetaEfficiency', [
    feature({
      name: 'carryLossOverPrimaryHorizon', raw: carryLossPct, units: 'percent of entry premium',
      window: `${OPTIONS_SCORE_POLICY.primaryHorizonId}, stock and IV unchanged`,
      transform: transforms.thetaEfficiency.id, params: transforms.thetaEfficiency,
      points: clippedLinearRamp(carryLossPct, transforms.thetaEfficiency),
      reason: carryLossPct == null ? 'time_only_decay_unavailable' : null,
      evidenceIds: evidence.scenarios,
    }),
  ])
}

function ivVega({ features: record, entry, ivContext, ivDownRow, evidence }) {
  const transforms = OPTIONS_SCORE_POLICY.transforms
  const percentile = numeric(ivContext?.percentile)
  const realized = numeric(record.technicals.realizedVolatility20dPct)
  const ivToRv = realized == null || !(realized > 0) || entry.impliedVolatility == null
    ? null
    : entry.impliedVolatility / (realized / 100)
  // Isolate the IV shock at the SAME exit time. The total shocked return also
  // contains carry, already graded in thetaEfficiency.
  const resilience = numeric(ivDownRow?.ivOnlyReturnPct)
  return component('ivVega', [
    feature({
      name: 'historicalIvPercentile', raw: percentile, units: 'percentile of own comparable history',
      window: ivContext?.window ?? 'same tenor and moneyness history',
      transform: transforms.historicalIvPercentile.id, params: transforms.historicalIvPercentile,
      points: clippedLinearRamp(percentile, transforms.historicalIvPercentile),
      reason: percentile == null ? 'historical_iv_context_unavailable' : null,
      evidenceIds: ivContext?.evidenceId ? [ivContext.evidenceId] : [],
    }),
    feature({
      name: 'impliedToRealizedVolatility', raw: ivToRv, units: 'ratio of calibrated IV to 20-session RV',
      window: `20 sessions lagged through ${record.technicals.laggedThrough}`,
      transform: transforms.impliedToRealized.id, params: transforms.impliedToRealized,
      points: clippedLinearRamp(ivToRv, transforms.impliedToRealized),
      reason: ivToRv == null ? 'realized_volatility_comparator_unavailable' : null,
      evidenceIds: evidence.features,
    }),
    feature({
      name: 'ivDownResilience', raw: resilience, units: 'incremental IV loss as percent of entry midpoint',
      window: `${OPTIONS_SCORE_POLICY.primaryHorizonId}, stock unchanged, IV x${OPTIONS_SCORE_POLICY.ivDownMultiplier}`,
      transform: transforms.ivDownResilience.id, params: transforms.ivDownResilience,
      points: clippedLinearRamp(resilience, transforms.ivDownResilience),
      reason: resilience == null ? 'iv_down_scenario_unavailable' : null,
      evidenceIds: evidence.scenarios,
    }),
  ])
}

function liquidity({ contract: gated, entry, evidence }) {
  const transforms = OPTIONS_SCORE_POLICY.transforms
  const spreadPct = numeric(entry.spreadPct)
  const spreadAbsolute = entry.ask == null || entry.bid == null ? null : entry.ask - entry.bid
  const relativePoints = clippedLinearRamp(spreadPct, transforms.relativeSpread)
  // Rank return on premium, not arbitrary dollar denomination. A proportional
  // stock split preserves percentage friction; the dollar spread is diagnostic.
  const todayVolume = numeric(gated.volume?.value)
  const sizes = [numeric(gated.quote?.bidSize), numeric(gated.quote?.askSize)]
  const minSize = sizes.some((size) => size == null) ? null : Math.min(...sizes)
  return component('liquidity', [
    feature({
      name: 'relativeSpread', raw: spreadPct, units: 'percent of mid', window: 'synchronized entry quote',
      transform: transforms.relativeSpread.id, params: transforms.relativeSpread,
      points: relativePoints,
      reason: spreadPct == null ? 'entry_quote_unavailable' : null,
      evidenceIds: evidence.chain,
    }),
    feature({
      name: 'absoluteSpread', raw: spreadAbsolute, units: 'dollars per share', window: 'synchronized entry quote',
      transform: DIRECT, params: { max: 0 }, points: 0,
      reason: spreadAbsolute == null ? 'entry_quote_unavailable' : 'diagnostic_only_percentage_return_objective',
      evidenceIds: evidence.chain,
    }),
    feature({
      name: 'openInterest', raw: numeric(gated.openInterest), units: 'contracts',
      window: `prior session close, as of ${gated.openInterestDate ?? 'unknown'}`,
      transform: transforms.openInterest.id, params: transforms.openInterest,
      points: log10ScaledRamp(numeric(gated.openInterest), transforms.openInterest),
      reason: gated.openInterest == null ? 'open_interest_unavailable' : null,
      evidenceIds: evidence.chain,
    }),
    feature({
      name: 'sessionVolume', raw: todayVolume, units: 'contracts',
      window: `${gated.volume?.session ?? 'rth'} session ${gated.volume?.sessionDate ?? 'unknown'}`,
      transform: transforms.sessionVolume.id, params: transforms.sessionVolume,
      points: log10ScaledRamp(todayVolume, transforms.sessionVolume),
      reason: todayVolume == null ? 'session_volume_unavailable' : null,
      evidenceIds: evidence.chain,
    }),
    feature({
      name: 'displayedQuoteSize', raw: minSize, units: 'contracts on the thinner side',
      window: 'synchronized entry quote',
      transform: transforms.quoteSizes.id, params: transforms.quoteSizes,
      points: log10ScaledRamp(minSize, transforms.quoteSizes),
      reason: minSize == null ? 'quote_sizes_unavailable' : null,
      evidenceIds: evidence.chain,
    }),
  ])
}

function expectedMoveCompatibility({ target, features: record, primaryHorizon, direction, evidence }) {
  const transforms = OPTIONS_SCORE_POLICY.transforms
  // An option must not expand its own move budget merely by becoming more
  // expensive. Use the frozen underlying RV, shared by all its strikes/tenors.
  // Annualized RV is spread over calendar time consistently with scenario IV.
  const realized = numeric(record.technicals.realizedVolatility20dPct)
  const days = numeric(primaryHorizon?.calendarElapsedDays)
  const budget = realized > 0 && days > 0 ? realized * Math.sqrt(days / 365) : null
  const required = target?.solved && Number.isFinite(target.requiredMovePct) && budget > 0
    ? Math.max(0, (direction === 'call' ? 1 : -1) * target.requiredMovePct) / budget
    : null
  return component('expectedMoveCompatibility', [
    feature({
      name: 'requiredMoveInRealizedMoves', raw: required,
      units: `lagged RV move budgets to reach +${OPTIONS_SCORE_POLICY.primaryPremiumTargetPct}% net return`,
      window: OPTIONS_SCORE_POLICY.primaryHorizonId,
      transform: transforms.expectedMove.id, params: { ...transforms.expectedMove, moveBudgetPct: round(budget, 6), annualDays: 365 },
      points: clippedLinearRamp(required, transforms.expectedMove),
      reason: required == null ? (budget == null ? 'realized_move_budget_unavailable' : target?.reason || 'premium_target_solution_unavailable') : null,
      evidenceIds: [...evidence.scenarios, ...evidence.features],
    }),
  ])
}

// ---------------------------------------------------------------------------
// Penalties
// ---------------------------------------------------------------------------

function buildPenalties({ features: record, contract: gated, entry, decay, ivContext, events }) {
  const policy = OPTIONS_SCORE_POLICY.penalties
  const applied = []
  const inapplicable = []

  const spreadPct = numeric(entry.spreadPct)
  const spreadPoints = clippedLinearRamp(spreadPct, policy.wide_spread)
  if (spreadPoints > 0) {
    applied.push({ code: 'wide_spread', points: spreadPoints, raw: round(spreadPct, 4), units: policy.wide_spread.units,
      threshold: policy.wide_spread.zero, transform: policy.wide_spread.transform, reason: 'spread_in_upper_gate_band' })
  }

  const todayVolume = numeric(gated.volume?.value)
  if (todayVolume == null || todayVolume < policy.volume_only_by_prior_session.minTodayVolume) {
    applied.push({ code: 'volume_only_by_prior_session', points: todayVolume == null ? policy.volume_only_by_prior_session.points
      : clippedLinearRamp(todayVolume, policy.volume_only_by_prior_session),
      raw: todayVolume, units: 'contracts traded today', threshold: policy.volume_only_by_prior_session.minTodayVolume,
      transform: RAMP, transformParams: policy.volume_only_by_prior_session, reason: 'passed_volume_gate_on_prior_session_only' })
  }

  const percentile = numeric(ivContext?.percentile)
  if (percentile == null) {
    inapplicable.push({ code: 'iv_above_90th_percentile', reason: 'historical_iv_context_unavailable' })
    applied.push({ code: 'iv_above_90th_percentile', points: policy.iv_above_90th_percentile.points,
      raw: null, units: 'unknown percentile', threshold: policy.iv_above_90th_percentile.percentile,
      transform: DIRECT, reason: 'missing_input_uses_existing_worst_case_penalty' })
  } else if (percentile > policy.iv_above_90th_percentile.percentile) {
    applied.push({ code: 'iv_above_90th_percentile', points: clippedLinearRamp(percentile, policy.iv_above_90th_percentile), raw: percentile,
      units: 'percentile of own comparable history', threshold: policy.iv_above_90th_percentile.percentile,
      transform: RAMP, transformParams: policy.iv_above_90th_percentile, reason: 'implied_volatility_rich_against_own_history' })
  }

  const carryLossPct = decay?.decayPctOfEntryPremium == null ? null : -decay.decayPctOfEntryPremium
  if (carryLossPct == null) {
    inapplicable.push({ code: 'decay_above_horizon_limit', reason: 'time_only_decay_unavailable' })
  } else if (carryLossPct > policy.decay_above_horizon_limit.maxDecayPctOfEntry) {
    applied.push({ code: 'decay_above_horizon_limit', points: clippedLinearRamp(carryLossPct, policy.decay_above_horizon_limit),
      raw: round(carryLossPct, 4), units: 'percent of entry premium',
      threshold: policy.decay_above_horizon_limit.maxDecayPctOfEntry, transform: RAMP, transformParams: policy.decay_above_horizon_limit,
      reason: 'carry_loss_above_horizon_limit' })
  }

  const incompleteEvents = ['earnings', 'catalysts'].some((feed) => record.coverage?.[feed]?.status !== 'complete')
  if (events.afterExitBeforeExpiry.length || incompleteEvents) {
    applied.push({ code: 'event_before_expiry_after_exit', points: policy.event_before_expiry_after_exit.points,
      raw: events.afterExitBeforeExpiry[0]?.eventDate ?? null, units: 'event date', threshold: null, transform: DIRECT,
      reason: events.afterExitBeforeExpiry.length ? 'dated_event_between_intended_exit_and_expiry' : 'missing_input_uses_existing_worst_case_penalty',
      events: events.afterExitBeforeExpiry.map((event) => ({ eventId: event.eventId, eventDate: event.eventDate, kind: event.kind })) })
  }

  if (record.coverage?.earnings?.status && record.coverage.earnings.status !== 'complete') {
    inapplicable.push({ code: 'event_before_expiry_after_exit', reason: `earnings_coverage_${record.coverage.earnings.status}` })
  }

  return { applied, inapplicable }
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export function horizonEvents({ features: record, exitDate, expirationDate, tradingDate }) {
  const dated = [
    ...(record.events?.earnings || []).map((item) => ({ ...item, kind: 'earnings' })),
    ...(record.events?.catalysts || []).map((item) => ({ ...item, kind: item.kind || 'catalyst' })),
  ].filter((item) => item.eventDate >= tradingDate)
  // The exit is the close of the exit session, so an event dated that day is
  // inside the horizon unless it is known to land after that close. Unknown
  // timing counts as inside: "unknown" is never read as "safely after".
  const inHorizon = dated.filter((item) => item.eventDate < exitDate
    || (item.eventDate === exitDate && item.timing !== 'after_close'))
  const afterExitBeforeExpiry = dated.filter((item) => !inHorizon.includes(item) && item.eventDate <= expirationDate)
  return { dated, inHorizon, afterExitBeforeExpiry }
}

function ineligible({ identity, blockers, missing, eventCohort }) {
  return {
    ...identity,
    eventCohort,
    status: 'ineligible',
    score: null,
    componentPoints: null,
    penaltyPoints: null,
    components: [],
    penalties: [],
    inapplicablePenalties: [],
    blockers,
    missing,
    interpretation: OPTIONS_SCORE_INTERPRETATION,
  }
}

export function scoreOptionsContract({
  security,
  direction,
  contract: gated,
  features: record,
  scenarioSet,
  tradingDate,
  ivContext = null,
  gate = null,
  mode = OPTIONS_SCORE_POLICY.eventPolicy.defaultCohort,
  scenarioEvidenceId = null,
  policy = OPTIONS_SCORE_POLICY,
} = {}) {
  if (!security?.securityId || !security?.ticker) throw new Error('Scoring requires a resolved security identity')
  if (direction !== 'call' && direction !== 'put') throw new Error('direction must be call or put')
  if (!gated?.contractId) throw new Error('Scoring requires a gated contract')
  if (!record?.directional?.[direction]) throw new Error('Scoring requires a point-in-time feature record')
  if (!scenarioSet) throw new Error('Scoring requires a scenario set')
  if (policy.version !== OPTIONS_SCORE_POLICY_VERSION) throw new Error('Unsupported options score policy version')
  const ivCutoff = record.freezeAt || scenarioSet.asOf
  if (ivContext && (!Number.isFinite(ivContext.percentile) || ivContext.percentile < 0 || ivContext.percentile > 100
    || (ivContext.availableAt && !(Date.parse(ivContext.availableAt) <= Date.parse(ivCutoff))))) ivContext = null

  const evidence = {
    features: record.recordId ? [record.recordId] : [],
    chain: gated.rawReferenceHash ? [gated.rawReferenceHash] : [],
    scenarios: [scenarioEvidenceId || digest(scenarioSet)],
  }
  const identity = {
    policyVersion: policy.version,
    codeVersion: OPTIONS_SCORE_CODE_VERSION,
    modelVersion: scenarioSet.modelVersion || null,
    scenarioPolicyVersion: scenarioSet.policyVersion || null,
    featureVersion: record.featureVersion || null,
    securityId: security.securityId,
    ticker: security.ticker,
    direction,
    tradingDate,
    cohort: gated.cohort || null,
    contract: {
      contractId: gated.contractId,
      osiSymbol: gated.osiSymbol || null,
      type: gated.type,
      strikePrice: gated.strikePrice,
      expirationDate: gated.expirationDate,
      dte: gated.dte ?? null,
    },
    evidenceIds: evidence,
  }

  const blockers = []
  const missing = []
  if (gated.type !== direction || scenarioSet.contract?.type !== direction) blockers.push({ code: 'contract_direction_mismatch', detail: direction })
  if (gate && gate.status !== 'accepted') blockers.push({ code: 'hard_gate_failed', detail: gate.reason || 'unspecified' })
  for (const blocker of scenarioSet.blockers || []) blockers.push({ code: 'scenarios_not_publishable', detail: blocker.code })
  if (!scenarioSet.publishable && !(scenarioSet.blockers || []).length) blockers.push({ code: 'scenarios_not_publishable', detail: 'unspecified' })

  const primaryHorizon = (scenarioSet.horizons || []).find((horizon) => horizon.id === policy.primaryHorizonId && horizon.status === 'available')
  if (!primaryHorizon) blockers.push({ code: 'primary_horizon_unavailable', detail: policy.primaryHorizonId })

  const eventCohort = mode === 'non_event' ? 'non_event' : 'earnings_event'
  if (mode !== 'non_event') {
    blockers.push({ code: 'event_cohort_policy_not_implemented', detail: mode })
  }

  const events = primaryHorizon
    ? horizonEvents({ features: record, exitDate: primaryHorizon.exitDate, expirationDate: gated.expirationDate, tradingDate })
    : { dated: [], inHorizon: [], afterExitBeforeExpiry: [] }
  if (mode === 'non_event' && events.inHorizon.length) {
    blockers.push({
      code: 'event_exposure_in_holding_horizon',
      detail: events.inHorizon.map((event) => `${event.kind}:${event.eventDate}`).join(','),
    })
  }
  for (const feed of ['earnings', 'catalysts']) {
    const status = record.coverage?.[feed]?.status
    if (status !== 'complete') {
      missing.push({ path: `coverage.${feed}`, reason: `coverage_${status || 'unknown'}` })
      if (policy.eventPolicy.onUnknownCoverage === 'exclude') blockers.push({ code: 'event_coverage_incomplete', detail: feed })
    }
  }

  const entry = scenarioSet.entry || {}
  const decay = (scenarioSet.timeOnlyDecay || []).find((item) => item.horizonId === policy.primaryHorizonId) || null
  const shockedRow = (scenarioSet.scenarios || []).find((row) => row.horizonId === policy.primaryHorizonId
    && row.movePct === 0 && row.ivMultiplier === policy.ivDownMultiplier) || null
  const unchangedRow = (scenarioSet.scenarios || []).find((row) => row.horizonId === policy.primaryHorizonId
    && row.movePct === 0 && row.ivMultiplier === 1)
  const carryReturn = numeric(unchangedRow?.midReturnPct) ?? numeric(decay?.decayPctOfEntryPremium)
  const ivDownRow = shockedRow && { ...shockedRow, ivOnlyReturnPct: Number.isFinite(shockedRow.midReturnPct) && carryReturn != null
    ? shockedRow.midReturnPct - carryReturn : null }
  const target = (scenarioSet.premiumTargets || []).find((row) => row.horizonId === policy.primaryHorizonId
    && row.targetPct === policy.primaryPremiumTargetPct && row.ivMultiplier === policy.primaryIvMultiplier) || null

  const delta = numeric(entry.greeks?.delta)
  const signedDelta = delta == null ? null : delta * (direction === 'call' ? 1 : -1)
  if (signedDelta == null || signedDelta < OPTIONS_CHAIN_DELTA_RANGE.min || signedDelta > OPTIONS_CHAIN_DELTA_RANGE.max) {
    blockers.push({ code: 'calibrated_delta_outside_window', detail: signedDelta })
  }
  identity.cohort = optionsContractCohort(gated.dte, signedDelta)
  if (!Number.isFinite(decay?.decayPctOfEntryPremium) || !Number.isFinite(ivDownRow?.ivOnlyReturnPct)) {
    blockers.push({ code: 'required_model_attribution_unavailable', detail: 'primary_horizon_decay_or_iv_shock' })
  }
  if (blockers.length) return ineligible({ identity, blockers, missing, eventCohort })

  if (ivContext?.percentile == null) missing.push({ path: 'ivContext.percentile', reason: 'historical_iv_context_unavailable' })
  if (record.technicals.realizedVolatility20dPct == null) missing.push({ path: 'technicals.realizedVolatility20dPct', reason: 'insufficient_lagged_history' })
  if (!decay) missing.push({ path: 'scenarios.timeOnlyDecay', reason: 'primary_horizon_decay_unavailable' })
  if (!ivDownRow) missing.push({ path: 'scenarios.ivDownRow', reason: 'iv_down_scenario_unavailable' })
  if (!target) missing.push({ path: 'scenarios.premiumTarget', reason: 'premium_target_row_unavailable' })

  const context = { features: record, contract: gated, direction, entry, decay, ivDownRow, target, ivContext, mode, evidence, primaryHorizon }
  const components = [
    underlyingSetup(context),
    technicalConfirmation(context),
    catalystQuality(context),
    deltaExposure(context),
    convexity(context),
    thetaEfficiency(context),
    ivVega(context),
    liquidity(context),
    expectedMoveCompatibility(context),
  ]
  const penalties = buildPenalties({ features: record, contract: gated, entry, decay, ivContext, events })
  const componentPoints = round(components.reduce((sum, item) => sum + item.points, 0))
  const penaltyPoints = round(penalties.applied.reduce((sum, item) => sum + item.points, 0))
  const score = round(Math.max(policy.scoreRange.min, Math.min(policy.scoreRange.max, componentPoints - penaltyPoints)))

  return {
    ...identity,
    eventCohort,
    status: 'scored',
    score,
    attainableComponentPoints: policy.attainableComponentPoints,
    componentPoints,
    penaltyPoints,
    components,
    penalties: penalties.applied,
    inapplicablePenalties: penalties.inapplicable,
    blockers: [],
    missing,
    eventsAfterExit: events.afterExitBeforeExpiry.map((event) => ({ eventId: event.eventId, eventDate: event.eventDate, kind: event.kind })),
    // Everything ranking needs, so the comparator never reaches into a trace.
    tieBreakers: { spreadPct: round(numeric(entry.spreadPct), 6), contractId: gated.contractId },
    interpretation: OPTIONS_SCORE_INTERPRETATION,
  }
}

// ---------------------------------------------------------------------------
// Ranking and display
// ---------------------------------------------------------------------------

function compareScores(a, b) {
  if (b.score !== a.score) return b.score - a.score
  const spreadA = a.tieBreakers?.spreadPct ?? Number.POSITIVE_INFINITY
  const spreadB = b.tieBreakers?.spreadPct ?? Number.POSITIVE_INFINITY
  if (spreadA !== spreadB) return spreadA - spreadB
  return a.contract.contractId.localeCompare(b.contract.contractId)
}

export function rankOptionsScores(scores = [], {
  maxPerUnderlyingDirection = OPTIONS_SCORE_POLICY.display.maxPerUnderlyingDirection,
  policy = OPTIONS_SCORE_POLICY,
} = {}) {
  if (!Array.isArray(scores)) throw new Error('Ranking requires an array of scores')
  if (!Number.isInteger(maxPerUnderlyingDirection) || maxPerUnderlyingDirection < 1) throw new Error('maxPerUnderlyingDirection must be a positive integer')
  const eligible = scores.filter((entry) => entry.status === 'scored')
  const rejected = scores.filter((entry) => entry.status !== 'scored')
  const cohorts = [...new Set(eligible.map((entry) => entry.eventCohort))]
  if (cohorts.length > 1) throw new Error(`Event and non-event cohorts cannot share a ranking: ${cohorts.join(', ')}`)

  // The full ranking is computed first and kept whole; the display cap only
  // decides visibility afterwards, so no eligible rank is ever lost.
  const ordered = [...eligible].sort(compareScores)
  const seen = new Map()
  const ranked = ordered.map((entry, index) => {
    const key = `${entry.securityId}:${entry.direction}`
    const shown = seen.get(key) || 0
    const visible = shown < maxPerUnderlyingDirection
    if (visible) seen.set(key, shown + 1)
    return {
      ...entry,
      rank: index + 1,
      display: { visible, reason: visible ? null : 'underlying_direction_display_cap' },
    }
  })
  const displayed = ranked.filter((entry) => entry.display.visible)

  return {
    policyVersion: policy.version,
    cohort: cohorts[0] || null,
    maxPerUnderlyingDirection,
    ranked,
    displayed,
    suppressed: ranked.filter((entry) => !entry.display.visible),
    ineligible: rejected,
    metrics: {
      scoredCount: ranked.length,
      ineligibleCount: rejected.length,
      displayedCount: displayed.length,
      suppressedCount: ranked.length - displayed.length,
      topScore: ranked.length ? ranked[0].score : null,
      blockerCodes: [...new Set(rejected.flatMap((entry) => (entry.blockers || []).map((blocker) => blocker.code)))].sort(),
    },
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function pearson(left, right) {
  const n = left.length
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / n
  const meanRight = right.reduce((sum, value) => sum + value, 0) / n
  let covariance = 0, varianceLeft = 0, varianceRight = 0
  for (let index = 0; index < n; index += 1) {
    const dx = left[index] - meanLeft
    const dy = right[index] - meanRight
    covariance += dx * dy
    varianceLeft += dx * dx
    varianceRight += dy * dy
  }
  if (varianceLeft === 0 || varianceRight === 0) return null
  return round(covariance / Math.sqrt(varianceLeft * varianceRight), 4)
}

// Correlation says which components are grading the same thing twice -- delta
// against gamma against expected move, say -- and ablation says whether that
// duplication is actually moving the ranking. Both are reported, neither is
// used to retune a weight: the v0 policy is frozen before any holdout.
export function diagnoseOptionsScorePolicy(scores = [], { correlationThreshold = 0.8, topN = 5 } = {}) {
  const eligible = scores.filter((entry) => entry.status === 'scored')
  const base = {
    policyVersion: OPTIONS_SCORE_POLICY_VERSION,
    sampleSize: eligible.length,
    correlationThreshold,
    weightsFittedOn: OPTIONS_SCORE_POLICY.weightsFittedOn,
  }
  if (eligible.length < 3) {
    return { ...base, insufficientSample: true, correlations: [], flagged: [], ablations: [] }
  }

  const pointsByComponent = new Map(COMPONENT_ORDER.map((name) => [name, eligible.map((entry) =>
    entry.components.find((item) => item.component === name)?.points ?? 0)]))

  const correlations = []
  for (let i = 0; i < COMPONENT_ORDER.length; i += 1) {
    for (let j = i + 1; j < COMPONENT_ORDER.length; j += 1) {
      const [left, right] = [COMPONENT_ORDER[i], COMPONENT_ORDER[j]]
      const correlation = pearson(pointsByComponent.get(left), pointsByComponent.get(right))
      correlations.push({
        components: [left, right],
        correlation,
        reason: correlation == null ? 'no_variance_in_sample' : null,
        duplicatedSignalRisk: correlation != null && Math.abs(correlation) >= correlationThreshold,
      })
    }
  }

  const baseline = [...eligible].sort(compareScores)
  const baseRank = new Map(baseline.map((entry, index) => [entry.contract.contractId, index + 1]))
  const baseTop = new Set(baseline.slice(0, topN).map((entry) => entry.contract.contractId))
  const ablations = COMPONENT_ORDER.map((name) => {
    const ablated = eligible.map((entry) => {
      const dropped = entry.components.find((item) => item.component === name)?.points ?? 0
      return { ...entry, score: round(Math.max(0, Math.min(100, entry.componentPoints - dropped - entry.penaltyPoints))) }
    }).sort(compareScores)
    const displacements = ablated.map((entry, index) => Math.abs((index + 1) - baseRank.get(entry.contract.contractId)))
    const newTop = new Set(ablated.slice(0, topN).map((entry) => entry.contract.contractId))
    return {
      component: name,
      maxPoints: OPTIONS_SCORE_POLICY.components[name],
      maxRankDisplacement: Math.max(...displacements),
      meanRankDisplacement: round(displacements.reduce((sum, value) => sum + value, 0) / displacements.length),
      topNChanged: [...baseTop].filter((contractId) => !newTop.has(contractId)).length,
      topN,
    }
  })

  return {
    ...base,
    insufficientSample: false,
    correlations,
    flagged: correlations.filter((item) => item.duplicatedSignalRisk),
    ablations,
  }
}

// ---------------------------------------------------------------------------
// Audit record
// ---------------------------------------------------------------------------

function findNulls(value, path = 'payload', found = []) {
  if (value === null) { found.push({ path, reason: 'not_observed_at_freeze' }); return found }
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) findNulls(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, found)
  return found
}

export function createOptionsScoreAuditRecord({
  scanId,
  ranking,
  availableAt,
  modelVersion,
  inputHashes = [],
  diagnostics = null,
  source = { provider: 'wallai', feed: 'deterministic-contract-score', session: 'opening', entitlement: 'internal' },
} = {}) {
  if (!ranking?.ranked || !Array.isArray(ranking.ranked)) throw new Error('Score audit requires a completed ranking')
  const payload = {
    // The full ranking, before any display cap: what was decided, not what was
    // shown. `display` records which of these a reader was offered and why.
    scores: ranking.ranked,
    ineligible: ranking.ineligible,
    display: {
      maxPerUnderlyingDirection: ranking.maxPerUnderlyingDirection,
      visibleContractIds: ranking.displayed.map((entry) => entry.contract.contractId),
      suppressed: ranking.suppressed.map((entry) => ({
        contractId: entry.contract.contractId, rank: entry.rank, reason: entry.display.reason,
      })),
    },
    cohort: ranking.cohort,
    metrics: ranking.metrics,
    policy: OPTIONS_SCORE_POLICY,
    interpretation: OPTIONS_SCORE_INTERPRETATION,
    ...(diagnostics ? { diagnostics } : {}),
  }
  return createOptionsAuditRecord({
    type: 'score',
    scanId,
    availableAt,
    source,
    versions: {
      code: OPTIONS_SCORE_CODE_VERSION,
      model: modelVersion || 'deterministic-no-model',
      policy: OPTIONS_SCORE_POLICY_VERSION,
    },
    inputHashes,
    payload,
    missing: findNulls(payload),
  })
}
