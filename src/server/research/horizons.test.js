// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  STRATEGIES,
  HORIZON_POLICY_VERSION,
  QUIET_POLICY,
  declaredHorizons,
  assertDeclaredHorizon,
  quietCondition,
  strategyPolicy,
  ingestIssuerBudget,
  DEFAULT_INGEST_MAX_ISSUERS,
  ADMISSION_POLICY_VERSION,
  enabledDiscoveryStrategies,
} from './policy.js'
import { createEvidence } from './evidence.js'
import { sessionCheckpoints, computeLearningStats, EVALUATION_VERSION, RESEARCH_MODEL_VERSION } from '../researchPerformance.js'

const security = { securityId: 'figi:QUIET', issuerId: 'cik:0000000001', name: 'QUIET Corporation', ticker: 'QUIET', currency: 'USD', exchange: 'XNAS', type: 'common_stock', countryOfListing: 'US' }
const source = { documentId: 'doc-1', accession: '0000000001-26-000001', url: 'https://www.sec.gov/a.htm', excerpt: 'Revenue increased to 120 from 100.' }
const stamps = { publicAt: '2026-02-01T20:00:00.000Z', firstSeenAt: '2026-02-02T12:00:00.000Z', extractionCompletedAt: '2026-02-02T12:00:00.000Z' }

describe('predeclared horizons', () => {
  it('declares 5 and 20 for fundamentals, ranked on 20', () => {
    expect(declaredHorizons('fundamentals')).toEqual([5, 20])
    expect(strategyPolicy('fundamentals').horizon).toBe(20)
  })

  it('leaves every other strategy on a single horizon', () => {
    expect(declaredHorizons('attention')).toEqual([5])
    expect(declaredHorizons('filing_changes')).toEqual([60])
    expect(declaredHorizons('insider')).toEqual([60])
  })

  it('keeps the ranking horizon inside the declared set for every strategy', () => {
    for (const [family, policy] of Object.entries(STRATEGIES)) {
      expect(policy.horizons).toContain(policy.horizon)
      expect(Object.isFrozen(policy.horizons), `${family} horizons must be frozen`).toBe(true)
    }
  })

  it('keeps deferred strategies readable but out of production admission', () => {
    expect(ADMISSION_POLICY_VERSION).toBe('strategy-admission-v2')
    expect(enabledDiscoveryStrategies()).toEqual(['attention', 'fundamentals'])
    expect(strategyPolicy('filing_changes').admissionEnabled).toBe(false)
    expect(strategyPolicy('insider').admissionEnabled).toBe(false)
  })

  // Adding a horizon changes what a stored cohort means, so the version has to
  // move with it or old records would be silently pooled with new ones.
  it('carries a policy version that moved when the set changed', () => {
    expect(HORIZON_POLICY_VERSION).toBe('strategy-horizons-v2')
  })
})

describe('a horizon cannot be chosen after the outcome', () => {
  it('refuses a horizon the strategy never declared', () => {
    expect(() => assertDeclaredHorizon('filing_changes', 5)).toThrow(/did not predeclare/)
    expect(() => assertDeclaredHorizon('attention', 20)).toThrow(/choosing a horizon after the outcome/)
  })

  it('allows both horizons fundamentals declared', () => {
    expect(assertDeclaredHorizon('fundamentals', 5)).toBe(5)
    expect(assertDeclaredHorizon('fundamentals', 20)).toBe(20)
  })

  it('lets evidence name either declared horizon but nothing else', () => {
    const build = (horizon) => createEvidence({ security, source, ...stamps, strategyFamily: 'fundamentals', horizon })
    expect(build(5).horizon).toBe(20) // ranked on 20 regardless of which was named
    expect(build(20).horizon).toBe(20)
    expect(() => build(60)).toThrow(/not chosen per outcome/)
  })

  it('freezes the declared set onto the record, so a later policy edit cannot rewrite history', () => {
    const evidence = createEvidence({ security, source, ...stamps, strategyFamily: 'fundamentals' })
    expect(evidence.horizons).toEqual([5, 20])
    expect(evidence.horizonPolicyVersion).toBe(HORIZON_POLICY_VERSION)
  })

  // The guard that matters most: the 5-session number exists for a 60-session
  // idea too, and reading it would be exactly the retrospective pick.
  it('refuses to compute stats for a strategy at an undeclared horizon', () => {
    expect(() => computeLearningStats([], Date.now(), { horizon: 5, strategyFamily: 'filing_changes' }))
      .toThrow(/did not predeclare/)
    expect(() => computeLearningStats([], Date.now(), { horizon: 20, strategyFamily: 'attention' }))
      .toThrow(/did not predeclare/)
  })
})

