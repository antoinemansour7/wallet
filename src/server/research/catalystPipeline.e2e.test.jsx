import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => {
  const values = new Map()
  const lists = new Map()
  const records = new Map()
  const publications = []
  const modelCalls = []
  const exaCalls = []
  const tickers = ['ABC', 'HYPE', 'NODATE', 'EXAFAIL']
  const clone = (value) => value === undefined ? undefined : structuredClone(value)
  const redis = {
    get: vi.fn(async (key) => clone(values.get(key))),
    set: vi.fn(async (key, value, options = {}) => {
      if (options.nx && values.has(key)) return null
      values.set(key, clone(value)); return 'OK'
    }),
    eval: vi.fn(async (_script, [key], [token]) => { if (values.get(key) === token) values.delete(key); return 1 }),
    lrem: vi.fn(async (key, _count, value) => {
      lists.set(key, (lists.get(key) || []).filter((item) => item !== value)); return 1
    }),
    lpush: vi.fn(async (key, value) => { lists.set(key, [clone(value), ...(lists.get(key) || [])]); return lists.get(key).length }),
    ltrim: vi.fn(async (key, start, stop) => { lists.set(key, (lists.get(key) || []).slice(start, stop + 1)); return 'OK' }),
    lrange: vi.fn(async (key, start, stop) => clone((lists.get(key) || []).slice(start, stop < 0 ? undefined : stop + 1))),
  }
  const archive = {
    putDocument: vi.fn(async ({ bytes: _bytes, ...record }) => {
      const stored = { ...record, id: `document:${record.eventId}` }
      records.set(`document:${stored.id}`, clone(stored))
      return clone(stored)
    }),
    put: vi.fn(async (kind, id, record) => {
      const stored = clone(record)
      records.set(`${kind}:${id}`, stored)
      if (kind === 'publication') publications.push(stored)
      return clone(stored)
    }),
    get: vi.fn(async (kind, id) => clone(records.get(`${kind}:${id}`))),
    list: vi.fn(async (kind) => [...records.entries()].filter(([key]) => key.startsWith(`${kind}:`)).map(([, value]) => clone(value))),
    readDocument: vi.fn(async (id) => {
      const record = records.get(`document:${id}`)
      return record ? { ...clone(record), bytes: Buffer.from('{}') } : null
    }),
  }
  return { values, lists, records, publications, modelCalls, exaCalls, tickers, redis, archive, master: null, signals: [] }
})

vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: () => fixture.redis } }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class FixtureAnthropic {
    constructor() {
      this.messages = { create: async (request) => {
        fixture.modelCalls.push(structuredClone(request))
        const system = String(request.system || '')
        let payload
        if (system.includes('catalyst verification specialist')) {
          payload = [
            { ticker: 'ABC', catalystVerified: true, catalyst: 'ABC reports earnings after market close.', timeline: 'in 3 days', eventDate: '2026-09-12', pricedIn: false, confidence: 9, sources: ['https://fixture.example/abc-earnings'] },
            { ticker: 'HYPE', catalystVerified: true, catalyst: 'Rumored product reveal.', timeline: 'this week', eventDate: '2026-09-12', pricedIn: false, confidence: 8, sources: ['https://invented.example/hype'] },
            { ticker: 'NODATE', catalystVerified: true, catalyst: 'Management expects an update.', timeline: 'soon', eventDate: null, pricedIn: false, confidence: 6, sources: ['https://fixture.example/nodate-update'] },
            { ticker: 'EXAFAIL', catalystVerified: true, catalyst: 'Unconfirmed event.', timeline: 'this week', eventDate: '2026-09-12', pricedIn: false, confidence: 5, sources: ['https://fixture.example/exafail'] },
          ]
        } else if (system.includes('elite short-seller')) {
          payload = fixture.tickers.map((ticker) => ({ ticker, bearCase: 'The event may disappoint expectations.', riskScore: 3 }))
        } else if (request.tools) {
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fixture research report.' }] }
        } else {
          payload = fixture.tickers.map((ticker, index) => ({ ticker, conviction: 8 - index * 0.2, reason: ticker === 'ABC' ? 'A dated earnings event has corroborating coverage.' : 'A controlled negative catalyst fixture.' }))
        }
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(payload) }] }
      } }
    }
  },
}))
vi.mock('exa-js', () => ({
  default: class FixtureExa {
    constructor() {
      this.searchAndContents = async (query) => {
        fixture.exaCalls.push(query)
        if (query.startsWith('EXAFAIL stock upcoming catalyst')) throw new Error('fixture Exa outage')
        if (query.includes('stock risk downgrade')) return { results: [] }
        if (query.startsWith('ABC stock upcoming catalyst')) return { results: [{ title: 'ABC confirms earnings date', url: 'https://fixture.example/abc-earnings', text: 'ABC will report earnings after market close on September 12, 2026.', publishedDate: '2026-09-09' }] }
        if (query.startsWith('NODATE stock upcoming catalyst')) return { results: [{ title: 'ABC peer update', url: 'https://fixture.example/nodate-update', text: 'An update is expected, but no date was supplied.', publishedDate: '2026-09-09' }] }
        return { results: [] }
      }
    }
  },
}))

