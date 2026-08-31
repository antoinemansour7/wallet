// ─── Market regime ────────────────────────────────────────────────────────────
// Answers a question the board could not: is this a tape where a high-beta
// breakout pick is likely to work at all? The pipeline's only market-wide input
// was the daily percentage move of eight sector ETFs, so a day with the 10-year
// at a one-year high and crude up 6% in a month looked identical to a calm one.
//
// This is deliberately a SECOND AXIS, never folded into a pick's conviction. A
// 9/10 setup in a 3/10 tape is a real and common thing; collapsing the two into
// one number makes "great idea, bad timing" indistinguishable from "mediocre
// idea", and those call for opposite actions. Conviction rates the idea, regime
// rates the weather, and position size is where they meet.
//
// Every input is a free Yahoo daily series — the same endpoint the portfolio
// chart already uses — so this adds no dependency and no marginal cost.
// ────────────────────────────────────────────────────────────────────────────────

import { Redis } from '@upstash/redis'

const CACHE_KEY = 'research:market-regime'
const CACHE_TTL = 60 * 60 // 1 hour

export const REGIME_SYMBOLS = {
  SPY: 'SPY',        // broad trend
  VIX: '^VIX',       // volatility
  TNX: '^TNX',       // 10-year yield
  OIL: 'CL=F',       // crude
  IWM: 'IWM',        // small caps — risk appetite
  ARKK: 'ARKK',      // high-beta growth — the cohort this board picks from
  HYG: 'HYG',        // high-yield credit
  RSP: 'RSP',        // equal-weight S&P — breadth
}

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

/** Daily closes as a date-sorted array, oldest first. */
export async function fetchRegimeSeries(symbol, days = 400) {
  const period2 = Math.floor(Date.now() / 1000)
  const period1 = period2 - days * 24 * 60 * 60
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?period1=${period1}&period2=${period2}&interval=1d`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return []

  const data = await res.json()
  const result = data?.chart?.result?.[0]
  const closes = result?.indicators?.quote?.[0]?.close
  const stamps = result?.timestamp
  if (!closes || !stamps) return []

  const out = []
  for (let i = 0; i < stamps.length; i += 1) {
    if (!Number.isFinite(closes[i])) continue
    out.push({ date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), close: closes[i] })
  }
  return out
}

// ─── Pure series helpers — every one respects `asOf` so a backtest can never
// see a price that had not printed yet. ──────────────────────────────────────

/** Index of the last bar on or before `asOf`, or -1. */
export function indexAsOf(series, asOf) {
  if (!Array.isArray(series) || series.length === 0) return -1
  if (!asOf) return series.length - 1
  let lo = 0
  let hi = series.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (series[mid].date <= asOf) { found = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return found
}

export function valueAsOf(series, asOf) {
  const i = indexAsOf(series, asOf)
  return i < 0 ? null : series[i].close
}

/** Percent change over `bars` trading days ending at `asOf`. */
export function changeOver(series, asOf, bars) {
  const i = indexAsOf(series, asOf)
  const j = i - bars
  if (i < 0 || j < 0) return null
  const then = series[j].close
  return then > 0 ? ((series[i].close - then) / then) * 100 : null
}

/** Percent distance from the trailing simple moving average. */
export function distanceFromSma(series, asOf, bars) {
  const i = indexAsOf(series, asOf)
  if (i < 0 || i + 1 < bars) return null
  const window = series.slice(i + 1 - bars, i + 1)
  const mean = window.reduce((sum, p) => sum + p.close, 0) / window.length
  return mean > 0 ? ((series[i].close - mean) / mean) * 100 : null
}

/** Where today's value sits within the trailing window, 0-100. */
export function percentileAsOf(series, asOf, lookback = 252) {
  const i = indexAsOf(series, asOf)
  if (i < 0) return null
  const window = series.slice(Math.max(0, i + 1 - lookback), i + 1)
  if (window.length < 20) return null
  const value = series[i].close
  // Ties count half. Counting them as "below" put a perfectly flat series at
  // the 100th percentile — reading a quiet tape as maximum stress, which is
  // exactly backwards, and the same distortion applies in miniature to any
  // instrument that has been pinned at a level for weeks.
  const below = window.filter((p) => p.close < value).length
  const ties = window.filter((p) => p.close === value).length
  return Math.round(((below + ties / 2) / window.length) * 100)
}

const clamp = (n, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, n))

/** 1st, 2nd, 3rd, 4th... 11th-13th are the exceptions that catch naive versions. */
export function ordinal(n) {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`
}
const round1 = (n) => Number(n.toFixed(1))

