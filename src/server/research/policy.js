export const DATA_VERSION = 'primary-evidence-v1'
export const EVIDENCE_VERSION = 'discovery-evidence-v1'
export const HORIZON_POLICY_VERSION = 'strategy-horizons-v1'
export const HISTORY_RETENTION_SECONDS = 400 * 86400
export const HISTORY_LIMIT = 400
export const STRATEGIES = Object.freeze({
  attention: Object.freeze({ horizon: 5, budget: 12 }),
  fundamentals: Object.freeze({ horizon: 20, budget: 10 }),
  filing_changes: Object.freeze({ horizon: 60, budget: 5 }),
  insider: Object.freeze({ horizon: 60, budget: 3 }),
})
export function strategyPolicy(family) {
  const policy = Object.hasOwn(STRATEGIES, family) && STRATEGIES[family]
  if (!policy) throw new Error(`Unknown discovery strategy: ${family}`)
  return policy
}
export function reviewBudgets(raw = process.env.RESEARCH_STREAM_BUDGETS) {
  const budgets = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : Object.fromEntries(Object.entries(STRATEGIES).map(([key, value]) => [key, value.budget]))
  if (Object.keys(budgets).some((key) => !Object.hasOwn(STRATEGIES, key)) || Object.keys(STRATEGIES).some((key) => !Number.isInteger(budgets[key]) || budgets[key] < 0)
    || Object.values(budgets).reduce((sum, value) => sum + value, 0) !== 30) throw new Error('Discovery review budgets must allocate exactly 30 slots across the four strategies')
  return budgets
}
