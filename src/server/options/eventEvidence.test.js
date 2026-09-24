// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { gatherOptionsEventEvidence, normalizeEarningsCalendar, reportedEarningsFromNews } from './eventEvidence.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'

const securities = OPTIONS_WATCHLIST_SNAPSHOT.securities
const byTicker = new Map(securities.map((security) => [security.ticker, security]))
const source = { provider: 'alpaca', licenseId: 'alpaca-basic-news', url: 'https://example.test/news' }
const news = (ticker, headline, publishedAt = '2026-09-24T11:05:00.000Z', symbolCount = 1) => ({
  securityId: byTicker.get(ticker).securityId, eventId: `${ticker}:${headline}`, headline, symbolCount,
  publishedAt, availableAt: '2026-09-24T13:16:00.000Z', source,
})
const tickersOf = (events) => events.map((event) => securities.find((s) => s.securityId === event.securityId).ticker)

describe('normalizeEarningsCalendar', () => {
  const body = (rows) => ({ status: { rCode: 200 }, data: { rows } })
  const args = { date: '2026-09-30', securities, availableAt: '2026-09-24T13:16:00.000Z' }

  it('keeps watchlist rows only, as estimated dates with the session timing', () => {
    const events = normalizeEarningsCalendar(body([
      { symbol: 'MU', time: 'time-after-hours' }, { symbol: 'NKE', time: 'time-after-hours' }, { symbol: 'ORCL', time: 'time-pre-market' },
      { symbol: 'AMD', time: 'time-not-supplied' },
    ]), args)
    expect(events.map(({ eventDate, timing, status, confirmation }) => ({ eventDate, timing, status, confirmation }))).toEqual([
      { eventDate: '2026-09-30', timing: 'after_close', status: 'scheduled', confirmation: 'estimated' },
      { eventDate: '2026-09-30', timing: 'before_open', status: 'scheduled', confirmation: 'estimated' },
      { eventDate: '2026-09-30', timing: 'unknown', status: 'scheduled', confirmation: 'estimated' },
    ])
    expect(tickersOf(events)).toEqual(['MU', 'ORCL', 'AMD'])
  })

  it('treats a missing table as an outage, not as a day with no reports', () => {
    expect(() => normalizeEarningsCalendar({ status: { rCode: 400 }, data: null }, args)).toThrow('earnings_calendar_invalid_response')
    expect(() => normalizeEarningsCalendar({ status: { rCode: 200 }, data: {} }, args)).toThrow('earnings_calendar_invalid_response')
    expect(normalizeEarningsCalendar(body([]), args)).toEqual([])
  })
})

describe('reportedEarningsFromNews', () => {
  it('recognises the wire result forms seen for the watchlist', () => {
    const events = reportedEarningsFromNews([
      news('MU', 'Micron Technology Q4 Adj. EPS $31.20 Beats $31.04 Estimate, Sales $50.62B Beat $50.1B Estimate; Sees Q1 Adj. EPS $33'),
      news('SOFI', 'SoFi Techs Q1 EPS $(0.05) Beats $(0.07) Estimate, Adj. Sales $460.00M Beat $441.02M Estimate'),
      news('AMZN', 'Amazon.com Q4 2024 GAAP EPS $1.86 Beats $1.48 Estimate, Sales $187.800B Beat $187.299B Estimate'),
      news('ASTS', 'AST SpaceMobile, Inc Q1 EPS $(0.23) Down From $(0.21) YoY'),
      news('NBIS', 'Nebius Group N.V. - Class A Ordinary Shares Q2 Adj. EPS $(0.38) Beats $(31.74) Estimate'),
      news('IREN', 'UPDATE: IREN Q4 Adj. EPS $(0.74) Misses $(0.49) Estimate, Sales $137.200M Miss $142.320M Estimate'),
      news('HOOD', 'Robinhood Q3 2023 EPS (0.09) Beats $(0.10) Estimate, Revenue $467M Misses $478.415M Estimate'),
    ], securities)
    expect(tickersOf(events).sort()).toEqual(['AMZN', 'ASTS', 'HOOD', 'IREN', 'MU', 'NBIS', 'SOFI'])
    expect(events.every((event) => event.status === 'reported' && event.confirmation === 'reported')).toBe(true)
  })

  it('rejects guidance, previews, other issuers, multi-company items and prefix look-alikes', () => {
    expect(reportedEarningsFromNews([
      news('MU', 'Micron Technology Sees Q3 EPS $1.57 +/- $0.10 Vs $1.47 Est.; Revenue $8.8B +/- $200M'),
      news('SMCI', 'Supermicro Sees Prelim. Q2 Adj. EPS $0.58-$0.60, Net Sales $5.6B-$5.7B'),
      news('MU', 'Micron Likely To Report Higher Q4 Earnings; These Most Accurate Analysts Revise Forecasts'),
      news('AMZN', 'Rivian Q2 EPS $(1.08) Beats $(1.27) Estimate'),
      news('PLTR', 'L3Harris Q3 Adj. EPS $2.70 Beats $2.60 Estimate', undefined, 2),
      news('INTC', 'Intelligent Systems Q2 EPS $0.10'),
      news('NVDA', 'NVIDIA Q2 Adj. EPS $1.05 Beats $1.01 Estimate', undefined, 3),
    ], securities)).toEqual([])
  })

  it('labels release timing in New York time and dates it on the New York calendar', () => {
    const events = reportedEarningsFromNews([
      news('ORCL', 'Oracle Q1 Adj. EPS $1.92 Beats $1.74 Estimate', '2026-09-10T00:30:00.000Z'), // 8:30 p.m. ET on the 9th
      news('MU', 'Micron Technology Q4 Adj. EPS $31.20 Beats $31.04 Estimate', '2026-09-24T11:05:00.000Z'), // 7:05 a.m. ET
    ], securities)
    const [evening, morning] = ['ORCL', 'MU'].map((ticker) => events.find((event) => event.securityId === byTicker.get(ticker).securityId))
    expect(evening).toMatchObject({ eventDate: '2026-09-09', timing: 'after_close' })
    expect(morning).toMatchObject({ eventDate: '2026-09-24', timing: 'before_open' })
  })
})

