import { Redis } from '@upstash/redis'
import { computeSignal } from '../src/server/tradeSignal.js'
import { analyzeTickersBatch } from '../src/server/technicalAnalysis.js'
import { fetchYahooQuotes } from '../src/server/yahooQuotes.js'

const SEED_TTL = 300 // indicators barely move intraday
const SPARK_TTL = 60 // intraday sparkline

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

// Indicators (RSI/MACD/SMA/ATR), cached so the polling loop stays cheap.
async function getSeed(symbol) {
  const redis = getRedis()
  const key = `trade-seed:${symbol}`
  if (redis) {
    try { const cached = await redis.get(key); if (cached) return cached } catch { /* miss */ }
  }
  let tech = null
  try {
    const t = (await analyzeTickersBatch([symbol], { concurrency: 1 })).get(symbol)
    if (t?.analyzed) tech = t
  } catch { /* leave null */ }

  const seed = {
    rsi: tech?.rsi ?? null,
    sma20: tech?.sma20 ?? null,
    sma50: tech?.sma50 ?? null,
    macd: tech?.macd ?? null,
    atr: tech?.atr ?? null,
    relativeVolume: tech?.relativeVolume ?? null,
    trend: tech?.trend ?? null,
  }
  if (redis && tech) { try { await redis.set(key, seed, { ex: SEED_TTL }) } catch { /* non-critical */ } }
  return seed
}

// Today's 5-minute closes for the sparkline, cached 60s.
export async function getSpark(symbol) {
  const redis = getRedis()
  const key = `trade-spark:${symbol}`
  if (redis) {
    try { const cached = await redis.get(key); if (Array.isArray(cached) && cached.length) return cached } catch { /* miss */ }
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const data = await res.json()
    const closes = (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
      .filter((c) => Number.isFinite(c))
    const spark = closes.slice(-60).map((c) => Number(c.toFixed(2)))
    if (redis && spark.length) { try { await redis.set(key, spark, { ex: SPARK_TTL }) } catch { /* non-critical */ } }
    return spark
  } catch {
    return []
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const symbol = String(req.query?.symbol || '').toUpperCase().trim()
  if (!/^[A-Z]{1,6}(\.[A-Z]{1,3})?$/.test(symbol)) {
    return res.status(400).json({ error: 'Enter a stock symbol, e.g. NVDA or ORAC.NE' })
  }

  try {
    // Yahoo (forced fresh) for a near-real-time quote that also covers Canadian
    // listings/CDRs — Polygon is skipped here to avoid its 15-min delay.
    const [{ quotes }, seed, spark] = await Promise.all([
      fetchYahooQuotes([symbol], { forceRefresh: true }),
      getSeed(symbol),
      getSpark(symbol),
    ])

    const q = quotes.find((x) => Number.isFinite(x.price))
    if (!q) {
      return res.status(200).json({ found: false, symbol })
    }

    const price = q.price
    const prevClose = Number.isFinite(q.previousClose) ? q.previousClose : null
    const dayChange = prevClose ? Number((price - prevClose).toFixed(2)) : null
    const dayChangePct = Number.isFinite(q.changePercent)
      ? Number(q.changePercent.toFixed(2))
      : (prevClose ? Number((((price - prevClose) / prevClose) * 100).toFixed(2)) : null)

    return res.status(200).json({
      found: true,
      symbol,
      name: q.shortName || '',
      currency: q.currency || '',
      price,
      ts: q.marketTime ? new Date(q.marketTime * 1000).toISOString() : new Date().toISOString(),
      prevClose,
      dayChange,
      dayChangePct,
      spark,
      indicators: {
        rsi: seed.rsi,
        macd: seed.macd,
        trend: seed.trend,
        atr: seed.atr,
        relativeVolume: seed.relativeVolume,
      },
      signal: computeSignal({ price, ...seed, prevClose }),
    })
  } catch (err) {
    console.error('[live-quote] failed:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
