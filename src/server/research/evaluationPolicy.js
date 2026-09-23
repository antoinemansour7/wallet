// New methodology means a new ID. Never edit these rules to fit observed returns.
export const EVALUATION_ID = 'discovery-matrix-v1'
export const BASELINE_COMMIT = '0434948'
// A version changes when an arm's inputs change, so its earlier decisions are
// reported separately rather than pooled with the new ones.
//  - frozen-existing-v2: the frozen engine's model call moved to OpenAI after
//    Anthropic credit ran out; v1 rejected every candidate as baseline_unavailable.
//  - constrained-v2: now receives the spread, volume and sector its portfolio
//    rules check; v1 received none and rejected every candidate.
const ARM_VERSIONS = Object.freeze({ 'frozen-existing': 'frozen-existing-v2', constrained: 'constrained-v2' })
export const ARMS = Object.freeze([
  { id: 'frozen-existing', name: 'Frozen existing engine' },
  { id: 'fundamentals-only', name: 'Fundamentals only' },
  { id: 'combined', name: 'Existing engine + fundamentals' },
  { id: 'no-attention', name: 'Combined pool, attention disabled' },
  { id: 'no-quiet', name: 'Fundamentals, quiet condition disabled' },
  { id: 'constrained', name: 'Combined with portfolio constraints' },
].map((arm) => Object.freeze({ ...arm, version: ARM_VERSIONS[arm.id] || `${arm.id}-v1`, horizons: Object.freeze([5, 20]) })))
export const PORTFOLIO_POLICY = Object.freeze({ capital: 100000, orderSize: 10000, maxGross: 0.5,
  maxSector: 0.2, maxParticipation: 0.01, maxSpreadBps: 100, holdingSessions: 20 })
export const COST_SCENARIOS = Object.freeze([20, 50, 100])
const DAY = 86400000
export function experimentDefinition(startedAt) {
  const start = Date.parse(startedAt)
  if (!Number.isFinite(start)) throw new Error('Invalid experiment start')
  const at = (days) => new Date(start + days * DAY).toISOString()
  return { id: EVALUATION_ID, availableAt: at(0), baselineCommit: BASELINE_COMMIT, variantsTried: 6,
    costScenariosBps: COST_SCENARIOS, adverseFillBpsPerSide: 25, arms: ARMS, portfolio: PORTFOLIO_POLICY,
    quietVersion: 'fundamentals-quiet-v1', ranking: 'frozen-attention-plus-neutral-fundamentals-v1',
    neutralScoreScale: 0.6, attentionBonusCap: 10,
    // Six weeks between periods exceeds the longest declared 20-session hold.
    periods: [
      { id: 'development', start: at(0), end: at(56) },
      { id: 'embargo-1', start: at(56), end: at(98) },
      { id: 'validation', start: at(98), end: at(154) },
      { id: 'embargo-2', start: at(154), end: at(196) },
      { id: 'final-untouched', start: at(196), end: at(252) },
    ], finalReleaseAt: at(294) }
}
export const periodAt = (definition, at) => definition.periods.find((p) => Date.parse(p.start) <= Date.parse(at)
  && Date.parse(at) < Date.parse(p.end))?.id || 'post-study'
export const finalSealed = (definition, now) => Boolean(definition && new Date(now).getTime() < Date.parse(definition.finalReleaseAt))
