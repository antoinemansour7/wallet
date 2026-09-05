import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  rankHighUpsideBoard,
  fetchAllYahooNews,
  CATALYST_REGEX,
  postProcessCandidates,
  technicalAdjustment,
  convictionTechnicalDisagreement,
  computeCoverageAcceleration,
  setupPerformanceAdjustment,
  sourcePerformanceAdjustment,
  finalizePicks,
  buildMacroContextBlock,
  prepareResearchSignals,
  summarizeSignalsForPrompt,
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

  it('does not exclude a stronger candidate because it is a mega-cap', () => {
    const quoteMap = new Map([
      ['NVDA', { price: 150, changePercent: 1 }],
      ['RKLB', { price: 25, changePercent: 1 }],
    ])
    const board = [
      makeItem({ ticker: 'NVDA', signalCount: 5, sources: ['a', 'b', 'c'] }),
      makeItem({ ticker: 'RKLB', signalCount: 3, sources: ['a', 'b'] }),
    ]

    const ranked = rankHighUpsideBoard(board, quoteMap)

    // Ranked on evidence alone. The mega-cap flag that used to be asserted here
    // is gone: it scored nothing after the ranking audit and nothing read it.
    expect(ranked[0].ticker).toBe('NVDA')
    expect(ranked[0]).not.toHaveProperty('mainstreamCrowdFavorite')
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

  it('does not add an unsupported sector preference', () => {
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
    expect(techScore).toBe(noTechScore)
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

  // Corroborated, so the acceleration bonus is actually reachable — a single
  // publisher spiking is deliberately not enough. See the gate test below.
  const corroborated = (overrides) => makeItem({
    sources: ['@unusualwhales', '@optionshawk'],
    convictionMentions: 2,
    ...overrides,
  })

  it('rewards a corroborated ticker whose coverage is accelerating over its own history', () => {
    const quoteMap = new Map([['ACCEL', { price: 30, changePercent: 0 }], ['FLAT', { price: 30, changePercent: 0 }]])
    const board = [corroborated({ ticker: 'ACCEL', signalCount: 9 }), corroborated({ ticker: 'FLAT', signalCount: 9 })]
    const coverageHistory = new Map([['ACCEL', [1, 2, 2]], ['FLAT', [8, 9, 9]]])

    const ranked = rankHighUpsideBoard(board, quoteMap, new Map(), coverageHistory)
    const get = (t) => ranked.find((r) => r.ticker === t)

    expect(get('ACCEL').coverageAcceleration).toBe('accelerating')
    expect(get('FLAT').coverageAcceleration).toBe('steady')
    expect(get('ACCEL').archetypeScore).toBeGreaterThan(get('FLAT').archetypeScore)
  })

  it('measures acceleration on the real mention count, not the score-capped one', () => {
    // Every scoring field is clamped to 4 so raw volume cannot dominate. Reading
    // the clamped value made a jump from 2 to 9 look like 2 to 4 — a 1.5x ratio,
    // reported as "steady". Acceleration above four mentions was undetectable.
    const quoteMap = new Map([['SPIKE', { price: 30, changePercent: 0 }]])
    const board = [corroborated({ ticker: 'SPIKE', signalCount: 9 })]

    const ranked = rankHighUpsideBoard(board, quoteMap, new Map(), new Map([['SPIKE', [2, 2, 2]]]))

    expect(ranked[0].coverageToday).toBe(9)
    expect(ranked[0].coverageAcceleration).toBe('accelerating')
  })

  it('will not let a mention spike carry a ticker nobody corroborated', () => {
    // One publisher posting nine times is what a pump looks like. The status is
    // still reported — it is a true fact about coverage — but it earns no score.
    const quoteMap = new Map([['LONE', { price: 30, changePercent: 0 }], ['QUIET', { price: 30, changePercent: 0 }]])
    const board = [
      makeItem({ ticker: 'LONE', signalCount: 9, sources: ['@onlyguy'], convictionMentions: 1 }),
      makeItem({ ticker: 'QUIET', signalCount: 9, sources: ['@onlyguy'], convictionMentions: 1 }),
    ]
    const coverageHistory = new Map([['LONE', [1, 1, 2]], ['QUIET', [8, 9, 9]]])

    const ranked = rankHighUpsideBoard(board, quoteMap, new Map(), coverageHistory)
    const get = (t) => ranked.find((r) => r.ticker === t)

    expect(get('LONE').coverageAcceleration).toBe('accelerating')
    expect(get('QUIET').coverageAcceleration).toBe('steady')
    expect(get('LONE').archetypeScore).toBe(get('QUIET').archetypeScore)
  })

  it('penalizes a ticker whose coverage is falling off, and never adjusts a brand-new one', () => {
    const quoteMap = new Map([['FADING', { price: 30, changePercent: 0 }], ['NEWCOMER', { price: 30, changePercent: 0 }]])
    const board = [makeItem({ ticker: 'FADING', signalCount: 3 }), makeItem({ ticker: 'NEWCOMER', signalCount: 3 })]
    const coverageHistory = new Map([['FADING', [10, 12, 9]]]) // NEWCOMER has no entry at all

    const ranked = rankHighUpsideBoard(board, quoteMap, new Map(), coverageHistory)
    const get = (t) => ranked.find((r) => r.ticker === t)

    expect(get('FADING').coverageAcceleration).toBe('decelerating')
    expect(get('NEWCOMER').coverageAcceleration).toBe('new')
    // The fade penalty is deliberately not gated on corroboration: coverage
    // draining out of a name is worth knowing either way.
    expect(get('NEWCOMER').archetypeScore).toBeGreaterThan(get('FADING').archetypeScore)
  })

  it('defaults to an empty coverage history, leaving every ticker "new" and unadjusted', () => {
    const board = [makeItem({ ticker: 'ANY', signalCount: 5 })]
    const ranked = rankHighUpsideBoard(board)
    expect(ranked[0].coverageAcceleration).toBe('new')
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
    convictionMentions: 2,
    contextMentions: 0,
    ...overrides,
  })

  it('keeps a stronger recent pick ahead of weaker fresh alternatives', () => {
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

    expect(picks.map((p) => p.ticker)).toEqual(['IREN', 'RKLB'])
    expect(picks[0].recentRepeat).toBe(true)
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

  it('does not learn from small legacy win-rate samples', () => {
    const stats = { bySource: { '@winner': { weightedWinRate: 100, total: 5 } } }
    expect(sourcePerformanceAdjustment(['@winner'], stats)).toBe(0)
    expect(sourcePerformanceAdjustment([], stats)).toBe(0)
  })

  it('uses bounded, non-duplicated feedback from comparable net returns', () => {
    const group = { total: 30, distinctDates: 15, avgNetReturn: 4, avgExcessReturn: 3, lowerBound: 1, upperBound: 5 }
    const stats = { learning: { bySource: { good: group }, bySetup: { catalyst: group } } }
    expect(sourcePerformanceAdjustment(['good', 'good'], stats)).toBe(0.5)
    expect(setupPerformanceAdjustment('catalyst', stats)).toBe(1)
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

  it('carries the model/chart disagreement onto the pick', () => {
    const parsed = [{ ticker: 'RKLB', conviction: 9, reason: 'Confident despite the chart' }]
    const signalBoard = [makeBoardItem('RKLB')]
    const technicals = new Map([
      ['RKLB', { analyzed: true, trend: 'downtrend', rsi: 40, macd: { histogram: -0.4 }, relativeVolume: 0.8 }],
    ])

    const picks = postProcessCandidates(parsed, signalBoard, technicals)

    expect(picks[0].technicalAgreement).toBe('conflict')
    expect(picks[0].disagreementNote).toMatch(/trending down/i)
  })

  it('reports the disagreement without letting it move the score', () => {
    // The whole point of the callout is that the conflict reaches the reader
    // instead of being absorbed into one number. technicalAdjustment already
    // prices the chart; the disagreement must add nothing on top of it, or the
    // card would be showing something the ranking had silently double-counted.
    const parsed = [{ ticker: 'RKLB', conviction: 9, reason: 'Confident despite the chart' }]
    const signalBoard = [makeBoardItem('RKLB', { archetypeScore: 12 })]
    const technicals = new Map([
      ['RKLB', { analyzed: true, trend: 'downtrend', rsi: 40, macd: { histogram: -0.4 }, relativeVolume: 0.8 }],
    ])

    const [pick] = postProcessCandidates(parsed, signalBoard, technicals)

    expect(pick.technicalAgreement).toBe('conflict')
    expect(pick.techAdjustment).toBe(-3.1)
    // conviction 9 × 1.5 + archetype 12 + techAdjustment −3.1, and nothing else.
    expect(pick.compositeScore).toBe(22.4)
    // The final re-rank leaves it alone too — no catalyst or risk input here,
    // so finalScore must equal the composite it started from.
    expect(finalizePicks([pick])[0].finalScore).toBe(22.4)
  })

  it('records an unclear reading rather than guessing when a ticker has no chart', () => {
    const parsed = [{ ticker: 'RKLB', conviction: 9, reason: 'No technicals available' }]
    const picks = postProcessCandidates(parsed, [makeBoardItem('RKLB')], new Map())

    expect(picks[0].technicalAgreement).toBe('unclear')
    expect(picks[0].disagreementNote).toBe('')
  })

  it('ignores legacy win-rate adjustments regardless of win percentage', () => {
    expect(setupPerformanceAdjustment('catalyst', { bySetup: { catalyst: { weightedWinRate: 70, total: 6 } } })).toBe(0)
    expect(setupPerformanceAdjustment('squeeze', { bySetup: { squeeze: { weightedWinRate: 20, total: 8 } } })).toBe(0)
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

describe('convictionTechnicalDisagreement', () => {
  it('flags a confident pick whose chart is already falling', () => {
    const result = convictionTechnicalDisagreement({
      conviction: 8,
      tech: { analyzed: true, trend: 'downtrend', rsi: 40, price: 42 },
    })
    expect(result.status).toBe('conflict')
    expect(result.note).toMatch(/trending down/i)
  })

  it('flags a confident pick that has already run up hard, citing the actual RSI', () => {
    // Precision is the point: the note names the number, not just the word
    // "overbought" — matching the plain-language convention the rest of the
    // research prompt already enforces.
    const result = convictionTechnicalDisagreement({
      conviction: 9,
      tech: { analyzed: true, trend: 'overbought-uptrend', rsi: 82, price: 42 },
    })
    expect(result.status).toBe('conflict')
    expect(result.note).toContain('82')
  })

  it('flags a low-conviction pick whose chart actually looks strong', () => {
    // The disagreement runs both directions — a chart in a confirmed uptrend
    // the model barely believes in is worth surfacing too.
    const result = convictionTechnicalDisagreement({
      conviction: 3,
      tech: { analyzed: true, trend: 'uptrend', rsi: 55, price: 42 },
    })
    expect(result.status).toBe('conflict')
    expect(result.note).toMatch(/uptrend/i)
  })

  it('agrees when a confident pick has a confirmed, unstretched uptrend', () => {
    const result = convictionTechnicalDisagreement({
      conviction: 8,
      tech: { analyzed: true, trend: 'uptrend', rsi: 58, price: 42 },
    })
    expect(result.status).toBe('agree')
    expect(result.note).toBe('')
  })

  it('agrees when a low-conviction pick has a genuinely weak chart', () => {
    const result = convictionTechnicalDisagreement({
      conviction: 3,
      tech: { analyzed: true, trend: 'downtrend', rsi: 35, price: 42 },
    })
    expect(result.status).toBe('agree')
  })

  it('stays neutral in the middle range — moderate conviction disagreeing with nothing in particular', () => {
    const result = convictionTechnicalDisagreement({
      conviction: 6,
      tech: { analyzed: true, trend: 'consolidating', rsi: 50, price: 42 },
    })
    expect(result.status).toBe('agree')
  })

  it('returns unclear rather than guessing when there is no technical read for this ticker', () => {
    expect(convictionTechnicalDisagreement({ conviction: 9, tech: null }).status).toBe('unclear')
    expect(convictionTechnicalDisagreement({ conviction: 9, tech: { analyzed: false } }).status).toBe('unclear')
  })
})

describe('computeCoverageAcceleration', () => {
  it('flags a ticker whose coverage has roughly doubled over its recent average', () => {
    const result = computeCoverageAcceleration({ todayCount: 8, priorCounts: [3, 4, 5] })
    expect(result.status).toBe('accelerating')
    expect(result.ratio).toBeCloseTo(2, 1)
  })

  it('flags a ticker whose coverage has fallen off, not just gone quiet', () => {
    const result = computeCoverageAcceleration({ todayCount: 1, priorCounts: [6, 8, 4] })
    expect(result.status).toBe('decelerating')
  })

  it('calls it steady when coverage today is in line with its recent history', () => {
    const result = computeCoverageAcceleration({ todayCount: 5, priorCounts: [4, 5, 6] })
    expect(result.status).toBe('steady')
  })

  it('treats a ticker going from zero coverage to any coverage as accelerating, not a divide-by-zero', () => {
    const result = computeCoverageAcceleration({ todayCount: 3, priorCounts: [0, 0, 0] })
    expect(result.status).toBe('accelerating')
  })

  it('returns new for a ticker with no prior history at all, distinct from steady', () => {
    // "10 mentions today, none of the last 3 days" is not the same fact as
    // "10 mentions today, roughly like every day this week" — collapsing them
    // into the same status would erase the thing this feature exists to show.
    const result = computeCoverageAcceleration({ todayCount: 10, priorCounts: [] })
    expect(result.status).toBe('new')
  })

  it('is not fooled by a single noisy day — it reads the average of the window, not day-over-day', () => {
    const result = computeCoverageAcceleration({ todayCount: 5, priorCounts: [1, 9, 5] })
    expect(result.status).toBe('steady')
  })

  it('returns null for an invalid count rather than guessing', () => {
    expect(computeCoverageAcceleration({ todayCount: null, priorCounts: [3, 4] })).toBeNull()
    expect(computeCoverageAcceleration({ todayCount: -1, priorCounts: [3, 4] })).toBeNull()
    expect(computeCoverageAcceleration({})).toBeNull()
  })

  it('ignores non-finite entries in the prior window rather than letting them corrupt the average', () => {
    const result = computeCoverageAcceleration({ todayCount: 5, priorCounts: [4, null, 6, undefined] })
    expect(result.status).toBe('steady')
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
      basePick('REAL', { conviction: 8, catalystVerified: true, catalystInWindow: true, catalystPricedIn: false, catalystConfidence: 8 }),
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

  it('abstains when nothing survives the risk gate', () => {
    const picks = [
      basePick('ONLY', { catalystPricedIn: true, riskScore: 9 }),
    ]

    expect(finalizePicks(picks).map((p) => p.ticker)).toEqual([])
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

// The loose original matched bare topic words, so nearly every financial
// headline classified as a catalyst — flooding the board with one setup type
// and mislabelling the setup-performance learning loop.
describe('CATALYST_REGEX', () => {
  it.each([
    'Rocket Lab awarded a $515 million contract from the Space Force',
    'Company reports Q3 earnings on Tuesday before the bell',
    'FDA approval granted for the lead candidate',
    'Beats estimates by 12 cents, raises full-year guidance',
    'Announces definitive agreement to be acquired at $42/share',
    'PDUFA date set for November',
    'Phase 3 trial met its primary endpoint',
  ])('matches the concrete event in: %s', (text) => {
    expect(CATALYST_REGEX.test(text)).toBe(true)
  })

  it.each([
    'Is Costco Stock Underperforming the Dow?',
    'Best Of The 2026 Small Cap Winners: Monday 31st August 2026',
    'Analysts discuss the upcoming earnings season outlook',
    'The company launched a redesigned website last week',
    'A $2 Billion Reason to Buy UPS Stock',
    'Contract manufacturers are seeing margin pressure',
  ])('does not fire on generic vocabulary in: %s', (text) => {
    expect(CATALYST_REGEX.test(text)).toBe(false)
  })
})

describe('buildMacroContextBlock', () => {
  const post = (username, minutesAgo, text) => ({
    username,
    text,
    sourceRole: 'context',
    sourceType: 'account',
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  })

  it('returns nothing when there are no context-role account posts', () => {
    expect(buildMacroContextBlock([])).toBe('')
    expect(buildMacroContextBlock([
      { ...post('a', 5, 'x'), sourceRole: 'conviction' },
      { ...post('b', 5, 'x'), sourceType: 'search' },
    ])).toBe('')
  })

  // The whole reason for round-robin selection: one desk posts every ~18
  // minutes and the others a few times a day, so newest-first handed the loud
  // desk 11 of 14 slots and dropped the considered macro reads entirely.
  it('does not let the highest-frequency desk crowd out the others', () => {
    const signals = [
      ...Array.from({ length: 30 }, (_, i) => post('loud', i * 18, `loud ${i}`)),
      ...Array.from({ length: 5 }, (_, i) => post('slow', i * 600, `slow ${i}`)),
    ]

    const block = buildMacroContextBlock(signals)
    const slots = (name) => block.split("[@" + name + ",").length - 1

    expect(slots('slow')).toBe(5)
    expect(slots('loud')).toBeLessThanOrEqual(9)
    expect(slots('loud') + slots('slow')).toBe(14)
  })

  it('keeps a slow desk represented even when every rival post is newer', () => {
    const signals = [
      ...Array.from({ length: 20 }, (_, i) => post('loud', i, `loud ${i}`)),
      post('slow', 4000, 'the only macro read that matters'),
    ]
    expect(buildMacroContextBlock(signals)).toContain('the only macro read that matters')
  })

  it('drops self-promotion and TV scheduling but keeps real macro', () => {
    const block = buildMacroContextBlock([
      post('desk', 1, 'The Labor Day sale has begun. Get 20% off on all site.'),
      post('desk', 2, 'Looking forward to joining @SchwabNetwork around 10:20am ET'),
      post('desk', 3, 'Our live trading show is live now! Join to see how traders use it'),
      post('desk', 4, '10-year treasury yield hits a new 52 week high'),
    ])
    expect(block).toContain('10-year treasury yield')
    expect(block).not.toContain('20% off')
    expect(block).not.toContain('Looking forward to joining')
    expect(block).not.toContain('is live now')
  })

  // Narrow by design: a discount or a scheduled Fed speaker is real macro, and
  // an over-eager filter here silently deletes the signal it exists to carry.
  it('does not mistake genuine macro for housekeeping', () => {
    const block = buildMacroContextBlock([
      post('desk', 1, 'Retailers are discounting aggressively into the holiday, per WSJ'),
      post('desk', 2, 'Powell speaks Thursday; market is pricing a hold'),
    ])
    expect(block).toContain('discounting aggressively')
    expect(block).toContain('Powell speaks Thursday')
  })

  it('labels each post with its author and age', () => {
    const block = buildMacroContextBlock([post('macrodesk', 90, 'yields backing up')])
    expect(block).toMatch(/\[@macrodesk, 2h ago\] yields backing up/)
    expect(block).toContain('regime, not picks')
  })

  it('renders days rather than hours once a post is over a day old', () => {
    const block = buildMacroContextBlock([post('macrodesk', 3 * 24 * 60, 'hawkish speech')])
    expect(block).toMatch(/\[@macrodesk, 3d ago\]/)
  })
})


describe('research evidence and output integrity', () => {
  const signal = (overrides = {}) => ({ id: 'a', ticker: 'ACME', tickers: ['ACME'], text: '$ACME wins a contract', username: 'desk', sourceType: 'account', sourceRole: 'conviction', sourceLabels: ['@desk'], score: 6, ...overrides })

  it('deduplicates repeated discovery URLs per ticker without losing other tickers', () => {
    const signals = [
      signal({ id: 'query1', sourceLabels: ['exa-discovery'], url: 'https://news.example/story?utm_source=a', tickers: ['acme', 'OTHER'] }),
      signal({ id: 'query2', sourceLabels: ['exa-discovery'], url: 'https://news.example/story?utm_source=b', tickers: ['ACME'] }),
    ]
    const prepared = prepareResearchSignals(signals)
    expect(prepared).toHaveLength(1)
    expect(prepared[0].tickers).toEqual(['ACME', 'OTHER'])
  })

  it('does not count multiple search labels or unlimited posts as independent corroboration', () => {
    const repeated = Array.from({ length: 100 }, (_, i) => signal({ id: `${i}`, text: `$ACME contract update ${i}`, sourceLabels: [`query${i}`] }))
    const { signalBoard } = summarizeSignalsForPrompt(repeated, [])
    expect(signalBoard[0].signalCount).toBe(2)
    expect(signalBoard[0].independentSources).toHaveLength(1)
    expect(signalBoard[0].repeatedAttention).toBe(false)
  })

  it('retains both independent publishers and discards stale or future signals', () => {
    const signals = [signal(), signal({ id: 'b', username: 'another' }),
      signal({ id: 'stale', createdAt: new Date(Date.now() - 72 * 3600000).toISOString() }),
      signal({ id: 'future', createdAt: new Date(Date.now() + 3600000).toISOString() })]
    const { signalBoard } = summarizeSignalsForPrompt(signals, [])
    expect(signalBoard[0].signalCount).toBe(2)
    expect(signalBoard[0].repeatedAttention).toBe(true)
  })

  it.each([null, '', 0, -1, Infinity, NaN, true])('rejects invalid quote price %s', (price) => {
    const [item] = rankHighUpsideBoard([{ ticker: 'BAD' }], new Map([['BAD', { price }]]))
    expect(item.quoteVerified).toBe(false)
  })

  it('rejects stale cached quotes and retains missing daily changes as missing', () => {
    const [stale] = rankHighUpsideBoard([{ ticker: 'A' }], new Map([['A', { price: 20, cacheStatus: 'stale' }]]))
    expect(stale.quoteVerified).toBe(false)
    const [valid] = rankHighUpsideBoard([{ ticker: 'A' }], new Map([['A', { price: 20, changePercent: null }]]))
    expect(valid.quoteChangePercent).toBeNull()
  })

  const board = [{ ticker: 'ACME', sources: ['@desk'], price: 40, quoteVerified: true, convictionMentions: 1, archetypeScore: 10 }]
  it('validates model output, deduplicates tickers, and prevents score injection', () => {
    const picks = postProcessCandidates([null, { ticker: 'UNKNOWN', conviction: 10 }, { ticker: 'ACME', conviction: 100 },
      { ticker: ' acme ', conviction: 7, techAdjustment: 9999, compositeScore: 9999, riskScore: 1 },
      { ticker: 'ACME', conviction: 9 }], board)
    expect(picks).toHaveLength(1)
    expect(picks[0].ticker).toBe('ACME')
    expect(picks[0].compositeScore).toBe(20.5)
    expect(picks[0].riskScore).toBeUndefined()
  })

  it('never restores broken or context-only candidates to fill the list', () => {
    const parsed = [{ ticker: 'ACME', conviction: 9 }]
    expect(postProcessCandidates(parsed, [{ ...board[0], brokenSetupRisk: true }])).toEqual([])
    expect(postProcessCandidates(parsed, [{ ...board[0], convictionMentions: 0, contextMentions: 3 }])).toEqual([])
  })

  it('does not publish negative stop prices for extreme ATR', () => {
    const picks = postProcessCandidates([{ ticker: 'ACME', conviction: 7 }], board, new Map([['ACME', { analyzed: true, atr: 40 }]]))
    expect(picks[0].stopLoss).toBeNull()
    expect(picks[0].target).toBeNull()
  })

  it('preserves technical and learned contributions through final ranking', () => {
    const picks = finalizePicks([{ ticker: 'A', conviction: 7, compositeScore: 25, techAdjustment: 3 }, { ticker: 'B', conviction: 9, compositeScore: 20 }])
    expect(picks.map((p) => p.ticker)).toEqual(['A', 'B'])
    expect(picks[0].finalScore).toBe(25)
  })

  it('does not reward missing risk scores or distant catalysts', () => {
    const picks = finalizePicks([{ ticker: 'A', conviction: 7, compositeScore: 20, riskScore: null, catalystVerified: true, catalystInWindow: false }])
    expect(picks[0].finalScore).toBe(20)
  })
})
