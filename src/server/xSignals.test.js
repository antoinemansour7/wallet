import { describe, expect, it } from 'vitest'
import {
  extractTickersFromText,
  extractThemesFromText,
  deriveAdaptiveSeed,
  buildAdaptiveQueries,
  scoreSignal,
} from './xSignals'
import { rankHighUpsideBoard, summarizeSignalsForPrompt } from './researchEngine'

describe('extractTickersFromText', () => {
  it('extracts cashtags and uppercase ticker mentions', () => {
    expect(extractTickersFromText('Watching $RXRX and IONQ after the breakout')).toEqual(['RXRX', 'IONQ'])
  })

  it('filters common non-ticker finance words', () => {
    expect(extractTickersFromText('FDA says CPI is cooling while GDP holds')).toEqual([])
  })
})

describe('extractThemesFromText', () => {
  it('detects multiple finance themes from a text blob', () => {
    expect(extractThemesFromText('AI datacenter demand and FDA phase 3 biotech trial catalyst')).toEqual(
      expect.arrayContaining(['ai', 'biotech']),
    )
  })

  it('detects space and defense themes', () => {
    expect(extractThemesFromText('Satellite launch demand and defense drone contracts are heating up')).toEqual(
      expect.arrayContaining(['space', 'defense']),
    )
  })
})

describe('deriveAdaptiveSeed and buildAdaptiveQueries', () => {
  it('builds adaptive queries from article and signal context', () => {
    const seed = deriveAdaptiveSeed({
      articles: [
        { title: 'RXRX jumps on phase 2 biotech trial update', description: 'FDA momentum building for RXRX' },
      ],
      baseSignals: [
        {
          text: '$RXRX sees unusual volume and short interest build',
          tickers: ['RXRX'],
          themes: ['biotech', 'squeeze'],
        },
      ],
    })

    expect(seed.topThemes).toEqual(expect.arrayContaining(['biotech', 'squeeze']))
    expect(seed.topTickers).toContain('RXRX')

    const queries = buildAdaptiveQueries(seed)
    expect(queries.some((query) => query.id === 'theme:biotech')).toBe(true)
    expect(queries.length).toBeLessThanOrEqual(10)
  })

  it('does not let mega-cap chatter dominate adaptive ticker searches', () => {
    const seed = deriveAdaptiveSeed({
      baseSignals: [
        {
          text: '$TSLA trend continuation with heavy chatter',
          tickers: ['TSLA'],
          themes: ['ai'],
          sourceRole: 'conviction',
        },
        {
          text: '$RKLB breakout with unusual volume',
          tickers: ['RKLB'],
          themes: ['space', 'breakout'],
          sourceRole: 'conviction',
        },
        {
          text: 'Context on RKLB contracts and demand',
          tickers: ['RKLB'],
          themes: ['space'],
          sourceRole: 'context',
        },
      ],
    })

    expect(seed.topTickers).toContain('RKLB')
    expect(seed.topTickers).not.toContain('TSLA')
  })
})

describe('scoreSignal', () => {
  it('scores curated catalyst signals above generic search chatter', () => {
    const curated = scoreSignal({
      sourceType: 'account',
      sourceLabels: ['@unusualwhales'],
      sourceWeight: 1.35,
      tickers: ['RXRX'],
      themes: ['biotech', 'squeeze'],
      text: '$RXRX unusual volume into FDA catalyst',
      publicMetrics: { like_count: 40, retweet_count: 8, reply_count: 2, quote_count: 1 },
    })

    const generic = scoreSignal({
      sourceType: 'search',
      sourceLabels: ['Small-cap catalysts'],
      sourceWeight: 0.95,
      tickers: [],
      themes: ['macro'],
      text: 'market feels interesting today',
      publicMetrics: { like_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0 },
    })

    expect(curated).toBeGreaterThan(generic)
  })

  it('treats context-only sources as weaker than conviction sources', () => {
    const conviction = scoreSignal({
      sourceType: 'account',
      sourceRole: 'conviction',
      sourceLabels: ['@traderlion'],
      sourceWeight: 1.1,
      tickers: ['RKLB'],
      themes: ['breakout'],
      text: 'RKLB breakout with unusual volume',
      publicMetrics: { like_count: 20, retweet_count: 3, reply_count: 1, quote_count: 0 },
    })

    const context = scoreSignal({
      sourceType: 'account',
      sourceRole: 'context',
      sourceLabels: ['@aleabitoreddit'],
      sourceWeight: 1.02,
      tickers: ['RKLB'],
      themes: ['breakout'],
      text: 'Good context on RKLB demand and supply',
      publicMetrics: { like_count: 20, retweet_count: 3, reply_count: 1, quote_count: 0 },
    })

    expect(conviction).toBeGreaterThan(context)
  })
})

