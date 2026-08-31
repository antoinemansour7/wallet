// ─── Technical trade signal ─────────────────────────────────────────────────
// Deterministic BUY / SELL / HOLD verdict from standard indicators + the live
// price. This is the same idea as TradingView's technical-rating gauge: a
// weighted blend of trend, momentum, and confirmation. NOT financial advice —
// the UI must say so. No LLM here: the score is pure, fast, and explainable.

const MAX_RAW = 5.5 // ceiling used to normalize the raw score into -100..100

export function computeSignal({ price, sma20, sma50, rsi, macd, prevClose, relativeVolume } = {}) {
  const reasons = []
  let score = 0

  // Trend — price relative to moving averages
  if (Number.isFinite(price) && Number.isFinite(sma20)) {
    if (price > sma20) { score += 1; reasons.push('Above 20-day average') }
    else { score -= 1; reasons.push('Below 20-day average') }
  }
  if (Number.isFinite(price) && Number.isFinite(sma50)) {
    if (price > sma50) { score += 1; reasons.push('Above 50-day average') }
    else { score -= 1; reasons.push('Below 50-day average') }
  }

  // Momentum — RSI
  if (Number.isFinite(rsi)) {
    if (rsi < 30) { score += 1.5; reasons.push(`RSI ${rsi} — oversold`) }
    else if (rsi > 70) { score -= 1.5; reasons.push(`RSI ${rsi} — overbought`) }
    else if (rsi >= 50) { score += 0.5; reasons.push(`RSI ${rsi} — firm`) }
    else { score -= 0.5; reasons.push(`RSI ${rsi} — soft`) }
  }

  // Momentum — MACD histogram direction
  const hist = macd?.histogram
  if (Number.isFinite(hist)) {
    if (hist > 0) { score += 1; reasons.push('MACD turning up') }
    else { score -= 1; reasons.push('MACD turning down') }
  }

  // Intraday direction vs prior close
  if (Number.isFinite(price) && Number.isFinite(prevClose) && prevClose > 0) {
    if (price > prevClose) score += 0.5
    else if (price < prevClose) score -= 0.5
  }

  // Volume confirmation amplifies an existing lean
  if (Number.isFinite(relativeVolume) && relativeVolume >= 1.5) {
    score *= 1.15
    reasons.push(`Volume ${relativeVolume}× normal`)
  }

  const norm = Math.max(-100, Math.min(100, Math.round((score / MAX_RAW) * 100)))
  const verdict = norm >= 25 ? 'BUY' : norm <= -25 ? 'SELL' : 'HOLD'

  return {
    verdict,
    score: norm,
    strength: Math.abs(norm),
    reasons: reasons.slice(0, 5),
  }
}
