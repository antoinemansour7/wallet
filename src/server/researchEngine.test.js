import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { rankHighUpsideBoard, fetchAllYahooNews } from './researchEngine'

// fetchAllYahooNews tests
describe('fetchAllYahooNews', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses RSS XML items from Yahoo feeds', async () => {
    const xml = `<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title><![CDATA[Stock Market Rally Continues]]></title>
        <link>https://finance.yahoo.com/news/stock-rally</link>
        <pubDate>Mon, 19 May 2026 10:00:00 GMT</pubDate>
        <description><![CDATA[Markets moved higher today.]]></description>
      </item>
      <item>
        <title><![CDATA[Tech Sector Leads Gains]]></title>
        <link>https://finance.yahoo.com/news/tech-gains</link>
        <pubDate>Mon, 19 May 2026 09:00:00 GMT</pubDate>
        <description><![CDATA[Technology stocks outperformed.]]></description>
      </item>
    </channel></rss>`

    fetch.mockResolvedValue({ ok: true, text: async () => xml })

    const articles = await fetchAllYahooNews()

    expect(articles.length).toBeGreaterThanOrEqual(2)
    expect(articles[0]).toMatchObject({
      title: 'Stock Market Rally Continues',
      source: 'Yahoo Finance',
    })
  })

  it('deduplicates articles with the same title', async () => {
    const xml = `<rss><channel>
      <item><title>Same Title</title><link>a</link></item>
      <item><title>Same Title</title><link>b</link></item>
    </channel></rss>`

    fetch.mockResolvedValue({ ok: true, text: async () => xml })

    const articles = await fetchAllYahooNews()
    expect(articles.filter((a) => a.title === 'Same Title')).toHaveLength(1)
  })

  it('returns empty array on fetch failure', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503 })

    const articles = await fetchAllYahooNews()
    expect(articles).toEqual([])
  })
})

// rankHighUpsideBoard tests
describe('rankHighUpsideBoard', () => {
  const makeItem = (overrides = {}) => ({
    ticker: 'TEST',
    signalCount: 2,
    articleCount: 0,
    maxScore: 6.5,
    sources: ['@unusualwhales'],
    themes: [],
    snippets: ['test signal text'],
    squeezeSignals: 1,
    volumeSignals: 0,
    breakoutSignals: 0,
    catalystSignals: 0,
    negativeSignals: 0,
    accountMentions: 1,
    convictionMentions: 1,
    contextMentions: 0,
    searchMentions: 1,
    screenerMentions: 0,
    ...overrides,
  })

  it('ranks items with quote verification above unverified', () => {
    const quoteMap = new Map([['VERIFIED', { price: 25, changePercent: 2 }]])
    const board = [
      makeItem({ ticker: 'VERIFIED', signalCount: 2 }),
      makeItem({ ticker: 'NODATA', signalCount: 3 }),
    ]

    const ranked = rankHighUpsideBoard(board, quoteMap)

    expect(ranked[0].ticker).toBe('VERIFIED')
    expect(ranked[0].quoteVerified).toBe(true)
    expect(ranked[1].quoteVerified).toBe(false)
  })

  it('penalizes penny stocks (price < $5)', () => {
    const quoteMap = new Map([
      ['PENNY', { price: 2, changePercent: 0 }],
      ['NORMAL', { price: 30, changePercent: 0 }],
    ])
    const board = [
      makeItem({ ticker: 'PENNY', signalCount: 3, sources: ['a', 'b'] }),
      makeItem({ ticker: 'NORMAL', signalCount: 2, sources: ['a'] }),
    ]

    const ranked = rankHighUpsideBoard(board, quoteMap)

    expect(ranked[0].ticker).toBe('NORMAL')
    expect(ranked.find((r) => r.ticker === 'PENNY').pennyStockRisk).toBe(true)
  })

  it('penalizes mega-cap tickers (AAPL, NVDA, etc.)', () => {
    const quoteMap = new Map([
      ['NVDA', { price: 150, changePercent: 1 }],
      ['RKLB', { price: 25, changePercent: 1 }],
    ])
    const board = [
      makeItem({ ticker: 'NVDA', signalCount: 5, sources: ['a', 'b', 'c'] }),
      makeItem({ ticker: 'RKLB', signalCount: 3, sources: ['a', 'b'] }),
    ]

    const ranked = rankHighUpsideBoard(board, quoteMap)

    expect(ranked[0].ticker).toBe('RKLB')
    expect(ranked.find((r) => r.ticker === 'NVDA').mainstreamCrowdFavorite).toBe(true)
  })

  it('marks broken setups when huge down day detected', () => {
    const quoteMap = new Map([['BROKEN', { price: 10, changePercent: -20 }]])
    const board = [makeItem({ ticker: 'BROKEN' })]

    const ranked = rankHighUpsideBoard(board, quoteMap)

    expect(ranked[0].brokenSetupRisk).toBe(true)
  })

  it('assigns correct setupType based on dominant signal type', () => {
    const quoteMap = new Map([['SQZ', { price: 20, changePercent: 1 }]])
    const board = [makeItem({ ticker: 'SQZ', squeezeSignals: 3, breakoutSignals: 1, volumeSignals: 0, catalystSignals: 0 })]

    const ranked = rankHighUpsideBoard(board, quoteMap)

    expect(ranked[0].setupType).toBe('squeeze')
  })

  it('boosts tech-themed picks', () => {
    const quoteMap = new Map([
      ['TECH', { price: 30, changePercent: 1 }],
      ['NOTECH', { price: 30, changePercent: 1 }],
    ])
    const board = [
      makeItem({ ticker: 'TECH', themes: ['semiconductor', 'ai'], signalCount: 2, sources: ['a'] }),
      makeItem({ ticker: 'NOTECH', themes: ['energy'], signalCount: 2, sources: ['a'] }),
    ]

    const ranked = rankHighUpsideBoard(board, quoteMap)

    const techScore = ranked.find((r) => r.ticker === 'TECH').archetypeScore
    const noTechScore = ranked.find((r) => r.ticker === 'NOTECH').archetypeScore
    expect(techScore).toBeGreaterThan(noTechScore)
  })

  it('applies sector downtrend penalty', () => {
    const quoteMap = new Map([['SEMI', { price: 50, changePercent: -1 }]])
    const sectorTrends = new Map([['SMH', -4]])
    const board = [makeItem({ ticker: 'SEMI', themes: ['semiconductor'] })]

    const ranked = rankHighUpsideBoard(board, quoteMap, sectorTrends)

    // With SMH at -4%, should get a penalty
    const withPenalty = ranked[0].archetypeScore

    const rankedNoPenalty = rankHighUpsideBoard(board, quoteMap, new Map())
    const withoutPenalty = rankedNoPenalty[0].archetypeScore

    expect(withPenalty).toBeLessThan(withoutPenalty)
  })

  it('assigns priceBand correctly', () => {
    const quoteMap = new Map([
      ['LOW', { price: 3 }],
      ['MID', { price: 30 }],
      ['HIGH', { price: 300 }],
    ])
    const board = [
      makeItem({ ticker: 'LOW' }),
      makeItem({ ticker: 'MID' }),
      makeItem({ ticker: 'HIGH' }),
    ]

    const ranked = rankHighUpsideBoard(board, quoteMap)
    const get = (t) => ranked.find((r) => r.ticker === t)

    expect(get('LOW').priceBand).toBe('penny-risk')
    expect(get('MID').priceBand).toBe('core-upside')
    expect(get('HIGH').priceBand).toBe('large')
  })
})