describe('gatherOptionsEventEvidence', () => {
  const freezeAt = '2026-09-24T13:20:00.000Z'
  const calendarRows = { '2026-09-30': [{ symbol: 'MU', time: 'time-after-hours' }] }
  function fakeFetch({ calendarFails = [], newsPages = 1, newsFails = false } = {}) {
    const calls = []
    const fetchImpl = async (url) => {
      const parsed = new URL(url)
      calls.push(parsed)
      if (parsed.hostname === 'api.nasdaq.com') {
        const date = parsed.searchParams.get('date')
        if (calendarFails.includes(date)) return { ok: false, status: 403, json: async () => ({}) }
        return { ok: true, json: async () => ({ status: { rCode: 200 }, data: { rows: calendarRows[date] || [] } }) }
      }
      if (newsFails) return { ok: false, status: 429, json: async () => ({}) }
      const symbols = parsed.searchParams.get('symbols').split(',')
      const page = Number(parsed.searchParams.get('page_token') || 0)
      const articles = symbols.map((ticker, index) => ({ id: `${ticker}-${page}-${index}`, symbols: [ticker],
        headline: `${ticker} update ${page}`, created_at: '2026-09-23T15:00:00Z', updated_at: '2026-09-23T15:00:00Z', url: 'https://example.test/a' }))
      // A market wrap tagging two watchlist names is read for coverage but not kept.
      if (page === 0 && symbols.length > 1) articles.push({ id: `wrap-${symbols[0]}`, symbols: symbols.slice(0, 2), headline: `Wrap ${symbols[0]}`,
        created_at: '2026-09-23T16:00:00Z', updated_at: '2026-09-23T16:00:00Z', url: 'https://example.test/w' })
      return { ok: true, json: async () => ({ news: articles, next_page_token: page + 1 < newsPages ? String(page + 1) : null }) }
    }
    return { fetchImpl, calls }
  }
  const run = (fetch, extra = {}) => gatherOptionsEventEvidence({ securities, tradingDate: '2026-09-24', freezeAt, deadlineAt: freezeAt,
    fetchImpl: fetch.fetchImpl, now: () => Date.parse('2026-09-24T13:15:05.000Z'), env: { ALPACA_API_KEY_ID: 'id', ALPACA_API_SECRET_KEY: 'secret' }, ...extra })

  it('checks every session through the day after the exit and reports complete coverage', async () => {
    const fetch = fakeFetch()
    const result = await run(fetch)
    const dates = fetch.calls.filter((url) => url.hostname === 'api.nasdaq.com').map((url) => url.searchParams.get('date'))
    // Thursday entry, exit Tuesday 29th; the 30th is checked for an event just after the exit.
    expect(dates).toEqual(['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30'])
    expect(result.coverage.earnings).toMatchObject({ status: 'complete', from: '2026-09-24', through: '2026-09-30' })
    expect(result.earnings).toEqual([expect.objectContaining({ eventId: 'nasdaq:MU:2026-09-30', timing: 'after_close', confirmation: 'estimated' })])
  })

  it('keeps a failed calendar date visible as incomplete coverage instead of an empty day', async () => {
    const partial = await run(fakeFetch({ calendarFails: ['2026-09-30'] }))
    expect(partial.coverage.earnings.status).toBe('partial')
    expect(partial.earnings).toEqual([])
    const none = await run(fakeFetch({ calendarFails: ['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30'] }))
    expect(none.coverage.earnings.status).toBe('unavailable')
  })

  it('pages news in parallel ticker groups and marks it complete only when every group finished', async () => {
    const fetch = fakeFetch({ newsPages: 3 })
    const result = await run(fetch)
    const groups = new Set(fetch.calls.filter((url) => url.hostname !== 'api.nasdaq.com').map((url) => url.searchParams.get('symbols')))
    expect(groups.size).toBe(5)
    expect([...groups].flatMap((group) => group.split(',')).sort()).toEqual(securities.map((s) => s.ticker).sort())
    expect(result.coverage.news.status).toBe('complete')
    expect(result.news).toHaveLength(securities.length * 3)
    expect(result.metrics).toMatchObject({ newsItemsSeen: securities.length * 3 + 10, newsItemsKept: securities.length * 3 })

    const capped = await run(fakeFetch({ newsPages: 25 }))
    expect(capped.coverage.news.status).toBe('partial')
    const failed = await run(fakeFetch({ newsFails: true }))
    expect(failed.coverage.news.status).toBe('unavailable')
  })

  it('never reads news published after the freeze and stops at the deadline', async () => {
    const late = await run(fakeFetch(), { now: () => Date.parse(freezeAt) })
    expect(late.coverage.earnings.status).toBe('unavailable')
    expect(late.coverage.news.status).toBe('unavailable')
  })
})
