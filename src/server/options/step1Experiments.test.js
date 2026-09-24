import { describe, expect, it } from 'vitest'
import { STEP1_EXPERIMENTS, buildStep1Experiments, step1Signals } from './step1Experiments.js'

const TRADING_DATE = '2026-09-24'
const FREEZE = '2026-09-24T13:20:00.000Z'
const id = (ticker) => `wallai:security:${ticker.toLowerCase()}`

function newsItems(ticker, { today = 0, perPastDay = 1, symbolCount = 1 } = {}) {
  const items = []
  for (let n = 0; n < today; n += 1) items.push({ headline: `${ticker} today ${n}`, symbolCount, publishedAt: '2026-09-24T12:00:00.000Z' })
  for (let day = 1; day <= 20; day += 1) {
    const at = new Date(Date.parse(FREEZE) - (day + 0.5) * 86400000).toISOString()
    for (let n = 0; n < perPastDay; n += 1) items.push({ headline: `${ticker} past ${day}.${n}`, symbolCount, publishedAt: at })
  }
  return items
}

function record(ticker, { relativeStrength = 5, return5d = 3, sma20 = 2, regime = 7, gap = 1, gapScale = 2, volume = 1.2, trend60 = 10,
  news = newsItems(ticker), newsStatus = 'complete', earnings = [], premarketPrice = 100 } = {}) {
  return {
    security: { securityId: id(ticker), issuerId: `wallai:issuer:${ticker.toLowerCase()}`, ticker },
    recordId: `feature:${ticker}`, featureVersion: 'options-point-in-time-features-v2', tradingDate: TRADING_DATE, freezeAt: FREEZE,
    underlying: { premarketPrice, premarketMovePct: gap },
    technicals: { distanceFromSma20Pct: sma20, overnightGapRms20dPct: gapScale, priorSessionVolumeRatio: volume, return60dPct: trend60 },
    regime: regime == null ? null : { score: regime },
    directional: { call: { relativeStrength20dPct: relativeStrength, return5dPct: return5d }, put: { relativeStrength20dPct: -relativeStrength, return5dPct: -return5d } },
    nonEventHorizon: { state: 'eligible', reasons: [] },
    coverage: { earnings: { status: 'complete' }, catalysts: { status: 'complete' }, news: { status: newsStatus } },
    evidence: { news },
    events: { earnings, catalysts: [] },
  }
}

const snapshot = (records) => ({ schemaVersion: 'options-feature-snapshot-v1', snapshotId: 'snap', tradingDate: TRADING_DATE, freezeAt: FREEZE, securities: records })
const watchlist = (records) => ({ securities: records.map((item) => item.security) })
const build = (records) => buildStep1Experiments({ snapshot: snapshot(records), watchlist: watchlist(records) })
const arm = (result, name) => result.arms.find((item) => item.id === name).requested
const labels = (list) => list.map((item) => `${item.ticker}:${item.direction}`)

