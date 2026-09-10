import { Redis } from '@upstash/redis'
import { randomUUID } from 'node:crypto'
import { loadFoundation } from '../src/server/research/foundation.js'
import { withSecurityMaster } from '../src/server/research/securityMaster.js'
import { HISTORY_RETENTION_SECONDS, HISTORY_LIMIT } from '../src/server/research/policy.js'
import { cycleBoards, freezePublication, storeProjection, horizonPicks } from '../src/server/research/publication.js'
import { collectXSignals } from '../src/server/xSignals.js'
import {
  fetchAllYahooNews,
  extractTickers,
  finalizePicks,
  generateResearchReports,
} from '../src/server/researchEngine.js'
import { fetchBreakoutCandidates, candidatesToSignals } from '../src/server/technicalScreener.js'
import { runContrarianAgent } from '../src/server/agents/contrarianAgent.js'
import { runCatalystAgent } from '../src/server/agents/catalystAgent.js'
import { runExaDiscovery } from '../src/server/agents/exaDiscoveryAgent.js'
import { sendPickAlerts } from '../src/server/agents/slackAgent.js'
import { getMarketRegime, regimeSizeMultiplier } from '../src/server/marketRegime.js'
import { prepareEvaluation, freezeEvaluation } from '../src/server/research/evaluation.js'
import { STAGES, candidateTraces, recordCandidates, recordResearchRun, skipStage, stage } from '../src/server/research/observability.js'
import { createCronBudget, withinCronBudget } from '../src/server/research/runtimeBudget.js'

const RESEARCH_KEY = 'research:latest'
const RESEARCH_TTL = 48 * 60 * 60 // 48 hours
const HISTORY_TTL = HISTORY_RETENTION_SECONDS
const HISTORY_MAX_ENTRIES = HISTORY_LIMIT
const AGENT_MINIMUM_MS = 70_000
const REPORT_MINIMUM_MS = 55_000
const EVALUATION_MINIMUM_MS = 90_000
const SLACK_MINIMUM_MS = 8_000

function isAuthorized(req) {
  if (!process.env.CRON_SECRET) return false
  return req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
}

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