// These weights are UNCALIBRATED and should be read as a hypothesis.
//
// scripts/calibrate-regime.mjs was run against 334 tracked picks over 25 dates
// and returned spearman -0.73 between the score and 5-day forward return —
// apparently a strong inverse signal. It is not one. Over that window the score
// correlates +0.89 with the calendar and returns correlate -0.69 with it, so the
// two trending series produce the result mechanically; split the sample in half
// and the second half falls to -0.08. One month of a single rising tape cannot
// separate a regime effect from the drift.
//
// So the weights are deliberately left as first-cut judgment rather than fitted
// to that sample: flipping the sign on this evidence would advise buying harder
// into deteriorating tape. The score is stored with every pick from now on, and
// becomes calibratable once the history spans more than one regime.
export const REGIME_WEIGHTS = {
  trend: 0.20,
  volatility: 0.15,
  rates: 0.20,
  commodity: 0.10,
  riskAppetite: 0.20,
  credit: 0.10,
  breadth: 0.05,
}

/**
 * Score one day's regime, 0-10, from date-keyed daily series.
 * `asOf` (YYYY-MM-DD) makes this replayable over history.
 */
export function computeRegime(series, asOf = null) {
  const s = (key) => series[key] || []
  const parts = []
  const add = (key, label, score, detail) => {
    if (score == null) return
    parts.push({ key, label, score: round1(clamp(score)), weight: REGIME_WEIGHTS[key], detail })
  }

  // Trend — is the index itself working?
  const spy50 = distanceFromSma(s('SPY'), asOf, 50)
  const spy200 = distanceFromSma(s('SPY'), asOf, 200)
  if (spy50 != null) {
    add('trend', 'Trend', 5 + spy50 * 1.2 + (spy200 ?? 0) * 0.15,
      `SPY ${spy50 >= 0 ? '+' : ''}${spy50.toFixed(1)}% vs 50MA`
      + (spy200 != null ? `, ${spy200 >= 0 ? '+' : ''}${spy200.toFixed(1)}% vs 200MA` : ''))
  }

  // Volatility — low VIX is supportive. Monotonic on purpose: a complacency
  // penalty at the extreme low is a real effect but not one this sample can
  // separate from noise, so it is left out rather than guessed at.
  const vixPct = percentileAsOf(s('VIX'), asOf)
  const vixLast = valueAsOf(s('VIX'), asOf)
  if (vixPct != null) {
    add('volatility', 'Volatility', 10 - vixPct / 10,
      `VIX ${vixLast?.toFixed(1)} (${ordinal(vixPct)} pctile)`)
  }

  // Rate stress — level AND rate of change. Fast-rising yields compress the
  // multiples of exactly the long-duration names this board favours.
  const tnxPct = percentileAsOf(s('TNX'), asOf)
  const tnx20 = changeOver(s('TNX'), asOf, 20)
  const tnxLast = valueAsOf(s('TNX'), asOf)
  if (tnxPct != null) {
    add('rates', 'Rate stress', 10 - tnxPct / 10 - (tnx20 ?? 0) * 1.5,
      `10y ${tnxLast?.toFixed(2)}% at ${ordinal(tnxPct)} pctile`
      + (tnx20 != null ? `, ${tnx20 >= 0 ? '+' : ''}${tnx20.toFixed(1)}% in 20d` : ''))
  }

  // Commodity stress — a fast crude spike is an input-cost and inflation shock.
  const oil20 = changeOver(s('OIL'), asOf, 20)
  if (oil20 != null) {
    add('commodity', 'Commodity', 5 - oil20 * 0.5,
      `crude ${oil20 >= 0 ? '+' : ''}${oil20.toFixed(1)}% in 20d`)
  }

  // Risk appetite — are speculative cohorts being paid or punished, relative
  // to the index? Absolute moves say more about beta than about appetite.
  const arkk20 = changeOver(s('ARKK'), asOf, 20)
  const iwm20 = changeOver(s('IWM'), asOf, 20)
  const spy20 = changeOver(s('SPY'), asOf, 20)
  if (spy20 != null && (arkk20 != null || iwm20 != null)) {
    const arkkRel = arkk20 != null ? arkk20 - spy20 : 0
    const iwmRel = iwm20 != null ? iwm20 - spy20 : 0
    add('riskAppetite', 'Risk appetite', 5 + arkkRel * 0.25 + iwmRel * 0.4,
      `high-beta ${arkkRel >= 0 ? '+' : ''}${arkkRel.toFixed(1)}pp, small caps ${iwmRel >= 0 ? '+' : ''}${iwmRel.toFixed(1)}pp vs SPY`)
  }

  // Credit — the market that usually cracks first.
  const hygSma = distanceFromSma(s('HYG'), asOf, 50)
  const hygPct = percentileAsOf(s('HYG'), asOf)
  if (hygSma != null) {
    add('credit', 'Credit', 5 + hygSma * 3 - (50 - (hygPct ?? 50)) / 10,
      `HYG ${hygSma >= 0 ? '+' : ''}${hygSma.toFixed(1)}% vs 50MA`
      + (hygPct != null ? `, ${ordinal(hygPct)} pctile` : ''))
  }

  // Breadth — is the advance shared, or is the index being carried?
  const rsp20 = changeOver(s('RSP'), asOf, 20)
  if (rsp20 != null && spy20 != null) {
    const rel = rsp20 - spy20
    add('breadth', 'Breadth', 5 + rel * 2,
      `equal-weight ${rel >= 0 ? '+' : ''}${rel.toFixed(1)}pp vs cap-weight`)
  }

  if (parts.length === 0) return null

  // Renormalise over the components that were actually available, so one
  // missing feed shifts the score toward neutral rather than toward zero.
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0)
  const score = parts.reduce((sum, p) => sum + p.score * p.weight, 0) / totalWeight

  const sorted = [...parts].sort((a, b) => a.score - b.score)
  return {
    asOf: asOf || new Date().toISOString().slice(0, 10),
    score: round1(score),
    label: regimeLabel(score),
    components: parts,
    drag: sorted[0] ? { label: sorted[0].label, detail: sorted[0].detail } : null,
    support: sorted.at(-1) ? { label: sorted.at(-1).label, detail: sorted.at(-1).detail } : null,
    coverage: `${parts.length}/${Object.keys(REGIME_WEIGHTS).length}`,
  }
}