describe('buildStep1Experiments', () => {
  const tickers = Array.from({ length: 20 }, (_, index) => `S${String(index).padStart(2, '0')}`)
  const records = tickers.map((ticker, index) => record(ticker, { relativeStrength: index - 6, return5d: index - 6, sma20: index - 6,
    gap: (index % 2 ? 1 : -1) * (index + 1) / 5, volume: 1 + index / 10, trend60: index % 3 === 0 ? -5 : 5,
    news: newsItems(ticker, { today: index % 4 }) }))

  it('freezes every declared arm, and the live-score arms nest inside one another', () => {
    const result = build(records)
    expect(result.arms.map((item) => item.id)).toEqual(STEP1_EXPERIMENTS.map((item) => item.id))
    const ten = arm(result, 'current10'), fifteen = arm(result, 'current15')
    expect(ten).toHaveLength(10)
    expect(fifteen).toHaveLength(15)
    expect(fifteen.slice(0, 10)).toEqual(ten)
    expect(arm(result, 'ranks11_15')).toEqual(fifteen.slice(10))
    expect(result.exitAt).toBe('2026-09-29T20:00:00.000Z')
  })

  it('removes only the regime points in the no-regime arm', () => {
    // A defensive regime gives every put five points; without it, momentum decides.
    const tape = [record('UPA', { relativeStrength: 1, return5d: 0.5, sma20: 0.5, regime: 1 }), record('UPB', { relativeStrength: 2, return5d: 1, sma20: 1, regime: 1 })]
    const result = build(tape)
    expect(labels(arm(result, 'current15'))).toEqual(['UPA:put', 'UPB:put'])
    expect(labels(arm(result, 'no_regime15'))).toEqual(['UPB:call', 'UPA:call'])
    expect(arm(result, 'no_regime_both')).toEqual(arm(result, 'no_regime15'))
  })

  it('builds all-stock controls from the eligible stocks only', () => {
    const blocked = record('EVT', { earnings: [{ eventDate: '2026-09-25', timing: 'before_open', status: 'scheduled' }] })
    const noPrice = record('NOP', { premarketPrice: null })
    const result = build([...records.slice(0, 3), blocked, noPrice])
    expect(labels(arm(result, 'all_calls'))).toEqual(['S00:call', 'S01:call', 'S02:call'])
    expect(labels(arm(result, 'all_puts'))).toEqual(['S00:put', 'S01:put', 'S02:put'])
    expect(arm(result, 'all_both')).toHaveLength(6)
  })

  it('treats only a verified release since the last close as an earnings setup, in the gap direction', () => {
    const release = (publicAt) => [{ eventDate: publicAt.slice(0, 10), status: 'reported', confirmation: 'reported', timing: 'after_close', publicAt }]
    const result = build([
      record('BUP', { gap: 4, earnings: release('2026-09-23T20:05:00.000Z') }),
      record('BDN', { gap: -4, earnings: release('2026-09-24T11:00:00.000Z') }),
      record('OLD', { gap: 4, earnings: release('2026-09-22T20:05:00.000Z') }),
      record('EST', { gap: 4, earnings: [{ eventDate: '2026-09-23', status: 'scheduled', confirmation: 'estimated', timing: 'after_close' }] }),
    ])
    expect(labels(arm(result, 'earnings_up'))).toEqual(['BUP:call'])
    expect(labels(arm(result, 'earnings_down'))).toEqual(['BDN:put'])
  })

  it('ranks movement on complete signals only, both directions, and the trend arm follows the 60-day sign', () => {
    const partial = record('PART', { newsStatus: 'partial', gap: 9, volume: 9 })
    const result = build([...records, partial])
    const movement = arm(result, 'movement15')
    expect(movement).toHaveLength(30)
    expect(movement.some((item) => item.ticker === 'PART')).toBe(false)
    expect(labels(arm(result, 'gap15'))).toContain('PART:call')
    const tickersInMovement = [...new Set(movement.map((item) => item.ticker))]
    expect(labels(arm(result, 'movement_trend60'))).toEqual(tickersInMovement.map((ticker) => {
      const index = Number(ticker.slice(1))
      return `${ticker}:${index % 3 === 0 ? 'put' : 'call'}`
    }))
    expect(result.arms[0].signalCoverage).toMatchObject({ eligibleStocks: 21, withNews: 20, withAllSignals: 20 })
  })

  it('is deterministic for the same frozen snapshot', () => {
    expect(build(records)).toEqual(build(records))
  })
})

describe('step1Signals', () => {
  it('scales the gap by normal overnight moves and counts company-specific news once', () => {
    const duplicate = { headline: 'X surges', symbolCount: 1, publishedAt: '2026-09-24T12:00:00.000Z' }
    const shared = { headline: 'Chip stocks rally', symbolCount: 4, publishedAt: '2026-09-24T12:30:00.000Z' }
    const signals = step1Signals(record('X', { gap: -3, gapScale: 1.5, news: [...newsItems('X'), duplicate, duplicate, shared] }))
    expect(signals.gapPct).toBe(-3)
    expect(signals.gapRatio).toBe(2)
    // One unique single-company headline today against one per day before: (1 + 1) / (1 + 1).
    expect(signals.newsRatio).toBe(1)
  })

  it('leaves news unknown rather than zero when coverage is incomplete', () => {
    expect(step1Signals(record('X', { newsStatus: 'partial' })).newsRatio).toBeNull()
    expect(step1Signals(record('X', { gapScale: null })).gapRatio).toBeNull()
  })
})
