// ─── Technical trade signal ─────────────────────────────────────────────────
// A deterministic read on a chart: which way it leans, and how much the
// evidence actually agrees. No LLM — fast, pure, and explainable.
// NOT financial advice; the UI must say so.
//
// This replaces a version that summed independent-looking bonuses, which had
// three problems worth recording so they do not come back:
//
//   1. Cliffs. RSI 29.9 scored a −36 SELL and RSI 30.1 scored −73. A fifth of
//      a point doubled the call, because the buckets were step functions.
//   2. Correlated evidence counted as independent. "Below the 20-day",
//      "below the 50-day" and "MACD down" all fire together in any downtrend,
//      so one fact was counted three times and drove the score on its own.
//   3. Volume only ever amplified. A move on 0.30x normal volume scored the
//      same as one on 1.49x, so a drift nobody participated in read as
//      conviction.
//
// The structure here separates two questions that were previously mashed into
// one number: WHICH WAY the chart leans (direction) and HOW MUCH THE EVIDENCE
// AGREES (confidence). A conflicted chart on thin volume now says so instead
// of shouting.

/** Squash a ratio into -1..1, saturating at `full`. */
function saturate(value, full) {
  if (!Number.isFinite(value) || !Number.isFinite(full) || full === 0) return null
  return Math.max(-1, Math.min(1, value / full))
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

// Distances at which a component is considered maximally stretched. Percent of
// price, chosen so an ordinary daily move moves the needle without pinning it.
const TREND_FULL = 5      // % from a moving average
const MACD_FULL = 1.5     // histogram as % of price
const INTRADAY_FULL = 2   // % day change

export const COMPONENT_WEIGHTS = {
  trend: 0.35,
  momentum: 0.25,
  meanReversion: 0.20,
  intraday: 0.20,
}

/**
 * Where price sits in its own trend structure. The three sub-readings are
 * averaged rather than summed: price below both averages while the averages
 * are crossed down is ONE observation about trend seen from three angles, and
 * summing it was what let a single fact reach a -73.
 */
function trendComponent({ price, sma20, sma50 }) {
  const parts = []
  if (Number.isFinite(price) && Number.isFinite(sma20) && sma20 > 0) {
    parts.push(saturate(((price - sma20) / sma20) * 100, TREND_FULL))
  }
  if (Number.isFinite(price) && Number.isFinite(sma50) && sma50 > 0) {
    parts.push(saturate(((price - sma50) / sma50) * 100, TREND_FULL))
  }
  if (Number.isFinite(sma20) && Number.isFinite(sma50) && sma50 > 0) {
    parts.push(saturate(((sma20 - sma50) / sma50) * 100, TREND_FULL))
  }
  return mean(parts.filter((p) => p != null))
}

function momentumComponent({ price, macd }) {
  const hist = macd?.histogram
  if (!Number.isFinite(hist) || !Number.isFinite(price) || price <= 0) return null
  return saturate((hist / price) * 100, MACD_FULL)
}

/**
 * RSI read as mean reversion, continuously. 50 is neutral, 30 is fully
 * oversold (a reason to buy, or at least to stop selling), 70 fully overbought.
 * Continuous on purpose — the old buckets made 29.9 and 30.1 different signals.
 */
function meanReversionComponent({ rsi }) {
  if (!Number.isFinite(rsi)) return null
  return Math.max(-1, Math.min(1, (50 - rsi) / 20))
}

function intradayComponent({ price, prevClose }) {
  if (!Number.isFinite(price) || !Number.isFinite(prevClose) || prevClose <= 0) return null
  return saturate(((price - prevClose) / prevClose) * 100, INTRADAY_FULL)
}

/**
 * Volume decides how much any of this is worth. Below-average volume damps the
 * reading toward neutral; heavy volume lifts it. Previously this only ever
 * amplified, and only past 1.5x.
 */
export function participationFactor(relativeVolume) {
  if (!Number.isFinite(relativeVolume) || relativeVolume <= 0) return 1
  return Math.max(0.45, Math.min(1.1, 0.4 + 0.6 * relativeVolume))
}

const LABELS = {
  trend: 'Trend',
  momentum: 'Momentum',
  meanReversion: 'RSI',
  intraday: 'Today',
}

function describe(key, value, inputs) {
  const strong = Math.abs(value) > 0.6
  switch (key) {
    case 'trend':
      return value > 0
        ? `${strong ? 'Well above' : 'Above'} its moving averages`
        : `${strong ? 'Well below' : 'Below'} its moving averages`
    case 'momentum':
      return value > 0 ? 'MACD momentum building' : 'MACD momentum fading'
    case 'meanReversion': {
      // Described from the RSI itself, not from the normalised value. Keying
      // off the normalised number called RSI 61 "overbought", because ±0.5
      // there is RSI 60/40 — nowhere near the 70/30 the words actually mean.
      const rsi = inputs.rsi
      if (rsi <= 30) return `RSI ${rsi} — oversold`
      if (rsi >= 70) return `RSI ${rsi} — overbought`
      if (rsi <= 40) return `RSI ${rsi} — below the midline, nearing oversold`
      if (rsi >= 60) return `RSI ${rsi} — above the midline, nearing overbought`
      return `RSI ${rsi} — neutral`
    }
    case 'intraday':
      return value > 0 ? 'Up on the day' : 'Down on the day'
    default:
      return key
  }
}

export function computeSignal(inputs = {}) {
  const { relativeVolume } = inputs

  const raw = {
    trend: trendComponent(inputs),
    momentum: momentumComponent(inputs),
    meanReversion: meanReversionComponent(inputs),
    intraday: intradayComponent(inputs),
  }

  const present = Object.entries(raw).filter(([, v]) => v != null)
  if (present.length === 0) {
    return {
      verdict: 'HOLD', score: 0, strength: 0, confidence: 0,
      direction: 0, agreement: 0, participation: 1,
      components: [], reasons: [], conflicts: [], coverage: '0/4',
    }
  }

  // Renormalise over the components we actually have, so a missing indicator
  // pulls toward neutral instead of silently halving the score.
  const totalWeight = present.reduce((sum, [k]) => sum + COMPONENT_WEIGHTS[k], 0)
  const direction = present.reduce((sum, [k, v]) => sum + COMPONENT_WEIGHTS[k] * v, 0) / totalWeight

  // How much the evidence agrees. 1 when every component points the same way,
  // toward 0 when they cancel each other out. This is the number that was
  // missing: a chart pulling in two directions is not a strong anything.
  const grossMagnitude = present.reduce((sum, [k, v]) => sum + COMPONENT_WEIGHTS[k] * Math.abs(v), 0) / totalWeight
  const agreement = grossMagnitude > 0 ? Math.abs(direction) / grossMagnitude : 0

  const participation = participationFactor(relativeVolume)
  const confidence = Math.round(Math.max(0, Math.min(100, agreement * participation * 100)))

  const components = present.map(([key, value]) => ({
    key,
    label: LABELS[key],
    value: Number(value.toFixed(3)),
    weight: COMPONENT_WEIGHTS[key],
    detail: describe(key, value, inputs),
  }))

  // Anything leaning against the overall read. Naming the dissent is the point:
  // "selling, but RSI is oversold and nobody is trading it" is a materially
  // different message from "selling".
  const conflicts = direction === 0
    ? []
    : components
      .filter((c) => Math.sign(c.value) === -Math.sign(direction) && Math.abs(c.value) > 0.15)
      .map((c) => c.detail)

  // A verdict needs both a lean and enough agreement to mean it. Without the
  // confidence gate a conflicted, untraded chart still produced a loud call.
  const NEUTRAL_BAND = 0.15
  const MIN_CONFIDENCE = 35
  const verdict = Math.abs(direction) < NEUTRAL_BAND || confidence < MIN_CONFIDENCE
    ? 'HOLD'
    : direction > 0 ? 'BUY' : 'SELL'

  const score = Math.round(direction * 100)

  return {
    verdict,
    score,
    direction: Number(direction.toFixed(3)),
    // Kept as |score| for the existing gauge; confidence is the honest one.
    strength: Math.abs(score),
    confidence,
    agreement: Number(agreement.toFixed(3)),
    participation: Number(participation.toFixed(2)),
    relativeVolume: Number.isFinite(relativeVolume) ? relativeVolume : null,
    thinVolume: Number.isFinite(relativeVolume) && relativeVolume < 0.8,
    components: components.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    conflicts,
    reasons: components
      .slice()
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .map((c) => c.detail)
      .slice(0, 4),
    coverage: `${present.length}/4`,
  }
}