vi.mock('./foundation.js', async (importOriginal) => ({
  ...await importOriginal(),
  loadFoundation: async () => ({ redis: fixture.redis, archive: fixture.archive, master: fixture.master }),
}))
vi.mock('./evaluationJob.js', () => ({ freezeEvaluationJob: vi.fn(async () => ({ id: 'fixture-evaluation' })) }))
vi.mock('../xSignals.js', async (importOriginal) => ({
  ...await importOriginal(),
  collectXSignals: async () => ({ signals: fixture.signals, queries: ['fixture catalysts'], stats: { provider: 'fixture', accountSignals: fixture.signals.length, searchSignals: 0 } }),
}))
vi.mock('../researchEngine.js', async (importOriginal) => ({ ...await importOriginal(), fetchAllYahooNews: async () => [] }))
vi.mock('../technicalScreener.js', () => ({ fetchBreakoutCandidates: async () => [], candidatesToSignals: () => [] }))
vi.mock('../agents/exaDiscoveryAgent.js', () => ({ runExaDiscovery: async () => [] }))
vi.mock('../dayTradeSignals.js', () => ({ collectDayTradeSignals: async () => [] }))
vi.mock('../marketRegime.js', async (importOriginal) => ({
  ...await importOriginal(), getMarketRegime: async () => null, regimeSizeMultiplier: () => 0.75,
}))
vi.mock('../marketQuotes.js', () => ({
  fetchMarketQuotes: async (symbols) => ({ quotes: symbols.map((symbol) => ({ symbol, requestedSymbol: symbol, price: 100, changePercent: 1, currency: 'USD', volume: 1000000, marketTime: Date.now() / 1000, cacheStatus: 'fresh' })) }),
}))
vi.mock('../technicalAnalysis.js', () => ({
  analyzeTickersBatch: async (tickers) => new Map(tickers.map((ticker) => [ticker, { ticker, analyzed: true, trend: 'uptrend', rsi: 55, atr: 2, sma20: 98, sma50: 95, relativeVolume: 1.4, pctFrom52wHigh: -8, macd: { histogram: 1 } }])),
}))
vi.mock('../researchCoverageStore.js', () => ({
  loadCoverageHistory: async () => new Map(), loadSeenDocuments: async () => new Set(),
  coverageSnapshotFrom: (board) => ({ counts: Object.fromEntries(board.map((item) => [item.ticker, item.signalCount])) }),
  recordCoverageSnapshot: async () => {},
}))
vi.mock('../agents/signalHistoryTools.js', () => ({
  getWinRateStats: async () => ({ totalPicks: 0 }), formatStatsForPrompt: () => '', getRecentPickedTickers: async () => new Set(),
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'fixture-owner' } }) }))
vi.mock('../../utils/portfolioStorage', () => ({ loadLocalPortfolio: () => null }))
vi.mock('../../preview/mockMode', () => ({ IS_PREVIEW: false, PREVIEW_RESEARCH: null }))
vi.mock('../../components/CompanyLogo', () => ({ default: () => <span aria-hidden="true" /> }))

import nightlyHandler from '../../../api/nightly-research.js'
import { realHandler as getResearchHandler } from '../../../api/get-research.js'
import Research from '../../pages/Research.jsx'
import { createSecurityMaster } from './securityMaster.js'

const response = () => ({
  statusCode: 200,
  headers: {},
  status: vi.fn(function status(code) { this.statusCode = code; return this }),
  json: vi.fn(function json(body) { this.body = body; return this }),
  setHeader: vi.fn(function setHeader(name, value) { this.headers[name] = value }),
})

async function runPipeline() {
  const nightlyResponse = response()
  await nightlyHandler({ method: 'POST', headers: { authorization: 'Bearer fixture-secret' }, query: {} }, nightlyResponse)
  const stored = fixture.values.get('research:latest')
  const apiResponse = response()
  await getResearchHandler({ method: 'GET', query: {} }, apiResponse)
  return {
    nightlyResponse, stored, apiResponse, published: fixture.publications.at(-1),
    run: JSON.parse(fixture.lists.get('research:runs:v1')[0]),
  }
}

beforeEach(() => {
  fixture.values.clear(); fixture.lists.clear(); fixture.records.clear(); fixture.publications.length = 0
  fixture.modelCalls.length = 0; fixture.exaCalls.length = 0
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))
  vi.stubEnv('CRON_SECRET', 'fixture-secret')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fixture.invalid')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fixture-token')
  vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-anthropic')
  vi.stubEnv('EXA_API_KEY', 'fixture-exa')
  fixture.master = createSecurityMaster([{ asOf: '2026-09-01T00:00:00Z', securities: fixture.tickers.map((ticker, index) => ({
    ticker, securityId: `figi:${ticker}`, issuerId: `cik:${String(index + 1).padStart(10, '0')}`,
    name: `${ticker} Corp`, exchange: 'XNAS', currency: 'USD', type: 'common_stock', countryOfListing: 'US',
  })) }])
  fixture.signals = fixture.tickers.map((ticker, index) => ({
    id: `signal-${ticker}`, ticker, tickers: [ticker], username: `source${index}`, sourceType: 'account', sourceRole: 'conviction',
    sourceLabels: ['fixture'], score: 9 - index * 0.2, createdAt: '2026-09-09T10:00:00Z', url: `https://signals.example/${ticker.toLowerCase()}`,
    text: ticker === 'ABC' ? '$ABC reports Q3 earnings on September 12, 2026 after market close.' : `$${ticker} has an upcoming catalyst according to traders.`,
  }))
})

afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('research catalyst pipeline smoke test', () => {
  it('carries a verified catalyst through the real nightly publication, API, and UI', async () => {
    const expectedCatalyst = {
      catalystVerified: true,
      catalystDetail: 'ABC reports earnings after market close.',
      catalystDate: '2026-09-12',
      catalystTimeline: 'in 3 days',
      catalystPricedIn: false,
      catalystConfidence: 9,
      catalystSources: ['https://fixture.example/abc-earnings'],
    }

    const { nightlyResponse, stored, published, run, apiResponse } = await runPipeline()
    expect(nightlyResponse.statusCode).toBe(200)

    const storedByTicker = Object.fromEntries(stored.picks.map((pick) => [pick.ticker, pick]))
    expect(storedByTicker.ABC).toMatchObject(expectedCatalyst)
    expect(published.picks.find((pick) => pick.ticker === 'ABC')).toMatchObject(expectedCatalyst)

    expect(run.stages.map((stage) => stage.stage)).toEqual(expect.arrayContaining([
      'x_discovery', 'claude_review', 'catalyst_verification', 'final_ranking', 'publication', 'persistence',
    ]))
    expect(run.stages.find((stage) => stage.stage === 'catalyst_verification')).toMatchObject({ status: 'success', metrics: { candidates: 4, verified: 1 } })
    expect(run.candidates.find((candidate) => candidate.ticker === 'ABC')).toMatchObject(expectedCatalyst)
    expect([...fixture.records.keys()].some((key) => key.startsWith('admission:'))).toBe(true)
    expect([...fixture.records.keys()].some((key) => key.startsWith('review:'))).toBe(true)
    expect(fixture.modelCalls.some((call) => String(call.system).includes('catalyst verification specialist'))).toBe(true)

    expect(apiResponse.statusCode).toBe(200)
    expect(apiResponse.body.publicationId).toBe(stored.publicationId)
    expect(apiResponse.body.picks.find((pick) => pick.ticker === 'ABC')).toMatchObject(expectedCatalyst)

    vi.useRealTimers()
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => url === '/api/get-research' ? apiResponse.body
        : url === '/api/market-regime' ? { regime: null }
          : { quotes: [] },
    })))
    await act(async () => { render(<Research />) })
    const card = await screen.findByRole('article', { name: 'ABC' })
    if (!within(card).queryByText('The catalyst')) fireEvent.click(within(card).getByRole('button', { name: 'Read research for ABC' }))
    expect(within(card).getByText('We confirmed this event')).toBeVisible()
    expect(within(card).getByText('ABC reports earnings after market close.')).toBeVisible()
    expect(within(card).getByText('in 3 days')).toBeVisible()
    expect(within(card).getByText(/Evidence strength · 9 \/ 10/)).toBeVisible()
    expect(within(card).getByRole('link', { name: 'fixture.example' })).toHaveAttribute('href', 'https://fixture.example/abc-earnings')
    expect(within(card).getByText('September 12, 2026')).toHaveAttribute('datetime', '2026-09-12')

    // The smoke harness uses the normal projection/history keys and creates
    // one immutable publication; it has no test-only branch in production.
    expect(fixture.values.get('research:history:2026-09-09').publicationId).toBe(stored.publicationId)
    expect(fixture.publications).toHaveLength(1)
  })

  it('keeps unsupported, undated, and unavailable-source catalysts unverified without aborting publication', async () => {
    const { nightlyResponse, stored, published, apiResponse, run } = await runPipeline()
    const storedByTicker = Object.fromEntries(stored.picks.map((pick) => [pick.ticker, pick]))

    expect(nightlyResponse.statusCode).toBe(200)
    expect(storedByTicker.HYPE).toMatchObject({ catalystVerified: false, catalystSources: [] })
    expect(storedByTicker.NODATE).toMatchObject({ catalystVerified: false, catalystDate: null, catalystSources: ['https://fixture.example/nodate-update'] })
    expect(storedByTicker.EXAFAIL).toMatchObject({ catalystVerified: false, catalystSources: [] })
    expect(published.picks.find((pick) => pick.ticker === 'HYPE').catalystVerified).toBe(false)
    expect(apiResponse.body.picks.find((pick) => pick.ticker === 'NODATE').catalystVerified).toBe(false)
    expect(fixture.exaCalls.some((query) => query.startsWith('EXAFAIL stock upcoming catalyst'))).toBe(true)
    expect(run.stages.find((stage) => stage.stage === 'catalyst_verification')).toMatchObject({ status: 'success', metrics: { candidates: 4, verified: 1 } })
  })
})
