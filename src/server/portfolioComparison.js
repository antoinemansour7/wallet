import { createHash } from 'node:crypto'
import { Redis } from '@upstash/redis'
import { fetchDailyCloses, withTsxFallback } from './portfolioSeries.js'

const BENCHMARKS = new Set(['^GSPC', '^GSPTSE'])
const currencies = new Set(['CAD', 'USD'])
const validCloses = (candles) => Object.fromEntries(Object.entries(candles?.closesByDate || {}).filter(([, value]) => Number.isFinite(value) && value > 0).sort(([a], [b]) => a.localeCompare(b)))
const lagDays = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000

// A comparison must use the same dates and currency on both sides. Unlike a
// balance chart, it must never backfill a new listing or assume missing FX = 1.
export function buildComparison({ positions, benchmark, fx = {}, currency, cashValue = 0 }) {
  if (!currencies.has(currency)) throw new Error('Choose CAD or USD to compare price history.')
  const market = validCloses(benchmark)
  const marketDates = Object.keys(market)
  if (marketDates.length < 2 || !currencies.has(benchmark?.currency)) throw new Error('Benchmark history is unavailable. Please try again.')
  const end = marketDates.at(-1)
  const prepared = positions.map((position) => {
    const closes = validCloses(position)
    const dates = Object.keys(closes)
    const priced = position.quantity > 0 && currencies.has(position.currency) && dates.length >= 2 && lagDays(end, dates.at(-1)) <= 5
    return { ...position, closes, dates, priced }
  })
  const priced = prepared.filter((position) => position.priced)
  const held = prepared.filter((position) => !position.priced)
  const totalValue = prepared.reduce((sum, position) => sum + Math.abs(position.staticValue || 0), 0)
  const pricedValue = priced.reduce((sum, position) => sum + Math.abs(position.staticValue || 0), 0)
  const coverage = { priced: priced.length, total: prepared.length, percent: totalValue > 0 ? pricedValue / totalValue * 100 : null }
  const missingSymbols = held.map((position) => position.symbol)
  if (!priced.length && prepared.length) return { series: [], coverage, missingSymbols }
  const needsFx = benchmark.currency !== currency || priced.some((position) => position.currency !== currency)
  const exchange = validCloses({ closesByDate: fx })
  const fxDates = Object.keys(exchange)
  if (needsFx && (fxDates.length < 2 || lagDays(end, fxDates.at(-1)) > 5)) throw new Error('Exchange-rate history is unavailable. Please try again.')
  const start = [marketDates[0], ...priced.map((position) => position.dates[0]), ...(needsFx ? [fxDates[0]] : [])].sort().at(-1)
  const dates = marketDates.filter((date) => date >= start)
  const states = priced.map((position) => ({ ...position, index: 0, value: null, date: null }))
  let fxIndex = 0
  let rate = null
  let fxDate = null
  const convert = (value, from) => from === currency ? value : from === 'USD' ? value * rate : value / rate
  const base = cashValue + held.reduce((sum, position) => sum + (position.staticValue || 0), 0)
  const series = []
  for (const date of dates) {
    while (fxIndex < fxDates.length && fxDates[fxIndex] <= date) { fxDate = fxDates[fxIndex++]; rate = exchange[fxDate] }
    if (needsFx && (!rate || lagDays(date, fxDate) > 5)) continue
    let portfolio = base
    let complete = true
    for (const position of states) {
      while (position.index < position.dates.length && position.dates[position.index] <= date) {
        position.date = position.dates[position.index++]
        position.value = position.closes[position.date]
      }
      if (!position.value || lagDays(date, position.date) > 5) { complete = false; break }
      portfolio += convert(position.quantity * position.value, position.currency)
    }
    if (complete && portfolio > 0) series.push({ date, portfolio, benchmark: convert(market[date], benchmark.currency) })
  }
  return { series, coverage, missingSymbols }
}

export async function getPortfolioComparison({ positions = [], cashValue = 0, currency = 'CAD', benchmark = '^GSPC' }) {
  if (!BENCHMARKS.has(benchmark) || !currencies.has(currency) || positions.length > 500) throw new Error('Unsupported comparison request.')
  const inputs = positions.map((position) => ({ symbol: String(position.symbol || '').slice(0, 64), quantity: Number(position.quantity) || 0, staticValue: Number(position.marketValue) || 0 }))
  const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null
  const key = 'portfolio-comparison:v1:' + createHash('sha256').update(JSON.stringify({ inputs, cashValue, currency, benchmark })).digest('hex')
  if (redis) {
    try { const cached = await redis.get(key); if (cached?.series?.length) return cached } catch { /* cache miss */ }
  }
  const queue = inputs.filter((position) => position.symbol && position.quantity > 0).slice(0, 30)
  const results = new Map()
  async function worker() {
    while (queue.length) {
      const position = queue.shift()
      let candles
      try { candles = await withTsxFallback(position.symbol, (symbol) => fetchDailyCloses(symbol, 365)) } catch { /* reported in coverage */ }
      results.set(position, candles)
    }
  }
  const [market, exchange] = await Promise.all([
    fetchDailyCloses(benchmark, 365),
    fetchDailyCloses('USDCAD=X', 365).catch(() => null),
    ...Array.from({ length: 4 }, worker),
  ])
  const result = buildComparison({
    positions: inputs.map((position) => ({ ...position, ...results.get(position) })),
    benchmark: market, fx: exchange?.closesByDate, currency, cashValue,
  })
  if (redis && result.series.length) {
    try { await redis.set(key, result, { ex: 1800 }) } catch { /* optional cache */ }
  }
  return result
}
