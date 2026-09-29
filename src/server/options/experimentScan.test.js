import { describe, expect, it, vi } from 'vitest'
import { removeRegimePoints, runOptionsExperimentStage } from './experimentScan.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'

const security = OPTIONS_WATCHLIST_SNAPSHOT.securities.find((s) => s.ticker === 'NVDA')
const second = OPTIONS_WATCHLIST_SNAPSHOT.securities.find((s) => s.ticker === 'AMD')
const watchlist = { ...OPTIONS_WATCHLIST_SNAPSHOT, securities: [security] }
const window = { stage: 'shadow', tradingDate: '2026-09-22', deadlineAt: '2026-09-22T13:40:00.000Z', policyVersion: 'options-morning-schedule-v1' }

function featureRecord(owner = security) {
  const directional = { premarketMovePct: 1, return5dPct: 3, return20dPct: 8, relativeStrength20dPct: 6 }
  return {
    recordId: 'd'.repeat(64), featureVersion: 'options-point-in-time-features-v2', tradingDate: window.tradingDate, freezeAt: '2026-09-22T13:20:00.000Z',
    security: { securityId: owner.securityId, issuerId: owner.issuerId, ticker: owner.ticker },
    underlying: { premarketPrice: 495, premarketMovePct: 1 },
    technicals: { laggedThrough: '2026-09-21', return5dPct: 3, return20dPct: 8, relativeStrength20dPct: 6, realizedVolatility20dPct: 30,
      distanceFromSma20Pct: 3, overnightGapRms20dPct: 1, priorSessionVolumeRatio: 1.5, return60dPct: 12 },
    regime: { score: 8 }, directional: { call: directional, put: Object.fromEntries(Object.entries(directional).map(([key, value]) => [key, -value])) },
    events: { earnings: [], dividends: [], catalysts: [] }, evidence: { news: [] },
    coverage: { earnings: { status: 'complete' }, catalysts: { status: 'complete' }, news: { status: 'partial' } },
    nonEventHorizon: { state: 'eligible', reasons: [] }, pricingInputs: { rates: [] },
  }
}

const context = (owners = [security], snapshotId = 'snap') => {
  const features = owners.map((owner) => featureRecord(owner))
  return { snapshot: { schemaVersion: 'options-feature-snapshot-v1', snapshotId, tradingDate: window.tradingDate, freezeAt: features[0].freezeAt, securities: features },
    featuresBySecurity: new Map(features.map((feature) => [feature.security.securityId, feature])) }
}

function chain(type, owner = security) {
  const quote = (marketAt) => ({ bid: 2, ask: 2.1, bidSize: 5, askSize: 5, marketAt, ageMs: 5000 })
  const letter = type === 'call' ? 'C' : 'P'
  const root = owner.ticker
  return {
    underlying: { quote: { ...quote('2026-09-22T13:36:00.000Z'), bid: 494.9, ask: 495.1 } },
    rejected: [],
    contracts: [{
      rawId: `raw-${root}-${type}`, contractId: `osi:${root}261016${letter}00500000`, osiSymbol: `${root}261016${letter}00500000`, type,
      strikePrice: 500, expirationDate: '2026-10-16', quote: quote('2026-09-22T13:36:02.000Z'), trade: null,
      volume: { value: 10, session: 'rth', sessionDate: '2026-09-22' }, previousDailyBar: null,
      openInterest: { value: 200, asOfDate: '2026-09-19' }, analytics: { greeks: { delta: type === 'call' ? 0.35 : -0.35 }, impliedVolatility: 0.5 },
      fetchedAt: '2026-09-22T13:36:10.000Z', rawReferenceHash: `hash-${type}`,
    }],
  }
}

// Step 2's own scorer is exercised by publication tests; here it only needs a
// scored result with a regime feature so the variant arithmetic is visible.
const scoreContract = ({ contract, direction, security: owner = security }) => ({ score: {
  status: 'scored', eventCohort: 'non_event', securityId: owner.securityId, direction, contract: { contractId: contract.contractId },
  score: 60, componentPoints: 70, penaltyPoints: 10, tieBreakers: { spreadPct: 0.05, contractId: contract.contractId },
  components: [{ component: 'underlyingSetup', features: [{ feature: 'marketRegimeAgreement', points: 5 }, { feature: 'relativeStrength20d', points: 6 }] }],
} })

