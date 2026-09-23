// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  histories: vi.fn(), trackEvaluation: vi.fn(), store: vi.fn(), recordRun: vi.fn(),
  redis: { lrange: vi.fn(async () => []), lpush: vi.fn(async () => {}), ltrim: vi.fn(async () => {}), get: vi.fn(async () => null) },
}))
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: () => mocks.redis } }))
vi.mock('../src/server/research/history.js', () => ({ evaluationHistory: mocks.histories }))
vi.mock('../src/server/research/foundation.js', () => ({ loadFoundation: async () => ({ master: { resolve: () => [] } }) }))
vi.mock('../src/server/research/evaluationPerformance.js', () => ({ trackEvaluation: mocks.trackEvaluation }))
vi.mock('../src/server/agents/signalHistoryTools.js', () => ({ storePickPerformance: mocks.store, invalidateStatsCache: async () => {} }))
vi.mock('../src/server/runLog.js', () => ({ recordRun: mocks.recordRun }))
import handler from './track-performance.js'

const day = (date) => Date.parse(`${date}T13:30:00Z`) / 1000
// Yahoo's 2026-09-22 outage: the row exists, every value null, for every symbol.
const yahoo = (closes) => ({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: ['2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23'].map(day),
  indicators: { quote: [{ open: [closes[0], closes[1], null, closes[2]], high: [closes[0], closes[1], null, closes[2]], close: [closes[0], closes[1], null, closes[2]] }] } }] } })
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() })

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test'); vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fixture.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 't')
  vi.stubEnv('ALPACA_API_KEY_ID', 'key'); vi.stubEnv('ALPACA_API_SECRET_KEY', 'secret')
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-24T09:42:00Z'))
  mocks.histories.mockResolvedValue([{ date: '2026-09-17', generatedAt: '2026-09-17T07:24:00Z', picks: [{ ticker: 'AMZN' }] }])
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const target = new URL(url)
    if (target.hostname === 'data.alpaca.markets') {
      const symbols = target.searchParams.get('symbols').split(',')
      return { ok: true, json: async () => ({ bars: Object.fromEntries(symbols.map((symbol) => [symbol, [{ t: '2026-09-22T04:00:00Z', o: 700, h: 780, c: symbol === 'SPY' ? 773.38 : 254.98 }]])) }) }
    }
    const symbol = decodeURIComponent(target.pathname.split('/').at(-1))
    return { ok: true, json: async () => yahoo(symbol === 'SPY' ? [761.69, 773.5, 769.95] : [253.71, 258.45, 250.48]) }
  }))
  mocks.trackEvaluation.mockImplementation(async (_archive, { candlesFor, prefetch }) => {
    await prefetch(['XYZ', 'XLK'])
    mocks.evaluationBars = { spy: await candlesFor('SPY'), xyz: await candlesFor('XYZ') }
    return 0
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('track-performance provider gap fill', () => {
  it('fills the session Yahoo dropped for every symbol from one batched Alpaca request per set of symbols', async () => {
    const res = response()
    await handler({ method: 'POST', headers: { authorization: 'Bearer test' } }, res)
    expect(res.status).toHaveBeenCalledWith(200)
    const alpaca = fetch.mock.calls.map(([url]) => new URL(url)).filter((url) => url.hostname === 'data.alpaca.markets')
    expect(alpaca.map((url) => [url.searchParams.get('symbols'), url.searchParams.get('start'), url.searchParams.get('feed')])).toEqual([
      ['SPY,AMZN', '2026-09-22', 'sip'], ['XYZ,XLK', '2026-09-22', 'sip'],
    ])
    const filled = (bars) => bars.find((bar) => bar.date === '2026-09-22')
    expect(filled(mocks.evaluationBars.spy)).toMatchObject({ close: 773.38, source: 'alpaca-sip' })
    expect(filled(mocks.evaluationBars.xyz)).toMatchObject({ close: 254.98, source: 'alpaca-sip' })
    expect(mocks.evaluationBars.spy.find((bar) => bar.date === '2026-09-21')).toMatchObject({ close: 773.5 })
    expect(mocks.evaluationBars.spy.find((bar) => bar.date === '2026-09-21')).not.toHaveProperty('source')
  })

  it('keeps running, and reports the gap as unfilled, when Alpaca credentials are missing', async () => {
    vi.stubEnv('ALPACA_API_KEY_ID', '')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = response()
    await handler({ method: 'POST', headers: { authorization: 'Bearer test' } }, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.evaluationBars.spy.find((bar) => bar.date === '2026-09-22').close).toBeNull()
    expect(res.json.mock.calls[0][0].errors).toEqual(expect.arrayContaining([
      { stage: 'price-gap-fill', error: '2 symbols unfilled: alpaca_credentials_unavailable' },
    ]))
  })
})
