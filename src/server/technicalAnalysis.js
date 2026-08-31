// ─── Per-ticker technical analysis via Yahoo Finance daily candles ──────────────

// ─── Fetch daily candles from Yahoo Finance ────────────────────────────────────

async function fetchDailyCandles(ticker, days = 120) {
  const period2 = Math.floor(Date.now() / 1000)
  const period1 = period2 - days * 24 * 60 * 60

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    console.error(`[technicalAnalysis] Yahoo candles ${res.status} for ${ticker}`)
    return null
  }

  const data = await res.json()
  const result = data?.chart?.result?.[0]
  if (!result?.indicators?.quote?.[0]) return null

  const quotes = result.indicators.quote[0]
  const timestamps = result.timestamp || []

  const candles = []
  for (let i = 0; i < timestamps.length; i++) {
    const c = quotes.close?.[i]
    const h = quotes.high?.[i]
    const l = quotes.low?.[i]
    const v = quotes.volume?.[i]
    if (c != null && h != null) {
      candles.push({ c, h, l: l ?? c, v: v || 0 })
    }
  }

  return candles
}

// ─── Indicators ────────────────────────────────────────────────────────────────

function computeSMA(closes, period) {
  if (closes.length < period) return null
  const slice = closes.slice(-period)
  return slice.reduce((sum, v) => sum + v, 0) / period
}

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null

  let avgGain = 0
  let avgLoss = 0

  // Initial average
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) avgGain += change
    else avgLoss += Math.abs(change)
  }
  avgGain /= period
  avgLoss /= period

  // Smoothed for remaining bars
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? Math.abs(change) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function computeMACD(closes) {
  if (closes.length < 26) return null

  const ema = (data, period) => {
    const k = 2 / (period + 1)
    let prev = data.slice(0, period).reduce((s, v) => s + v, 0) / period
    const result = [prev]
    for (let i = period; i < data.length; i++) {
      prev = data[i] * k + prev * (1 - k)
      result.push(prev)
    }
    return result
  }

  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)

  // Align: ema12 starts at index 12, ema26 at index 26
  // MACD line = ema12 - ema26 (from index 26 onward)
  const offset = 26 - 12 // = 14
  const macdLine = []
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i])
  }

  if (macdLine.length < 9) return { macd: macdLine[macdLine.length - 1], signal: null, histogram: null }

  const signalLine = ema(macdLine, 9)
  const currentMACD = macdLine[macdLine.length - 1]
  const currentSignal = signalLine[signalLine.length - 1]

  return {
    macd: Number(currentMACD.toFixed(4)),
    signal: Number(currentSignal.toFixed(4)),
    histogram: Number((currentMACD - currentSignal).toFixed(4)),
  }
}

function deriveTrend(price, sma20, sma50, rsi) {
  if (!sma20 || !rsi) return 'unknown'

  const aboveSMA20 = price > sma20

  // If SMA50 is available, use full trend logic
  if (sma50) {
    const aboveSMA50 = price > sma50
    const sma20AboveSMA50 = sma20 > sma50

    if (aboveSMA20 && aboveSMA50 && sma20AboveSMA50) {
      if (rsi > 70) return 'overbought-uptrend'
      return 'uptrend'
    }

    if (aboveSMA20 && aboveSMA50 && !sma20AboveSMA50) {
      return 'recovery'
    }

    if (aboveSMA20 && !aboveSMA50) {
      return 'consolidating'
    }

    if (!aboveSMA20 && aboveSMA50) {
      return 'pullback'
    }

    if (!aboveSMA20 && !aboveSMA50) {
      if (rsi < 30) return 'oversold-downtrend'
      return 'downtrend'
    }

    return 'mixed'
  }

  // Fallback: SMA20 + RSI only
  if (aboveSMA20) {
    if (rsi > 70) return 'overbought-uptrend'
    return 'uptrend'
  }
  if (rsi < 30) return 'oversold-downtrend'
  return 'downtrend'
}

// ─── Main: analyze a single ticker ─────────────────────────────────────────────

async function analyzeTicker(ticker) {
  // Full year of candles so the 52-week high is real (not a 60-day high)
  const candles = await fetchDailyCandles(ticker, 365)
  if (!candles || candles.length < 20) {
    return { ticker, error: 'insufficient data', analyzed: false }
  }

  const closes = candles.map((c) => c.c)
  const highs = candles.map((c) => c.h)
  const price = closes[closes.length - 1]

  const sma20 = computeSMA(closes, 20)
  const sma50 = computeSMA(closes, 50)
  const rsi = computeRSI(closes, 14)
  const macd = computeMACD(closes)

  const high52w = Math.max(...highs)
  const pctFrom52wHigh = high52w > 0 ? ((price - high52w) / high52w) * 100 : null

  // Volume trend: avg last 5 days vs avg last 20 days
  const volumes = candles.map((c) => c.v)
  const avgVol5 = volumes.length >= 5
    ? volumes.slice(-5).reduce((s, v) => s + v, 0) / 5
    : null
  const avgVol20 = volumes.length >= 20
    ? volumes.slice(-20).reduce((s, v) => s + v, 0) / 20
    : null
  const relativeVolume = avgVol5 && avgVol20 ? Number((avgVol5 / avgVol20).toFixed(2)) : null

  // ATR(14) for stop-loss / target placement
  let atr = null
  if (candles.length >= 15) {
    const trs = []
    for (let i = candles.length - 14; i < candles.length; i++) {
      const prevClose = candles[i - 1].c
      trs.push(Math.max(
        candles[i].h - candles[i].l,
        Math.abs(candles[i].h - prevClose),
        Math.abs(candles[i].l - prevClose),
      ))
    }
    atr = Number((trs.reduce((s, v) => s + v, 0) / trs.length).toFixed(2))
  }

  const trend = deriveTrend(price, sma20, sma50, rsi)

  return {
    atr,
    ticker,
    analyzed: true,
    price: Number(price.toFixed(2)),
    sma20: sma20 ? Number(sma20.toFixed(2)) : null,
    sma50: sma50 ? Number(sma50.toFixed(2)) : null,
    rsi: rsi ? Number(rsi.toFixed(1)) : null,
    macd,
    pctFrom52wHigh: pctFrom52wHigh ? Number(pctFrom52wHigh.toFixed(1)) : null,
    relativeVolume,
    trend,
  }
}

// ─── Batch: analyze multiple tickers with concurrency control ──────────────────

export async function analyzeTickersBatch(tickers, { concurrency = 3 } = {}) {
  const results = new Map()
  const queue = [...tickers]

  async function worker() {
    while (queue.length > 0) {
      const ticker = queue.shift()
      try {
        const analysis = await analyzeTicker(ticker)
        results.set(ticker, analysis)
      } catch (err) {
        console.error(`[technicalAnalysis] failed for ${ticker}:`, err.message)
        results.set(ticker, { ticker, error: err.message, analyzed: false })
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tickers.length) }, () => worker())
  await Promise.all(workers)

  return results
}