export function regimeLabel(score) {
  if (score >= 7) return 'constructive'
  if (score >= 5) return 'mixed'
  if (score >= 3) return 'defensive'
  return 'stand down'
}

/**
 * Suggested size multiplier — advisory only, and deliberately NOT applied
 * automatically anywhere. The relationship it encodes is unvalidated (see the
 * note on REGIME_WEIGHTS), and silently shrinking positions on an unproven
 * signal is a worse failure than showing a number a human can overrule.
 *
 * Kept separate from conviction on principle regardless of calibration: the
 * pick keeps whatever rating the idea earned, and the tape only argues about
 * how much of it to own.
 */
export function regimeSizeMultiplier(score) {
  if (score == null) return 1
  if (score >= 7) return 1
  if (score >= 5) return 0.75
  if (score >= 3) return 0.5
  return 0.25
}

/** Today's regime, cached for an hour. */
export async function getMarketRegime() {
  const redis = getRedis()
  if (redis) {
    try {
      const cached = await redis.get(CACHE_KEY)
      if (cached?.score != null) return cached
    } catch { /* cache miss */ }
  }

  const entries = await Promise.all(
    Object.entries(REGIME_SYMBOLS).map(async ([key, symbol]) => {
      try {
        return [key, await fetchRegimeSeries(symbol)]
      } catch (err) {
        console.error(`[marketRegime] ${symbol} failed:`, err.message)
        return [key, []]
      }
    })
  )
  const series = Object.fromEntries(entries)
  const regime = computeRegime(series)

  if (regime && redis) {
    try { await redis.set(CACHE_KEY, regime, { ex: CACHE_TTL }) } catch { /* non-critical */ }
  }
  return regime
}

/** Compact block for the model prompt — numbers, not adjectives. */
export function formatRegimeForPrompt(regime) {
  if (!regime) return ''
  const lines = regime.components.map(
    (c) => `  ${c.label}: ${c.score}/10 — ${c.detail}`,
  )
  return [
    '',
    `=== MARKET REGIME (${regime.score}/10 — ${regime.label}) ===`,
    ...lines,
    `Biggest drag: ${regime.drag?.label} (${regime.drag?.detail}).`,
    'This rates the tape, not any individual pick. Do NOT lower a pick\'s conviction because',
    'the regime is poor — conviction rates the idea on its own merits and position size is',
    'where the tape is expressed. Use this to judge whether a setup has to fight its',
    'environment, and say so in the reason when it does.',
    '',
  ].join('\n')
}