// Premarket validation (8 AM ET cron): re-check overnight picks against live
// quotes — a pick that already gapped up hard has spent its move, and one that
// gapped down hard broke overnight. Re-rank so the user opens fresh odds.
async function runPremarketCheck(res) {
  const redis = getRedis()
  if (!redis) return res.status(503).json({ error: 'Redis not configured' })

  const payload = await redis.get(RESEARCH_KEY)
  if (!payload?.picks?.length) return res.status(200).json({ skipped: 'no overnight picks' })

  const { fetchMarketQuotes } = await import('../src/server/marketQuotes.js')
  const { quotes } = await fetchMarketQuotes(payload.picks.map((p) => p.ticker))
  const quoteMap = new Map(quotes.map((q) => [q.requestedSymbol || q.symbol, q]))

  // Like finalizePicks, this re-rank ignores `technicalAgreement` on purpose.
  // The overnight gap is a new fact about the price; the model-versus-chart
  // conflict is not, and folding it in here would score the same disagreement
  // the card is there to show the reader.
  const rescored = payload.picks.map((pick) => {
    const quote = quoteMap.get(pick.ticker)
    const live = quote?.price != null && quote?.price !== '' && quote?.cacheStatus !== 'stale' ? Number(quote.price) : NaN
    const gapPct = Number.isFinite(live) && live > 0 && pick.price > 0
      ? Number((((live - pick.price) / pick.price) * 100).toFixed(2))
      : null

    const gappedAway = gapPct != null && gapPct >= 8
    const brokenOvernight = gapPct != null && gapPct <= -8

    let score = pick.finalScore ?? (Number(pick.conviction) || 5) * 1.5
    if (gappedAway) score -= 5
    if (brokenOvernight) score -= 6
    if (gapPct != null && gapPct >= 1 && gapPct < 8) score += 1 // confirming momentum

    return { ...pick, premarketGapPct: gapPct, gappedAway, brokenOvernight, premarketScore: Number(score.toFixed(2)) }
  }).sort((a, b) => b.premarketScore - a.premarketScore)

  const updated = { ...payload, picks: rescored, picksByHorizon: { ...payload.picksByHorizon, 5: rescored }, premarketCheckedAt: new Date().toISOString() }
  await redis.set(RESEARCH_KEY, updated, { ex: RESEARCH_TTL })

  const dateKey = payload.generatedAt.slice(0, 10)
  const history = await redis.get(`research:history:${dateKey}`)
  if (history) await redis.set(`research:history:${dateKey}`, { ...history, picks: rescored, picksByHorizon: { ...history.picksByHorizon, 5: rescored }, premarketCheckedAt: updated.premarketCheckedAt }, { ex: HISTORY_TTL })

  console.log('[nightly-research] premarket re-rank:', rescored.map((p) => `${p.ticker}${p.gappedAway ? '(gapped)' : ''}${p.brokenOvernight ? '(broken)' : ''}`).join(','))
  return res.status(200).json({
    mode: 'premarket',
    picks: rescored.map((p) => ({ ticker: p.ticker, gapPct: p.premarketGapPct, gappedAway: p.gappedAway, brokenOvernight: p.brokenOvernight })),
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const startedAt = Date.now()
  const budget = createCronBudget({ startedAt })
  const { recordRun } = await import('../src/server/runLog.js')
  const redis = getRedis()
  if (!redis) return res.status(503).json({ error: 'Redis not configured' })
  const lock = 'research:publication:lock:v1', token = randomUUID()
  if (!await redis.set(lock, token, { nx: true, ex: 360 })) return res.status(409).json({ error: 'Research publication already running' })
  const job = req.query?.mode === 'premarket' ? 'premarket-check' : 'nightly-research'
  try {
    return await recordResearchRun(redis, { job }, () => runLocked(req, res, startedAt, recordRun, redis, budget))
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [lock], [token])
  }
}

async function runLocked(req, res, startedAt, recordRun, redis, budget) {
  if (req.query?.mode === 'premarket') {
    try {
      const result = await stage(STAGES.premarket_check, () => runPremarketCheck(res))
      await recordRun('premarket-check', startedAt, { errors: [] })
      return result
    } catch (err) {
      console.error('[nightly-research] premarket check failed:', err.message)
      await recordRun('premarket-check', startedAt, { errors: [{ step: 'premarket', error: err.message }] })
      return res.status(500).json({ error: err.message })
    }
  }

  let foundation
  try { foundation = await stage(STAGES.foundation_load, () => loadFoundation({ redis })) }
  catch (error) {
    await recordRun('nightly-research', startedAt, { errors: [{ step: 'foundation', error: error.message }] })
    return res.status(503).json({ error: `Research foundation unavailable: ${error.message}` })
  }
  return withSecurityMaster(foundation.master, () => runDiscovery(res, startedAt, recordRun, foundation, budget))
}

async function runDiscovery(res, startedAt, recordRun, foundation, budget) {
  const errors = []

  // Step 1: collect adaptive X signals (primary discovery layer)
  let signals = []
  let queries = []
  let signalStats = { accountSignals: 0, searchSignals: 0 }
  try {
    const xResult = await stage(STAGES.x_discovery, () => collectXSignals(),
      { metrics: (result) => ({ signals: result.signals.length, queries: result.queries.length, provider: result.stats?.provider }) })
    signals = xResult.signals
    queries = xResult.queries
    signalStats = xResult.stats
    console.log(`[nightly-research] collected ${signals.length} X signals across ${queries.length} adaptive queries via ${signalStats.provider}`)
    // Per-account failures are caught inside collectXSignals; promote them here
    // so a silently dead X leg shows up in the run log instead of as a zero.
    if (signals.length === 0) {
      errors.push({ step: 'x', error: `no X signals from ${signalStats.provider}`, detail: (signalStats.errors || []).slice(0, 5) })
    }
  } catch (err) {
    console.error('[nightly-research] x signal collection failed:', err.message)
    errors.push({ step: 'x', error: err.message })
  }

  // Step 2: fetch Yahoo Finance RSS (secondary context / confirmation layer)
  let articles = []
  try {
    articles = await stage(STAGES.news_discovery, () => fetchAllYahooNews(), { metrics: (found) => ({ articles: found.length }) })
    console.log(`[nightly-research] fetched ${articles.length} articles`)
  } catch (err) {
    console.error('[nightly-research] yahoo rss failed:', err.message)
    errors.push({ step: 'yahoo', error: err.message })
  }

  // Step 2.5: technical screener (pre-breakout/squeeze detection)
  try {
    const screenerSignals = await stage(STAGES.screener_discovery,
      async () => candidatesToSignals(await fetchBreakoutCandidates()),
      { metrics: (found) => ({ signals: found.length }) })
    signals = [...signals, ...screenerSignals]
    console.log(`[nightly-research] screener signals: ${screenerSignals.length}`)
  } catch (err) {
    console.error('[nightly-research] technical screener failed:', err.message)
    errors.push({ step: 'screener', error: err.message })
  }

  // Step 2.7: Exa discovery (find stocks from financial media, not just X)
  let exaSignalCount = 0
  try {
    const { deriveAdaptiveSeed } = await import('../src/server/xSignals.js')
    const exaSignals = await stage(STAGES.exa_discovery,
      () => runExaDiscovery(deriveAdaptiveSeed({ baseSignals: signals })),
      { metrics: (found) => ({ signals: found.length }) })
    signals = [...signals, ...exaSignals]
    exaSignalCount = exaSignals.length
    console.log(`[nightly-research] exa discovery: ${exaSignals.length} signals`)
  } catch (err) {
    console.error('[nightly-research] exa discovery failed:', err.message)
    errors.push({ step: 'exa-discovery', error: err.message })
  }

  // Step 2.8: day-trade catalysts — next-session earnings reporters
  try {
    const { collectDayTradeSignals } = await import('../src/server/dayTradeSignals.js')
    const dayTradeSignals = await stage(STAGES.day_trade_signals, () => collectDayTradeSignals('nightly'),
      { metrics: (found) => ({ signals: found.length }) })
    signals = [...signals, ...dayTradeSignals]
    console.log(`[nightly-research] day-trade signals: ${dayTradeSignals.length}`)
  } catch (err) {
    console.error('[nightly-research] day-trade signals failed:', err.message)
    errors.push({ step: 'day-trade', error: err.message })
  }

  // Primary disclosures can qualify without a single attention signal.

  // Market regime — rates the tape, never an individual pick. Recorded on
  // every pick so this becomes calibratable once the history spans more than
  // the single month it currently covers; it cannot be backfilled.
  let regime = null
  try {
    regime = await stage(STAGES.market_regime, () => getMarketRegime(),
      { metrics: (tape) => ({ score: tape?.score, label: tape?.label, coverage: tape?.coverage }) })
    if (regime) {
      console.log(`[nightly-research] market regime: ${regime.score}/10 (${regime.label})`
        + ` — drag: ${regime.drag?.label} | ${regime.coverage} components`)
    }
  } catch (err) {
    console.error('[nightly-research] regime failed:', err.message)
    errors.push({ step: 'regime', error: err.message })
  }

  // Step 3: extract tickers via Claude
  let tickers = []
  let modelBoard = []
  let shadowBoard = []
  let primaryReview = null
  let evaluationInputs = null
  try {
    // A run where a discovery feed failed produces low mention counts for every
    // ticker. Recorded as though it were real, the next run would read a
    // market-wide collapse in attention that never happened, so a degraded run
    // is not written to the coverage history at all.
    const DISCOVERY_STEPS = ['x', 'yahoo', 'screener', 'exa-discovery', 'day-trade']
    const discoveryHealthy = !errors.some((e) => DISCOVERY_STEPS.includes(e.step))
    if (!discoveryHealthy) console.warn('[nightly-research] discovery degraded — coverage history will not record this run')

    tickers = await stage(STAGES.claude_review, () => withinCronBudget(budget, 'Claude review', (signal, timeout) =>
      extractTickers(signals, articles, {
        foundation,
        onPrimaryReview: (result) => { primaryReview = result },
        onBoard: (board) => {
          // summarizeSignalsForPrompt serializes at most 30 candidates. Keep
          // that exact model input for observability; the existing 15-name
          // shadow experiment remains a separate, unchanged sample below.
          modelBoard = board.slice(0, 30)
          shadowBoard = modelBoard.slice(0, 15)
        },
        regime,
        discoveryHealthy,
        // Capture the already-collected evidence, but do not start the shadow
        // model pipeline before the user-facing result is safely persisted.
        onEvaluationInputs: (inputs) => { evaluationInputs = { ...inputs, discoveryHealthy } },
        requestOptions: { signal, timeout },
      })), {
      // Admission and review-budget selection happen inside extractTickers, so
      // they are reported here as counts rather than as a stage boundary the
      // pipeline does not actually have.
      metrics: (accepted) => ({
        accepted: accepted.length,
        boardSize: modelBoard.length,
        admitted: primaryReview?.admission?.audit?.funnel?.admitted,
        rejected: primaryReview?.admission?.audit?.rejected?.length,
        budgetExhausted: primaryReview?.admission?.audit?.notReviewed?.length,
      }),
    })
    console.log(`[nightly-research] extracted ${tickers.length} tickers:`, tickers.map((t) => t.ticker))
  } catch (err) {
    console.error('[nightly-research] ticker extraction failed:', err.message)
    errors.push({ step: 'claude', error: err.message })
  }
  if (!primaryReview) {
    await recordRun('nightly-research', startedAt, { errors })
    return res.status(503).json({ error: 'Research review unavailable; previous briefing retained', errors })
  }

  // Steps 3.5–3.6 are independent reads of the same reviewed board. Running
  // them together saves one full model round trip without changing either
  // agent's inputs; their fields are merged before final ranking.
  if (tickers.length > 0) {
    if (!budget.canStart(AGENT_MINIMUM_MS)) {
      skipStage(STAGES.contrarian_review, 'time_budget', { availableMs: budget.availableMs() })
      skipStage(STAGES.catalyst_verification, 'time_budget', { availableMs: budget.availableMs() })
      errors.push({ step: 'contrarian', error: 'deferred to preserve the cron completion budget' })
      errors.push({ step: 'catalyst', error: 'deferred to preserve the cron completion budget' })
    } else {
      const reviewed = tickers
      const [contrarian, catalyst] = await Promise.allSettled([
        stage(STAGES.contrarian_review, () => withinCronBudget(budget, 'Contrarian review', (signal, timeout) =>
          runContrarianAgent(reviewed, new Map(), { requestOptions: { signal, timeout } })),
        { metrics: (items) => ({ candidates: items.length, bearCases: items.filter((item) => item.bearCase).length }) }),
        stage(STAGES.catalyst_verification, () => withinCronBudget(budget, 'Catalyst verification', (signal, timeout) =>
          runCatalystAgent(reviewed, { requestOptions: { signal, timeout } })),
        { metrics: (items) => ({ candidates: items.length, verified: items.filter((item) => item.catalystVerified).length }) }),
      ])
      if (contrarian.status === 'rejected') {
        console.error('[nightly-research] contrarian agent failed:', contrarian.reason.message)
        errors.push({ step: 'contrarian', error: contrarian.reason.message })
      }
      if (catalyst.status === 'rejected') {
        console.error('[nightly-research] catalyst agent failed:', catalyst.reason.message)
        errors.push({ step: 'catalyst', error: catalyst.reason.message })
      }
      const risks = new Map((contrarian.value || []).map((item) => [item.ticker, item]))
      const catalysts = new Map((catalyst.value || []).map((item) => [item.ticker, item]))
      tickers = reviewed.map((item) => ({ ...item, ...risks.get(item.ticker), ...catalysts.get(item.ticker) }))
      console.log(`[nightly-research] agent enrichment: ${tickers.filter((item) => item.bearCase).length} bear cases, `
        + `${tickers.filter((item) => item.catalystVerified).length} verified catalysts across ${tickers.length} picks`)
    }
  }

  // Step 3.8: re-rank with everything the agents learned (risk scores,
  // catalyst verification) so delivery order reflects true expected edge
  if (tickers.length > 0) {
    const before = tickers.map((t) => t.ticker)
    tickers = await stage(STAGES.final_ranking, async () => finalizePicks(tickers),
      { metrics: (ranked) => ({ picks: ranked.length }) })
    console.log(`[nightly-research] finalized order: ${before.join(',')} → ${tickers.map((t) => t.ticker).join(',')}`)
  }

  const redis = getRedis()
  const dateKey = new Date().toISOString().slice(0, 10)
  const generatedAt = new Date().toISOString()

  // Carry the best of the cycle forward. A run between scheduled runs should
  // improve the board, not replace it, so every pick made since the last
  // scheduled hour competes on finalScore for the same five slots.
  let prior = null
  if (redis) {
    try {
      prior = await redis.get(RESEARCH_KEY)
    } catch (err) {
      console.error('[nightly-research] reading the cycle board failed:', err.message)
      errors.push({ step: 'cycle-read', error: err.message })
    }
  }

  // Stamp the tape onto each pick, so a later calibration can ask what the
  // regime was on the day it was made without reconstructing it. Only this
  // run's picks are stamped; carried picks keep the regime of the run that
  // made them.
  const stamp = (list) => (regime
    ? list.map((p) => ({
      ...p,
      regimeScore: regime.score,
      regimeLabel: regime.label,
      suggestedSizeMultiplier: regimeSizeMultiplier(regime.score),
    }))
    : list)

  const picksByHorizon = cycleBoards(prior, {
    5: stamp(tickers),
    20: stamp(primaryReview?.picksByHorizon[20] || []),
    60: stamp(primaryReview?.picksByHorizon[60] || []),
  }, { generatedAt, master: foundation.master, vetoes: [
    ...(primaryReview?.vetoes || []),
    ...(primaryReview?.admission.audit.rejected || []).filter((r) => r.evidenceId).map((r) => r.securityId),
  ] })
  // Trace every candidate this run considered while the reasons are still in
  // scope. Recorded before reports are written, for the same reason the picks
  // are: a run cut short at its longest leg should still explain itself.
  const publishedThisRun = Object.values(picksByHorizon).flat().filter((pick) => pick.generatedAt === generatedAt)
  const traces = candidateTraces({
    board: modelBoard,
    admission: primaryReview?.admission,
    primaryReview,
    accepted: tickers,
    published: publishedThisRun,
  })
  recordCandidates(traces, primaryReview?.admission)

  // Only new winners need reports. A candidate that lost to a carried decision
  // must not overwrite that decision's report, even when the ticker is equal.
  const reportCandidates = Object.values(picksByHorizon).flat().filter((p) => p.generatedAt === generatedAt)
  let payload = {
    generatedAt,
    picks: picksByHorizon[5],
    picksByHorizon,
    admissionId: primaryReview?.admission.id || null,
    reviewId: primaryReview?.id || null,
    regime,
    articles,
    signalCount: signals.length,
    tweetCount: signals.length,
    queryCount: queries.length,
    xBreakdown: signalStats,
    errors,
    reportsPending: reportCandidates.length > 0,
  }
  let evaluationRun = null

  // Step 3.9: store the ranked picks BEFORE writing their reports.
  // Report generation is the longest leg of the run, so it is the leg most
  // likely to be cut short by the function time limit. Storing first means a
  // kill there costs the reports, not the entire night's picks — the failure
  // degrades instead of erasing. Archive even an empty decision, so selective
  // runs remain auditable. Never publish decisions whose archive failed.
  try {
    payload = await stage(STAGES.publication, () => freezePublication(foundation.archive, payload),
      { metrics: (frozen) => ({ picks: frozen.picks?.length, publicationId: frozen.publicationId }) })
  } catch (err) {
    errors.push({ step: 'publication', error: err.message })
    await recordRun('nightly-research', startedAt, { errors })
    return res.status(503).json({ error: 'Could not archive research decisions', errors })
  }
  try {
    await stage(STAGES.persistence, async () => {
      await storeProjection(redis, payload)
    })
  } catch (err) {
    errors.push({ step: 'store-partial', error: err.message })
  }

  // Step 4: generate research reports for this run's tickers only. A carried
  // pick already has the report its own run wrote, and regenerating it would
  // spend the run's longest leg rewriting work that is already done.
  let reports = reportCandidates
  let reportsComplete = reportCandidates.length === 0
  if (reportCandidates.length > 0) {
    if (!budget.canStart(REPORT_MINIMUM_MS)) {
      skipStage(STAGES.report_generation, 'time_budget', { availableMs: budget.availableMs(), candidates: reportCandidates.length })
      errors.push({ step: 'reports', error: 'deferred to preserve the cron completion budget' })
    } else try {
      reports = await stage(STAGES.report_generation, () => withinCronBudget(budget, 'Report generation', (signal, timeout) =>
        generateResearchReports(reportCandidates, { requestOptions: { signal, timeout } })),
        { metrics: (written) => ({ reports: written.length, candidates: reportCandidates.length }) })
      reportsComplete = reports.every((report) => !report.reportError)
      console.log(`[nightly-research] generated ${reports.length} reports`)
    } catch (err) {
      console.error('[nightly-research] report generation failed:', err.message)
      errors.push({ step: 'reports', error: err.message })
    }
  }

  // Step 5: store the completed run, replacing the pre-report payload
  const reportsById = new Map(reports.map((p) => [p.candidateId, p]))
  const completed = Object.fromEntries(Object.entries(picksByHorizon).map(([horizon, list]) => [horizon,
    list.map((p) => p.generatedAt === generatedAt ? reportsById.get(p.candidateId) || p : p),
  ]))
  payload = { ...payload, picks: completed[5], picksByHorizon: completed, errors, reportsPending: !reportsComplete }
  const board = payload.picks

  if (redis) {
    await storeProjection(redis, payload)
    // Shadow tracking: the top-15 board candidates that didn't make the cut.
    // Tracked like real picks (but never shown) to ~3x the learning data
    // behind setup/source win rates.
    const pickedSet = new Set(Object.values(completed).flat().map((p) => p.ticker))
    const shadowPicks = shadowBoard
      .filter((item) => !pickedSet.has(item.ticker) && Number.isFinite(item.price) && item.price > 0)
      .map((item) => ({
        ticker: item.ticker,
        price: item.price,
        setupType: item.setupType,
        sources: (item.sources || []).slice(0, 6),
        archetypeScore: item.archetypeScore,
      }))
    if (shadowPicks.length > 0) {
      await redis.set(`research:shadow:${dateKey}`, { date: dateKey, generatedAt: payload.generatedAt, picks: shadowPicks }, { ex: HISTORY_TTL })
      await redis.lpush('research:shadow-index', dateKey)
      await redis.ltrim('research:shadow-index', 0, HISTORY_MAX_ENTRIES - 1)
      console.log(`[nightly-research] shadow-tracking ${shadowPicks.length} board candidates`)
    }

    console.log('[nightly-research] stored research:latest + history in Redis')
  } else {
    console.warn('[nightly-research] Redis not configured — results not persisted')
  }

  // Step 6: Send Slack alerts. The board, not this run's picks — the alert
  // should say what is on screen, which mid-cycle may include a carried pick.
  if (board.length > 0) {
    if (!budget.canStart(SLACK_MINIMUM_MS)) {
      skipStage(STAGES.slack_alerts, 'time_budget', { availableMs: budget.availableMs(), picks: board.length })
      errors.push({ step: 'slack', error: 'deferred to preserve the cron completion budget' })
    } else try {
      await stage(STAGES.slack_alerts, () => withinCronBudget(budget, 'Slack alerts', () => sendPickAlerts(board)),
        { metrics: () => ({ picks: board.length }) })
    } catch (err) {
      console.error('[nightly-research] slack alert failed:', err.message)
      errors.push({ step: 'slack', error: err.message })
    }
  }

  // The experiment is deliberately last and optional. It observes the same
  // captured inputs, but can no longer delay publication, persistence or alerts.
  if (!evaluationInputs) {
    skipStage(STAGES.evaluation_snapshot, 'inputs_unavailable')
    errors.push({ step: 'evaluation', error: 'Decision inputs unavailable' })
  } else if (!budget.canStart(EVALUATION_MINIMUM_MS)) {
    skipStage(STAGES.evaluation_snapshot, 'time_budget', { availableMs: budget.availableMs() })
    errors.push({ step: 'evaluation', error: 'deferred to preserve the cron completion budget' })
  } else {
    try {
      evaluationRun = await stage(STAGES.evaluation_snapshot, () => withinCronBudget(budget, 'Evaluation snapshot', async (signal, timeout) => {
        const snapshot = await prepareEvaluation(evaluationInputs, {
          ...foundation,
          requestOptions: { signal, timeout },
        })
        return freezeEvaluation(foundation.archive, snapshot, payload)
      }))
      await foundation.archive.put('evaluation-delivery', evaluationRun.id, { runId: evaluationRun.id,
        availableAt: new Date().toISOString() }, 'evaluation-deliveries')
    } catch (err) {
      console.error('[nightly-research] evaluation snapshot failed:', err.message)
      errors.push({ step: 'evaluation', error: err.message })
    }
  }

  await recordRun('nightly-research', startedAt, {
    errors,
    signals: signals.length,
    articles: articles.length,
    picks: board.length,
    tickers: tickers.map((t) => t.ticker),
  })

  return res.status(200).json({
    stored: Boolean(redis),
    picks: board.length,
    // What this run contributed vs what the cycle already held, so a rerun's
    // effect on the board is legible from the response alone.
    board: board.map((p) => p.ticker),
    carried: board.filter((p) => p.generatedAt !== generatedAt).map((p) => p.ticker),
    boards: Object.fromEntries([5, 20, 60].map((h) => [h, horizonPicks(payload, h).map((p) => p.ticker)])),
    signalCount: signals.length,
    tweetCount: signals.length,
    queryCount: queries.length,
    articles: articles.length,
    exaSignals: exaSignalCount,
    tickers: tickers.map((t) => t.ticker),
    errors,
  })
}