describe('summarizeSignalsForPrompt', () => {
  it('builds a ticker board and raw signal text for Claude', () => {
    const { signalBoard, boardText, signalText } = summarizeSignalsForPrompt([
      {
        score: 7.8,
        sourceType: 'account',
        sourceLabels: ['@unusualwhales'],
        tickers: ['RXRX'],
        themes: ['biotech', 'squeeze'],
        username: 'unusualwhales',
        text: '$RXRX unusual flow ahead of FDA catalyst',
      },
      {
        score: 6.5,
        sourceType: 'search',
        sourceLabels: ['Biotech momentum'],
        tickers: ['RXRX'],
        themes: ['biotech'],
        username: 'smallcaptrader',
        text: 'RXRX setting up into trial readout',
      },
    ], [
      { title: 'RXRX rises after trial update', description: 'Biotech traders watch next FDA milestone' },
    ])

    expect(signalBoard[0].ticker).toBe('RXRX')
    expect(boardText).toContain('RXRX')
    expect(signalText).toContain('@unusualwhales')
  })

  it('ranks repeated X signals ahead of article-only coverage', () => {
    const { signalBoard } = summarizeSignalsForPrompt([
      {
        score: 7.4,
        sourceType: 'account',
        sourceLabels: ['@unusualwhales'],
        tickers: ['RXRX'],
        themes: ['biotech'],
        username: 'unusualwhales',
        text: '$RXRX seeing unusual interest into a catalyst',
      },
      {
        score: 6.8,
        sourceType: 'search',
        sourceLabels: ['Biotech momentum'],
        tickers: ['RXRX'],
        themes: ['biotech'],
        username: 'smallcaptrader',
        text: 'RXRX momentum building again',
      },
      {
        score: 5.9,
        sourceType: 'account',
        sourceLabels: ['@StockMKTNewz'],
        tickers: ['IONQ'],
        themes: ['ai'],
        username: 'StockMKTNewz',
        text: 'IONQ mentioned once on the timeline',
      },
    ], [
      { title: 'IONQ appears in one news article', description: 'News desk coverage for IONQ' },
      { title: 'IONQ appears in second news article', description: 'Another IONQ article' },
      { title: 'IONQ appears in third news article', description: 'More IONQ coverage' },
    ])

    expect(signalBoard[0].ticker).toBe('RXRX')
  })
})

describe('rankHighUpsideBoard', () => {
  it('penalizes known penny-stock candidates', () => {
    const ranked = rankHighUpsideBoard([
      {
        ticker: 'ABCD',
        signalCount: 3,
        articleCount: 0,
        maxScore: 7.2,
        sources: ['@trader1', '@trader2'],
        themes: ['squeeze'],
        snippets: ['ABCD squeeze setup'],
        squeezeSignals: 2,
        volumeSignals: 2,
        breakoutSignals: 1,
        catalystSignals: 1,
        negativeSignals: 0,
        accountMentions: 2,
        convictionMentions: 2,
        contextMentions: 0,
        searchMentions: 1,
      },
      {
        ticker: 'RKLB',
        signalCount: 3,
        articleCount: 0,
        maxScore: 7.2,
        sources: ['@trader1', '@trader2'],
        themes: ['breakout'],
        snippets: ['RKLB breakout setup'],
        squeezeSignals: 1,
        volumeSignals: 2,
        breakoutSignals: 2,
        catalystSignals: 1,
        negativeSignals: 0,
        accountMentions: 2,
        convictionMentions: 2,
        contextMentions: 0,
        searchMentions: 1,
      },
    ], new Map([
      ['ABCD', { price: 2.4 }],
      ['RKLB', { price: 24.5 }],
    ]))

    expect(ranked[0].ticker).toBe('RKLB')
    expect(ranked.find((item) => item.ticker === 'ABCD').pennyStockRisk).toBe(true)
  })

  it('allows an exceptional penny setup to be marked as override-eligible', () => {
    const ranked = rankHighUpsideBoard([
      {
        ticker: 'ABCD',
        signalCount: 5,
        articleCount: 0,
        maxScore: 8.6,
        sources: ['@trader1', '@trader2', '@trader3'],
        themes: ['squeeze', 'breakout'],
        snippets: ['ABCD seeing extreme squeeze behavior'],
        squeezeSignals: 2,
        volumeSignals: 2,
        breakoutSignals: 2,
        catalystSignals: 2,
        negativeSignals: 0,
        accountMentions: 3,
        convictionMentions: 3,
        contextMentions: 0,
        searchMentions: 2,
      },
    ], new Map([
      ['ABCD', { price: 3.8 }],
    ]))

    expect(ranked[0].pennyStockRisk).toBe(true)
    expect(ranked[0].exceptionalPennySetup).toBe(true)
  })

  it('flags broken unwind setups and unverified tokens as low quality', () => {
    const ranked = rankHighUpsideBoard([
      {
        ticker: 'CAR',
        signalCount: 4,
        articleCount: 0,
        maxScore: 7.9,
        sources: ['@trader1', '@trader2'],
        themes: ['squeeze'],
        snippets: ['CAR post-squeeze collapse and unwind continues'],
        squeezeSignals: 2,
        volumeSignals: 1,
        breakoutSignals: 0,
        catalystSignals: 0,
        negativeSignals: 3,
        accountMentions: 2,
        convictionMentions: 2,
        contextMentions: 0,
        searchMentions: 1,
      },
      {
        ticker: 'NATO',
        signalCount: 3,
        articleCount: 0,
        maxScore: 7.1,
        sources: ['@macro1', '@macro2'],
        themes: ['defense'],
        snippets: ['NATO agreement chatter'],
        squeezeSignals: 0,
        volumeSignals: 0,
        breakoutSignals: 0,
        catalystSignals: 2,
        negativeSignals: 0,
        accountMentions: 0,
        convictionMentions: 0,
        contextMentions: 3,
        searchMentions: 0,
      },
    ], new Map([
      ['CAR', { price: 224, changePercent: -42 }],
    ]))

    expect(ranked.find((item) => item.ticker === 'CAR').brokenSetupRisk).toBe(true)
    expect(ranked.find((item) => item.ticker === 'NATO').quoteVerified).toBe(false)
  })

  // The mega-cap flag this used to assert is gone. The ranking audit removed
  // its scoring effect ("no blacklist of large companies") and nothing read it
  // afterwards, so the field was carrying an intent the engine no longer has.
})