const run = (overrides = {}) => runOptionsExperimentStage({
  window, deadlineAt: window.deadlineAt, redis: {}, archive: {}, watchlist,
  resolveContext: async () => context(), scoreContract,
  createAlpaca: () => ({ optionChain: vi.fn(async ({ type }) => chain(type)) }),
  now: () => Date.parse('2026-09-22T13:36:05.000Z'), ...overrides,
})

describe('runOptionsExperimentStage', () => {
  it('does nothing without the frozen premarket snapshot', async () => {
    expect(await run({ resolveContext: async () => null })).toMatchObject({ status: 'incomplete', reason: 'premarket_stage_unavailable' })
  })

  it('scans each stock and direction once and shares those observations across every arm', async () => {
    const optionChain = vi.fn(async ({ type }) => chain(type))
    const { experiment } = await run({ createAlpaca: () => ({ optionChain }) })
    expect(optionChain).toHaveBeenCalledTimes(2)
    expect(optionChain.mock.calls.map(([args]) => args.type).sort()).toEqual(['call', 'put'])
    expect(experiment).toMatchObject({ status: 'complete', policyVersion: 'options-step1-experiments-v1', scanId: '2026-09-22:shadow:options-step1-experiments-v1' })
    const byArm = Object.fromEntries(experiment.arms.map((item) => [item.id, item.rows]))
    expect(byArm.all_both.map((row) => `${row.direction}:${row.status}`)).toEqual(['call:selected', 'put:selected'])
    expect(byArm.current15[0].observationId).toBe(byArm.all_calls[0].observationId)
    // Both Step 2 variants picked the same contract here: one shared observation, both scores kept.
    expect(byArm.no_regime_both[0].observationId).toBe(byArm.current15[0].observationId)
    expect(experiment.observations).toHaveLength(2)
    expect(experiment.observations.find((item) => item.observationId === byArm.current15[0].observationId))
      .toMatchObject({ score: 60, scores: { current: 60, no_regime: 55 } })
    expect(experiment.experimentId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('schedules close checkpoints only, at 0, 1, 3 and 5 sessions', async () => {
    const { experiment } = await run()
    const plan = experiment.observations[0].plan
    expect(plan.endpointTargets.map((target) => [target.kind, target.sessionOffset, target.tradingDate]))
      .toEqual([['endpoint_close', 0, '2026-09-22'], ['endpoint_close', 1, '2026-09-23'], ['endpoint_close', 3, '2026-09-25'], ['endpoint_close', 5, '2026-09-29']])
    expect(plan.pathSampling.samples).toEqual([])
    expect(plan.entryAt).toBe('2026-09-22T13:36:10.000Z')
    expect(experiment.observations[0].entry.quote).toMatchObject({ ask: 2.1 })
  })

  it('records unscanned stocks as unavailable when the budget runs out, without failing the stage', async () => {
    const result = await run({ now: () => Date.parse('2026-09-22T13:39:55.000Z') })
    expect(result.status).toBe('complete')
    expect(result.experiment.status).toBe('partial')
    expect(result.experiment.arms.find((item) => item.id === 'all_both').rows.map((row) => row.reason)).toEqual(['shadow_budget_exhausted', 'shadow_budget_exhausted'])
    expect(result.experiment.observations).toEqual([])
  })

  it('retries a failed chain, and on the last attempt keeps it unavailable for that stock and direction only', async () => {
    const optionChain = vi.fn(async ({ type }) => { if (type === 'put') throw Object.assign(new Error('boom'), { code: 'rate_limited' }); return chain(type) })
    expect(await run({ createAlpaca: () => ({ optionChain }) })).toMatchObject({ status: 'incomplete', reason: 'shadow_scan_continues' })
    const { experiment } = await run({ createAlpaca: () => ({ optionChain }), attempt: 3 })
    const rows = experiment.arms.find((item) => item.id === 'all_both').rows
    expect(rows.map((row) => `${row.direction}:${row.status}:${row.reason}`)).toEqual(['call:selected:null', 'put:unavailable:rate_limited'])
  })
})

describe('resuming a scan that outgrows one function run', () => {
  const both = { ...OPTIONS_WATCHLIST_SNAPSHOT, securities: [security, second] }
  // Each chain takes 30 simulated seconds, so only the first two of four fit.
  function slowRun({ checkpoint = null, attempt = 1, deadlineAt = '2026-09-22T13:38:00.000Z', snapshotId = 'snap' } = {}) {
    let clock = Date.parse('2026-09-22T13:36:05.000Z')
    const optionChain = vi.fn(async ({ security: owner, type }) => { clock += 30_000; return chain(type, owner) })
    const window50 = { ...window, deadlineAt: '2026-09-22T13:50:00.000Z' }
    const promise = runOptionsExperimentStage({ window: window50, deadlineAt, redis: {}, archive: {}, watchlist: both, checkpoint, attempt,
      resolveContext: async () => context([security, second], snapshotId), scoreContract,
      createAlpaca: () => ({ optionChain }), now: () => clock })
    return { promise, optionChain }
  }

  it('checkpoints finished chains and asks for a retry while the window has room', async () => {
    const result = await slowRun().promise
    expect(result).toMatchObject({ status: 'incomplete', reason: 'shadow_scan_continues', metrics: { directions: 4, availableDirections: 2, attempt: 1 } })
    expect(result.checkpoint).toMatchObject({ featureSnapshotId: 'snap' })
    expect(result.checkpoint.entries).toHaveLength(2)
    expect(result.experiment).toBeUndefined()
  })

  it('hands back its checkpoint well before the attempt deadline, even when a chain request uses all its time', async () => {
    // Production 2026-09-28/29: an in-flight request ran to the attempt deadline,
    // the scheduler's timer fired first, and the finished chains were lost.
    // Each request takes 10 s: two chains finish, the third runs into the scan deadline.
    let clock = Date.parse('2026-09-22T13:39:50.000Z')
    const deadlineAt = '2026-09-22T13:40:45.000Z'
    const optionChain = vi.fn(async ({ security: owner, type, deadline }) => {
      const reply = chain(type, owner)
      clock = Math.max(clock, Math.min(clock + 10_000, Date.parse(deadline)))
      if (clock >= Date.parse(deadline)) throw Object.assign(new Error('deadline'), { code: 'stage_deadline' })
      return reply
    })
    const result = await runOptionsExperimentStage({ window: { ...window, deadlineAt: '2026-09-22T13:50:00.000Z' }, deadlineAt, redis: {}, archive: {},
      watchlist: both, resolveContext: async () => context([security, second]), scoreContract, createAlpaca: () => ({ optionChain }), now: () => clock })
    expect(optionChain.mock.calls.every(([args]) => Date.parse(args.deadline) <= Date.parse(deadlineAt) - 30_000)).toBe(true)
    expect(clock).toBeLessThanOrEqual(Date.parse(deadlineAt) - 30_000)
    expect(result).toMatchObject({ status: 'incomplete', reason: 'shadow_scan_continues' })
    expect(result.checkpoint.entries).toHaveLength(2)
  })

  it('continues from the checkpoint on the retry and freezes one experiment covering both runs', async () => {
    const first = await slowRun().promise
    const { promise, optionChain } = slowRun({ checkpoint: first.checkpoint, attempt: 2, deadlineAt: '2026-09-22T13:45:00.000Z' })
    const { status, experiment } = await promise
    expect(status).toBe('complete')
    expect(optionChain).toHaveBeenCalledTimes(2)
    const scannedFirst = first.checkpoint.entries.map((entry) => `${entry.securityId}:${entry.direction}`)
    expect(optionChain.mock.calls.map(([args]) => `${args.security.securityId}:${args.type}`)).not.toEqual(expect.arrayContaining(scannedFirst))
    expect(experiment).toMatchObject({ status: 'complete', metrics: { availableDirections: 4, resumedDirections: 2, attempt: 2 } })
    expect(experiment.arms.find((item) => item.id === 'all_both').rows.every((row) => row.status === 'selected')).toBe(true)
  })

  it('freezes a partial experiment on the last attempt instead of asking for another', async () => {
    const { experiment, status } = await slowRun({ attempt: 3 }).promise
    expect(status).toBe('complete')
    expect(experiment.status).toBe('partial')
    expect(experiment.arms.find((item) => item.id === 'all_both').rows.filter((row) => row.status === 'unavailable')).toHaveLength(2)
  })

  it('ignores a checkpoint left by a different premarket snapshot', async () => {
    const first = await slowRun().promise
    const { promise, optionChain } = slowRun({ checkpoint: first.checkpoint, attempt: 2, deadlineAt: '2026-09-22T13:45:00.000Z', snapshotId: 'other-snap' })
    await promise
    expect(optionChain).toHaveBeenCalledTimes(4)
  })
})

describe('removeRegimePoints', () => {
  it('subtracts only the regime feature from the component total, then reapplies penalties', () => {
    const scored = scoreContract({ contract: { contractId: 'c' }, direction: 'call' }).score
    expect(removeRegimePoints(scored).score).toBe(55)
    expect(removeRegimePoints({ ...scored, components: [] }).score).toBe(60)
    expect(removeRegimePoints({ ...scored, componentPoints: 8, penaltyPoints: 10 }).score).toBe(0)
  })
})

describe('buildExperimentComparison', () => {
  // Observed quote at a checkpoint close, 10 seconds before the scheduled instant.
  const point = (item, closeAt, bid) => ({ contractId: item.plan.contract.contractId, securityId: item.plan.contract.securityId, issuerId: item.plan.contract.issuerId,
    at: new Date(Date.parse(closeAt) - 10000).toISOString(), availableAt: closeAt, status: 'observed', underlyingPrice: 510, iv: 0.48,
    quote: { bid, ask: bid + 0.1, bidSize: 5, askSize: 5, marketAt: new Date(Date.parse(closeAt) - 12000).toISOString() } })

  it('waits for the exit, then summarises observed returns and paired changes without counting unknowns', async () => {
    const { buildExperimentComparison } = await import('./experimentView.js')
    const { experiment } = await run()
    const call = experiment.observations.find((item) => item.contract.type === 'call')
    const pending = buildExperimentComparison({ runs: [experiment], observationsByPlan: new Map(), asOf: '2026-09-23T14:00:00.000Z' })
    expect(pending.summaries.find((row) => row.id === 'all_calls')).toMatchObject({ pending: 1, observed: 0, meanReturnPct: null })

    // Only the call is observed at the three-session close; the put's quote is missing.
    const observations = new Map([[call.plan.planId, [point(call, '2026-09-25T20:00:00.000Z', 3)]]])
    const view = buildExperimentComparison({ runs: [experiment], observationsByPlan: observations, asOf: '2026-09-26T00:00:00.000Z' })
    const byId = Object.fromEntries(view.summaries.map((row) => [row.id, row]))
    expect(byId.all_calls).toMatchObject({ observed: 1, unknown: 0, completeSessions: 1 })
    expect(byId.all_calls.meanReturnPct).toBeGreaterThan(35)
    expect(byId.all_puts).toMatchObject({ observed: 0, unknown: 1, completeSessions: 0, meanReturnPct: null })
    expect(byId.all_both).toMatchObject({ observed: 1, unknown: 1, completeSessions: 0 })
    // current15 and current10 hold the same call: one complete pair, zero difference.
    expect(byId.current15).toMatchObject({ pairedSessions: 1, pairedDeltaPct: 0 })
    // The put control never completed, so its experiment has no pair yet.
    expect(byId.earnings_down).toMatchObject({ pairedSessions: 0, pairedDeltaPct: null })
    expect(view.latest.arms.find((item) => item.id === 'all_calls').rows[0].outcome.returnPct).toBe(byId.all_calls.meanReturnPct)
    expect(view.days[0].arms[0].rows).toBeUndefined()
  })

  it('counts one frozen run per trading date, ignoring a later retry', async () => {
    const { latestExperimentRuns } = await import('./experimentView.js')
    const first = { policyVersion: 'v1', tradingDate: '2026-09-22', availableAt: '2026-09-22T13:37:00.000Z', experimentId: 'a' }
    const retry = { ...first, availableAt: '2026-09-22T13:38:00.000Z', experimentId: 'b' }
    const next = { ...first, tradingDate: '2026-09-23', availableAt: '2026-09-23T13:37:00.000Z', experimentId: 'c' }
    expect(latestExperimentRuns([retry, next, first]).map((item) => item.experimentId)).toEqual(['a', 'c'])
  })
})
