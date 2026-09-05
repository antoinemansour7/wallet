import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeTickersBatch } from './technicalAnalysis.js'

afterEach(() => vi.unstubAllGlobals())

function mockCandles(closes, { incomplete = false } = {}) {
  const start = Date.now() - (closes.length + 2) * 86400000
  const timestamp = closes.map((_, i) => Math.floor((start + i * 86400000) / 1000))
  if (incomplete) timestamp[timestamp.length - 1] = Math.floor(Date.now() / 1000)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ chart: { result: [{ timestamp, indicators: { quote: [{ close: closes, high: closes, low: closes, volume: closes.map(() => 10000) }] } }] } }) }))
}

describe('technical analysis data integrity', () => {
  it('reports neutral RSI and zero distance from high for a flat series', async () => {
    mockCandles(Array(60).fill(100))
    const item = (await analyzeTickersBatch(['FLAT'])).get('FLAT')
    expect(item.rsi).toBe(50)
    expect(item.pctFrom52wHigh).toBe(0)
  })

  it('preserves an RSI of zero for continuous losses', async () => {
    mockCandles(Array.from({ length: 60 }, (_, i) => 100 - i))
    const item = (await analyzeTickersBatch(['FALL'])).get('FALL')
    expect(item.rsi).toBe(0)
    expect(item.trend).toBe('oversold-downtrend')
  })

  it('excludes an unfinished daily bar from entry indicators', async () => {
    mockCandles([...Array(60).fill(100), 1000], { incomplete: true })
    const item = (await analyzeTickersBatch(['PARTIAL'])).get('PARTIAL')
    expect(item.price).toBe(100)
    expect(item.sma20).toBe(100)
    expect(item.rsi).toBe(50)
  })
})
