import { Redis } from '@upstash/redis'
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

const RESEARCH_KEY = 'research:latest'
const RESEARCH_TTL = 48 * 60 * 60 // 48 hours
// Must outlive the longest performance checkpoint (day 10) plus the stats
// window — performance records keep 30 days, so history must too.
const HISTORY_TTL = 30 * 24 * 60 * 60 // 30 days
const HISTORY_INDEX_KEY = 'research:history-index'
const HISTORY_MAX_ENTRIES = 30

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

  const updated = { ...payload, picks: rescored, premarketCheckedAt: new Date().toISOString() }
  await redis.set(RESEARCH_KEY, updated, { ex: RESEARCH_TTL })

  const dateKey = new Date().toISOString().slice(0, 10)
  const history = await redis.get(`research:history:${dateKey}`)
  if (history) await redis.set(`research:history:${dateKey}`, { ...history, picks: rescored, premarketCheckedAt: updated.premarketCheckedAt }, { ex: HISTORY_TTL })

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
  const { recordRun } = await import('../src/server/runLog.js')

  if (req.query?.mode === 'premarket') {
    try {
      const result = await runPremarketCheck(res)
      await recordRun('premarket-check', startedAt, { errors: [] })
      return result
    } catch (err) {
      console.error('[nightly-research] premarket check failed:', err.message)
      await recordRun('premarket-check', startedAt, { errors: [{ step: 'premarket', error: err.message }] })
      return res.status(500).json({ error: err.message })
    }
  }

  const errors = []

  // Step 1: collect adaptive X signals (primary discovery layer)
  let signals = []
  let queries = []
  let signalStats = { accountSignals: 0, searchSignals: 0 }
  try {
    const xResult = await collectXSignals()
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
    articles = await fetchAllYahooNews()
    console.log(`[nightly-research] fetched ${articles.length} articles`)
  } catch (err) {
    console.error('[nightly-research] yahoo rss failed:', err.message)
    errors.push({ step: 'yahoo', error: err.message })
  }

  // Step 2.5: technical screener (pre-breakout/squeeze detection)
  try {
    const candidates = await fetchBreakoutCandidates()
    const screenerSignals = candidatesToSignals(candidates)
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
    const seed = deriveAdaptiveSeed({ baseSignals: signals })
    const exaSignals = await runExaDiscovery(seed)
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
    const dayTradeSignals = await collectDayTradeSignals('nightly')
    signals = [...signals, ...dayTradeSignals]
    console.log(`[nightly-research] day-trade signals: ${dayTradeSignals.length}`)
  } catch (err) {
    console.error('[nightly-research] day-trade signals failed:', err.message)
    errors.push({ step: 'day-trade', error: err.message })
  }

  // Each discovery channel gets a chance even when X and RSS are unavailable.
  if (signals.length === 0 && articles.length === 0) {
    await recordRun('nightly-research', startedAt, { errors })
    return res.status(503).json({ error: 'No content available from any source', errors })
  }

  // Market regime — rates the tape, never an individual pick. Recorded on
  // every pick so this becomes calibratable once the history spans more than
  // the single month it currently covers; it cannot be backfilled.
  let regime = null
  try {
    regime = await getMarketRegime()
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
  let shadowBoard = []
  try {
    // A run where a discovery feed failed produces low mention counts for every
    // ticker. Recorded as though it were real, the next run would read a
    // market-wide collapse in attention that never happened, so a degraded run
    // is not written to the coverage history at all.
    const DISCOVERY_STEPS = ['x', 'yahoo', 'screener', 'exa-discovery', 'day-trade']
    const discoveryHealthy = !errors.some((e) => DISCOVERY_STEPS.includes(e.step))
    if (!discoveryHealthy) console.warn('[nightly-research] discovery degraded — coverage history will not record this run')

    tickers = await extractTickers(signals, articles, {
      onBoard: (board) => { shadowBoard = board.slice(0, 15) },
      regime,
      discoveryHealthy,
    })
    console.log(`[nightly-research] extracted ${tickers.length} tickers:`, tickers.map((t) => t.ticker))
  } catch (err) {
    console.error('[nightly-research] ticker extraction failed:', err.message)
    errors.push({ step: 'claude', error: err.message })
  }

  // Step 3.5: Contrarian Agent — stress-test each pick with bear case
  if (tickers.length > 0) {
    try {
      tickers = await runContrarianAgent(tickers)
      const bearCases = tickers.filter((t) => t.bearCase).length
      console.log(`[nightly-research] contrarian agent: ${bearCases}/${tickers.length} bear cases generated`)
    } catch (err) {
      console.error('[nightly-research] contrarian agent failed:', err.message)
      errors.push({ step: 'contrarian', error: err.message })
    }
  }

  // Step 3.6: Catalyst Agent — verify catalysts via Exa search
  if (tickers.length > 0) {
    try {
      tickers = await runCatalystAgent(tickers)
      const verified = tickers.filter((t) => t.catalystVerified).length
      console.log(`[nightly-research] catalyst agent: ${verified}/${tickers.length} catalysts verified`)
    } catch (err) {
      console.error('[nightly-research] catalyst agent failed:', err.message)
      errors.push({ step: 'catalyst', error: err.message })
    }
  }

  // Step 3.8: re-rank with everything the agents learned (risk scores,
  // catalyst verification) so delivery order reflects true expected edge
  if (tickers.length > 0) {
    const before = tickers.map((t) => t.ticker)
    tickers = finalizePicks(tickers)
    console.log(`[nightly-research] finalized order: ${before.join(',')} → ${tickers.map((t) => t.ticker).join(',')}`)
  }

  const redis = getRedis()
  const dateKey = new Date().toISOString().slice(0, 10)
  const generatedAt = new Date().toISOString()

  // Stamp the tape onto each pick, so a later calibration can ask what the
  // regime was on the day it was made without reconstructing it.
  const stamp = (list) => (regime
    ? list.map((p) => ({
      ...p,
      regimeScore: regime.score,
      regimeLabel: regime.label,
      suggestedSizeMultiplier: regimeSizeMultiplier(regime.score),
    }))
    : list)

  const buildPayload = (list, extra = {}) => ({
    generatedAt,
    picks: stamp(list),
    regime,
    articles,
    signalCount: signals.length,
    tweetCount: signals.length,
    queryCount: queries.length,
    xBreakdown: signalStats,
    errors,
    ...extra,
  })

  // Step 3.9: store the ranked picks BEFORE writing their reports.
  // Report generation is the longest leg of the run, so it is the leg most
  // likely to be cut short by the function time limit. Storing first means a
  // kill there costs the reports, not the entire night's picks — the failure
  // degrades instead of erasing. The index push happens here, once, so a run
  // that dies mid-report still leaves a history entry that is reachable.
  if (redis && tickers.length > 0) {
    try {
      const partial = buildPayload(tickers, { reportsPending: true })
      await redis.set(RESEARCH_KEY, partial, { ex: RESEARCH_TTL })
      await redis.set(`research:history:${dateKey}`, partial, { ex: HISTORY_TTL })
      // Reruns on the same day would otherwise stack duplicate index entries.
      const newest = await redis.lindex(HISTORY_INDEX_KEY, 0)
      if (newest !== dateKey) await redis.lpush(HISTORY_INDEX_KEY, dateKey)
      await redis.ltrim(HISTORY_INDEX_KEY, 0, HISTORY_MAX_ENTRIES - 1)
      console.log(`[nightly-research] stored ${tickers.length} picks ahead of report generation`)
    } catch (err) {
      console.error('[nightly-research] pre-report store failed:', err.message)
      errors.push({ step: 'store-partial', error: err.message })
    }
  }

  // Step 4: generate research reports
  let picks = tickers
  if (tickers.length > 0) {
    try {
      picks = await generateResearchReports(tickers)
      console.log(`[nightly-research] generated ${picks.length} reports`)
    } catch (err) {
      console.error('[nightly-research] report generation failed:', err.message)
      errors.push({ step: 'reports', error: err.message })
    }
  }

  // Step 5: store the completed run, replacing the pre-report payload
  const payload = buildPayload(picks)

  if (redis) {
    await redis.set(RESEARCH_KEY, payload, { ex: RESEARCH_TTL })
    await redis.set(`research:history:${dateKey}`, payload, { ex: HISTORY_TTL })
    // A run that produced no tickers never took the pre-report branch above,
    // so its index entry is still owed.
    if (tickers.length === 0) {
      const newest = await redis.lindex(HISTORY_INDEX_KEY, 0)
      if (newest !== dateKey) await redis.lpush(HISTORY_INDEX_KEY, dateKey)
      await redis.ltrim(HISTORY_INDEX_KEY, 0, HISTORY_MAX_ENTRIES - 1)
    }

    // Shadow tracking: the top-15 board candidates that didn't make the cut.
    // Tracked like real picks (but never shown) to ~3x the learning data
    // behind setup/source win rates.
    const pickedSet = new Set(picks.map((p) => p.ticker))
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

  // Step 6: Send Slack alerts
  if (picks.length > 0) {
    try {
      await sendPickAlerts(picks)
    } catch (err) {
      console.error('[nightly-research] slack alert failed:', err.message)
      errors.push({ step: 'slack', error: err.message })
    }
  }

  await recordRun('nightly-research', startedAt, {
    errors,
    signals: signals.length,
    articles: articles.length,
    picks: picks.length,
    tickers: tickers.map((t) => t.ticker),
  })

  return res.status(200).json({
    stored: Boolean(redis),
    picks: picks.length,
    signalCount: signals.length,
    tweetCount: signals.length,
    queryCount: queries.length,
    articles: articles.length,
    exaSignals: exaSignalCount,
    tickers: tickers.map((t) => t.ticker),
    errors,
  })
}
