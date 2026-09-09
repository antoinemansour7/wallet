export const DATA_VERSION = 'primary-evidence-v1'
export const EVIDENCE_VERSION = 'discovery-evidence-v1'
// Bumped from v1 when fundamentals gained a predeclared 5-session evaluation
// horizon alongside its 20. Records written under v1 declared only one horizon,
// so they are a different cohort and must not be pooled with these; the version
// check in researchPerformance.js is what enforces that.
export const HORIZON_POLICY_VERSION = 'strategy-horizons-v2'
export const HISTORY_RETENTION_SECONDS = 400 * 86400
export const HISTORY_LIMIT = 400
// `horizon` is the horizon a strategy is ranked and published on. `horizons` is
// every horizon it may be *evaluated* at, declared here and frozen before any
// outcome exists.
//
// Fundamentals declares both 5 and 20 because #107 asks for exactly that
// comparison: a disclosure-driven idea may reprice within a week or take a
// quarter, and judging it only at 20 hides the first case while judging it only
// at 5 fails the second. Declaring both up front is what separates this from
// retrospective horizon-picking — the alternative, reading whichever checkpoint
// flatters the result, is the thing the epic forbids. Adding a horizon to this
// list is a policy change and requires bumping HORIZON_POLICY_VERSION, which
// starts a new cohort rather than relabelling the old one.
export const STRATEGIES = Object.freeze({
  attention: Object.freeze({ horizon: 5, horizons: Object.freeze([5]), budget: 12 }),
  fundamentals: Object.freeze({ horizon: 20, horizons: Object.freeze([5, 20]), budget: 10 }),
  filing_changes: Object.freeze({ horizon: 60, horizons: Object.freeze([60]), budget: 5 }),
  insider: Object.freeze({ horizon: 60, horizons: Object.freeze([60]), budget: 3 }),
})
export function strategyPolicy(family) {
  const policy = Object.hasOwn(STRATEGIES, family) && STRATEGIES[family]
  if (!policy) throw new Error(`Unknown discovery strategy: ${family}`)
  return policy
}

/** Every horizon this strategy predeclared for evaluation, ranking horizon first. */
export function declaredHorizons(family) {
  return strategyPolicy(family).horizons
}

/**
 * The guard against retrospective horizon-picking.
 *
 * Checkpoints are measured at 1/3/5/10/20/60 for anything that lives long
 * enough, so a 60-session idea has a 5-session number sitting in the store
 * whether or not anyone declared it. Reading that number and calling it a
 * result is exactly the move this refuses: only a horizon the strategy declared
 * before the outcome existed may be evaluated.
 */
export function assertDeclaredHorizon(family, horizon) {
  if (!declaredHorizons(family).includes(horizon)) {
    throw new Error(`${family} did not predeclare a ${horizon}-session horizon; evaluating it now would be choosing a horizon after the outcome`)
  }
  return horizon
}
export function reviewBudgets(raw = process.env.RESEARCH_STREAM_BUDGETS) {
  const budgets = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : Object.fromEntries(Object.entries(STRATEGIES).map(([key, value]) => [key, value.budget]))
  if (Object.keys(budgets).some((key) => !Object.hasOwn(STRATEGIES, key)) || Object.keys(STRATEGIES).some((key) => !Number.isInteger(budgets[key]) || budgets[key] < 0)
    || Object.values(budgets).reduce((sum, value) => sum + value, 0) !== 30) throw new Error('Discovery review budgets must allocate exactly 30 slots across the four strategies')
  return budgets
}

// ─── The #107 experiment: fundamentals-only vs fundamentals + quiet ───────────
//
// The comparison is between a fundamentals-improvement screen on its own and
// the same screen restricted to candidates the market has not yet noticed or
// repriced. Whether a candidate met the quiet condition can only be known at
// the moment of the decision — attention and the price reaction both move — so
// the arm is assigned and stored when the pick is made, never derived later.
//
// The thresholds are frozen here for the same reason the horizons are. Tuning
// them after seeing returns would let the "quiet" arm be fitted to the outcome,
// which is the failure the issue explicitly warns against: do not retain quiet
// as a storytelling feature with no demonstrated value.
//
// Known limitation, recorded rather than hidden: `repricingPercent` is the
// day change on the quote taken at review, which approximates the reaction to
// a filing released overnight and does not approximate it for older evidence.
// The issue also asks for sector-relative return, the overnight gap and spread;
// none are captured yet. Adding them changes what the quiet arm means, so it
// requires a new EXPERIMENT_VERSION rather than an edit to this one.
export const EXPERIMENT_VERSION = 'fundamentals-quiet-v1'
export const QUIET_POLICY = Object.freeze({
  version: EXPERIMENT_VERSION,
  maxAttentionSignals: 2,
  maxAbsRepricingPercent: 3,
})

/**
 * Assign the experiment arm from decision-time measurements.
 *
 * Returns `quiet: null` rather than false when a measurement is missing. An
 * unmeasured candidate is not evidence that the market had noticed it, and
 * silently counting it as loud would bias the comparison.
 */
export function quietCondition({ attention, repricingPercent } = {}) {
  const measuredAttention = Number.isFinite(attention) ? attention : null
  const measuredRepricing = Number.isFinite(repricingPercent) ? repricingPercent : null
  const quiet = measuredAttention === null || measuredRepricing === null
    ? null
    : measuredAttention <= QUIET_POLICY.maxAttentionSignals
      && Math.abs(measuredRepricing) <= QUIET_POLICY.maxAbsRepricingPercent
  return Object.freeze({
    version: QUIET_POLICY.version,
    quiet,
    attention: measuredAttention,
    repricingPercent: measuredRepricing,
    thresholds: QUIET_POLICY,
  })
}

/**
 * Issuers whose filings are ingested per run.
 *
 * The pilot's original five assumed one run a day. At that rate the queue
 * diverges: the daily index enqueues every universe issuer that filed, which
 * runs to hundreds a day, so five drained leaves the backlog growing and the
 * fundamentals stream never receives a forward observation — a filing ingested
 * more than 14 days after it was filed is past the candidate-eligibility window
 * and is archived without ever becoming a pick. `vercel.json` now schedules
 * several staggered daily foundation runs, and this budget is raised to match,
 * so the drain rate clears the 927-deep backlog in weeks rather than months and
 * then keeps pace with arrivals.
 *
 * The per-run loop is still bounded by the 240s work deadline and its 45s
 * guard, so this is a ceiling the run reaches only when the queued issuers are
 * cheap; a large filer's Company Facts download is what actually paces a run.
 * Lower it via RESEARCH_INGEST_MAX_ISSUERS to cap SEC requests and function
 * time on a tighter budget.
 *
 * The empty string is rejected before conversion because Number('') is 0, which
 * would silently stop ingestion altogether.
 */
export const DEFAULT_INGEST_MAX_ISSUERS = 40
export function ingestIssuerBudget(raw = process.env.RESEARCH_INGEST_MAX_ISSUERS) {
  if (raw == null || String(raw).trim() === '') return DEFAULT_INGEST_MAX_ISSUERS
  const configured = Number(raw)
  return Number.isInteger(configured) && configured >= 1 ? configured : DEFAULT_INGEST_MAX_ISSUERS
}
