import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  rankHighUpsideBoard,
  fetchAllYahooNews,
  postProcessCandidates,
  technicalAdjustment,
  setupPerformanceAdjustment,
  sourcePerformanceAdjustment,
  finalizePicks,
} from './researchEngine'

// fetchAllYahooNews tests
describe('fetchAllYahooNews', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Dates are relative so the fixture cannot age past the freshness cutoff.
  const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toUTCString()

  it('parses RSS XML items from Yahoo feeds', async () => {
    const xml = `<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title><![CDATA[Stock Market Rally Continues]]></title>
        <link>https://finance.yahoo.com/news/stock-rally</link>
        <pubDate>${hoursAgo(2)}</pubDate>
        <description><![CDATA[Markets moved higher today.]]></description>
      </item>
      <item>
        <title><![CDATA[Tech Sector Leads Gains]]></title>
        <link>https://finance.yahoo.com/news/tech-gains</link>
        <pubDate>${hoursAgo(3)}</pubDate>
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

  it('drops articles older than the freshness window but keeps undated ones', async () => {
    const xml = `<rss><channel>
      <item><title>Fresh Headline</title><link>a</link><pubDate>${hoursAgo(5)}</pubDate></item>
      <item><title>Two Year Old Evergreen</title><link>b</link><pubDate>${hoursAgo(24 * 730)}</pubDate></item>
      <item><title>No Date Given</title><link>c</link></item>
    </channel></rss>`

    fetch.mockResolvedValue({ ok: true, text: async () => xml })

    const titles = (await fetchAllYahooNews()).map((a) => a.title)

    expect(titles).toContain('Fresh Headline')
    expect(titles).not.toContain('Two Year Old Evergreen')
    // A missing pubDate is not evidence of staleness, so it stays.
    expect(titles).toContain('No Date Given')
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

  it('keeps scores finite when board items are missing newer count fields', () => {
    const quoteMap = new Map([['OLD', { price: 25, changePercent: 1 }]])
    const legacyItem = makeItem({ ticker: 'OLD' })
    delete legacyItem.screenerMentions
    delete legacyItem.searchMentions

    const ranked = rankHighUpsideBoard([legacyItem], quoteMap)

    expect(Number.isFinite(ranked[0].archetypeScore)).toBe(true)
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

describe('postProcessCandidates', () => {
  const makeBoardItem = (ticker, overrides = {}) => ({
    ticker,
    sources: ['source-a', 'source-b'],
    themes: ['ai'],
    signalCount: 3,
    articleCount: 0,
    setupType: 'catalyst',
    archetypeScore: 12,
    price: 40,
    quoteVerified: true,
    quoteChangePercent: 1,
    priceBand: 'core-upside',
    repeatedAttention: true,
    pennyStockRisk: false,
    exceptionalPennySetup: false,
    brokenSetupRisk: false,
    mainstreamCrowdFavorite: false,
    convictionMentions: 2,
    contextMentions: 0,
    ...overrides,
  })

  it('filters recently picked tickers when fresh alternatives exist', () => {
    const parsed = [
      { ticker: 'IREN', conviction: 9, reason: 'Recently picked again' },
      { ticker: 'RKLB', conviction: 7, reason: 'Fresh catalyst' },
    ]
    const signalBoard = [
      makeBoardItem('IREN', { archetypeScore: 20 }),
      makeBoardItem('RKLB', { archetypeScore: 10 }),
    ]

    const picks = postProcessCandidates(parsed, signalBoard, new Map(), {
      recentPickedTickers: new Set(['IREN']),
    })

    expect(picks.map((p) => p.ticker)).toEqual(['RKLB'])
  })

  it('lets a strong technical setup outrank a weak one at equal conviction', () => {
    const parsed = [
      { ticker: 'WEAK', conviction: 8, reason: 'Chatter but bad chart' },
      { ticker: 'STRONG', conviction: 8, reason: 'Chatter and confirmed chart' },
    ]
    const signalBoard = [makeBoardItem('WEAK'), makeBoardItem('STRONG')]
    const technicals = new Map([
      ['WEAK', { analyzed: true, trend: 'downtrend', rsi: 80, macd: { histogram: -0.4 }, relativeVolume: 0.8 }],
      ['STRONG', { analyzed: true, trend: 'uptrend', rsi: 58, macd: { histogram: 0.3 }, relativeVolume: 1.6 }],
    ])

    const picks = postProcessCandidates(parsed, signalBoard, technicals)

    expect(picks[0].ticker).toBe('STRONG')
    expect(picks[0].techAdjustment).toBeGreaterThan(0)
    expect(picks.find((p) => p.ticker === 'WEAK').techAdjustment).toBeLessThan(0)
  })

  it('boosts picks flagged by proven sources and penalizes proven losers', () => {
    const stats = {
      bySource: {
        '@winner': { weightedWinRate: 70, total: 5 },
        '@loser': { weightedWinRate: 20, total: 4 },
        '@thin': { weightedWinRate: 90, total: 2 },
      },
    }

    expect(sourcePerformanceAdjustment(['@winner'], stats)).toBe(0.75)
    expect(sourcePerformanceAdjustment(['@loser'], stats)).toBe(-1.0)
    expect(sourcePerformanceAdjustment(['@thin'], stats)).toBe(0)
    expect(sourcePerformanceAdjustment(['@winner', '@loser'], stats)).toBe(-0.25)
    expect(sourcePerformanceAdjustment([], stats)).toBe(0)
    expect(sourcePerformanceAdjustment(['@winner'], null)).toBe(0)
  })

  it('attaches ATR-based stop and target when technicals include ATR', () => {
    const parsed = [{ ticker: 'RKLB', conviction: 8, reason: 'Catalyst' }]
    const signalBoard = [makeBoardItem('RKLB', { price: 40 })]
    const technicals = new Map([
      ['RKLB', { analyzed: true, trend: 'uptrend', rsi: 55, atr: 2, macd: { histogram: 0.1 }, relativeVolume: 1.1 }],
    ])

    const picks = postProcessCandidates(parsed, signalBoard, technicals)

    expect(picks[0].stopLoss).toBe(37)   // 40 - 1.5×2
    expect(picks[0].target).toBe(45)     // 40 + 2.5×2
  })

  it('applies setup win-rate adjustments only with enough samples', () => {
    expect(setupPerformanceAdjustment('catalyst', { bySetup: { catalyst: { weightedWinRate: 70, total: 6 } } })).toBe(1.5)
    expect(setupPerformanceAdjustment('squeeze', { bySetup: { squeeze: { weightedWinRate: 20, total: 8 } } })).toBe(-2.0)
    expect(setupPerformanceAdjustment('squeeze', { bySetup: { squeeze: { weightedWinRate: 20, total: 3 } } })).toBe(0)
    expect(setupPerformanceAdjustment('breakout', null)).toBe(0)
  })
})

describe('technicalAdjustment', () => {
  it('rewards confirmed uptrends and punishes broken charts', () => {
    const strong = technicalAdjustment({ trend: 'uptrend', rsi: 55, macd: { histogram: 0.2 }, relativeVolume: 1.7 })
    const weak = technicalAdjustment({ trend: 'downtrend', rsi: 80, macd: { histogram: -0.2 }, relativeVolume: 0.9 })

    expect(strong).toBeGreaterThan(2)
    expect(weak).toBeLessThan(-3)
    expect(technicalAdjustment(null)).toBe(0)
  })
})

describe('finalizePicks', () => {
  const basePick = (ticker, overrides = {}) => ({
    ticker,
    conviction: 7,
    archetypeScore: 10,
    ...overrides,
  })

  it('promotes verified, not-priced-in catalysts over unverified picks', () => {
    const picks = [
      basePick('HYPE', { conviction: 9, catalystVerified: false }),
      basePick('REAL', { conviction: 8, catalystVerified: true, catalystPricedIn: false, catalystConfidence: 8 }),
    ]

    const finalized = finalizePicks(picks)

    expect(finalized[0].ticker).toBe('REAL')
    expect(finalized[0].finalScore).toBeGreaterThan(finalized[1].finalScore)
  })

  it('drops priced-in picks with extreme contrarian risk when alternatives exist', () => {
    const picks = [
      basePick('LATE', { conviction: 9, catalystVerified: true, catalystPricedIn: true, riskScore: 9 }),
      basePick('OK', { conviction: 7, catalystVerified: true, catalystPricedIn: false, riskScore: 4 }),
    ]

    const finalized = finalizePicks(picks)

    expect(finalized.map((p) => p.ticker)).toEqual(['OK'])
  })

  it('keeps dangerous picks when nothing else survives', () => {
    const picks = [
      basePick('ONLY', { catalystPricedIn: true, riskScore: 9 }),
    ]

    expect(finalizePicks(picks).map((p) => p.ticker)).toEqual(['ONLY'])
    expect(finalizePicks([])).toEqual([])
  })

  it('penalizes high contrarian risk in the final order', () => {
    const picks = [
      basePick('RISKY', { conviction: 8, riskScore: 9 }),
      basePick('CALM', { conviction: 8, riskScore: 2 }),
    ]

    const finalized = finalizePicks(picks)

    expect(finalized[0].ticker).toBe('CALM')
  })
})