describe('the same candidate is tracked at both checkpoints', () => {
  // 21 sessions of flat-then-rising candles, one per weekday.
  const candles = Array.from({ length: 25 }, (_, i) => {
    const date = new Date(Date.parse('2026-02-02T14:30:00.000Z') + i * 86400000)
    return { timestamp: date.getTime(), date: date.toISOString().slice(0, 10), open: 100, high: 105, close: 100 + i, currency: 'USD' }
  })
  const policy = { strategyFamily: 'fundamentals', horizon: 20, horizonPolicyVersion: HORIZON_POLICY_VERSION, evaluationVersion: EVALUATION_VERSION }

  it('measures both 5 and 20 from one pick, and marks which were declared', () => {
    const checkpoints = sessionCheckpoints(candles, '2026-02-02T00:00:00.000Z', Date.parse('2026-04-01'), [], undefined, policy)
    const byHorizon = new Map(checkpoints.map((c) => [c.horizon, c]))

    expect(byHorizon.get(5)).toBeDefined()
    expect(byHorizon.get(20)).toBeDefined()
    // Both are declared for fundamentals; the intermediate ones are not.
    expect(byHorizon.get(5).declared).toBe(true)
    expect(byHorizon.get(20).declared).toBe(true)
    expect(byHorizon.get(3).declared).toBe(false)
    expect(byHorizon.get(10).declared).toBe(false)
  })

  it('never reports a checkpoint beyond the ranking horizon', () => {
    const checkpoints = sessionCheckpoints(candles, '2026-02-02T00:00:00.000Z', Date.parse('2026-06-01'), [], undefined, policy)
    expect(checkpoints.some((c) => c.horizon === 60)).toBe(false)
  })

  it('reads one stored record at both declared horizons', () => {
    // One record, as track-performance writes it: declared horizon 20, with
    // checkpoint fields for 5 and 20 side by side.
    const record = {
      candidateId: 'cand-1', pickDate: '2026-02-02', ticker: 'QUIET',
      strategyFamily: 'fundamentals', horizon: 20, horizons: [5, 20],
      horizonPolicyVersion: HORIZON_POLICY_VERSION,
      modelVersion: RESEARCH_MODEL_VERSION, evaluationVersion: EVALUATION_VERSION,
      net_return_day5: 4, excess_return_day5: 2, exit_date_day5: '2026-02-09',
      net_return_day20: 18, excess_return_day20: 9, exit_date_day20: '2026-03-02',
    }
    const at5 = computeLearningStats([record], Date.parse('2026-05-01'), { horizon: 5, strategyFamily: 'fundamentals' })
    const at20 = computeLearningStats([record], Date.parse('2026-05-01'), { horizon: 20, strategyFamily: 'fundamentals' })
    expect(at5.total).toBe(1)
    expect(at20.total).toBe(1)
  })

  it('still reads a legacy record that declared only one horizon', () => {
    const legacy = {
      candidateId: 'cand-2', pickDate: '2026-02-02', ticker: 'LOUD',
      strategyFamily: 'attention', horizon: 5,
      horizonPolicyVersion: HORIZON_POLICY_VERSION,
      modelVersion: RESEARCH_MODEL_VERSION, evaluationVersion: EVALUATION_VERSION,
      net_return_day5: 3, excess_return_day5: 1, exit_date_day5: '2026-02-09',
    }
    expect(computeLearningStats([legacy], Date.parse('2026-05-01'), { horizon: 5, strategyFamily: 'attention' }).total).toBe(1)
  })
})

describe('experiment arm is assigned at decision time', () => {
  it('calls a candidate quiet only when both measurements clear the frozen thresholds', () => {
    expect(quietCondition({ attention: 0, repricingPercent: 1 }).quiet).toBe(true)
    expect(quietCondition({ attention: 40, repricingPercent: 1 }).quiet).toBe(false)
    expect(quietCondition({ attention: 0, repricingPercent: 12 }).quiet).toBe(false)
    // A large fall is still a large reaction.
    expect(quietCondition({ attention: 0, repricingPercent: -12 }).quiet).toBe(false)
  })

  it('abstains rather than assuming quiet when a measurement is missing', () => {
    expect(quietCondition({ attention: 0 }).quiet).toBeNull()
    expect(quietCondition({ repricingPercent: 1 }).quiet).toBeNull()
    expect(quietCondition({}).quiet).toBeNull()
  })

  it('records the inputs and the thresholds it judged them against', () => {
    const arm = quietCondition({ attention: 1, repricingPercent: 2 })
    expect(arm.attention).toBe(1)
    expect(arm.repricingPercent).toBe(2)
    expect(arm.thresholds).toBe(QUIET_POLICY)
    expect(arm.version).toBe(QUIET_POLICY.version)
  })

  // Tuning the thresholds after seeing returns would fit the quiet arm to the
  // outcome, which is the failure #107 warns about by name.
  it('freezes the thresholds so they cannot be tuned to the result', () => {
    expect(Object.isFrozen(QUIET_POLICY)).toBe(true)
    expect(Object.isFrozen(quietCondition({ attention: 0, repricingPercent: 0 }))).toBe(true)
  })
})

// The backlog, not the code path, is what decides whether the experiment ever
// gets forward observations. With several staggered daily runs scheduled in
// vercel.json, the default budget is sized to drain that backlog rather than to
// the one-run-a-day pilot rate.
describe('ingestion budget', () => {
  it('defaults to a backlog-draining rate', () => {
    expect(ingestIssuerBudget(undefined)).toBe(DEFAULT_INGEST_MAX_ISSUERS)
    expect(DEFAULT_INGEST_MAX_ISSUERS).toBe(40)
  })

  it('accepts an overridden budget', () => {
    expect(ingestIssuerBudget('40')).toBe(40)
    expect(ingestIssuerBudget('5')).toBe(5)
  })

  it.each(['', '   ', 'lots', '0', '-3', '2.5'])('falls back rather than stopping ingestion on %j', (value) => {
    expect(ingestIssuerBudget(value)).toBe(DEFAULT_INGEST_MAX_ISSUERS)
  })
})
