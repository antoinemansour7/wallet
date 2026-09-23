// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { alpacaClosingQuote, executionDataFor, previousSession, secIndustryCode, sectorFromSic } from './executionData.js'

describe('SEC industry code to sector', () => {
  it.each([
    ['5961', 'Consumer Cyclical'], ['3674', 'Technology'], ['7372', 'Technology'], ['2834', 'Healthcare'], ['2836', 'Healthcare'],
    ['1311', 'Energy'], ['4911', 'Utilities'], ['6022', 'Financials'], ['6798', 'Real Estate'], ['4813', 'Communication Services'],
    ['3711', 'Consumer Cyclical'], ['3721', 'Industrials'], ['2080', 'Consumer Defensive'], ['3841', 'Healthcare'],
  ])('maps SIC %s to %s', (sic, sector) => expect(sectorFromSic(sic)).toBe(sector))

  it('leaves blank-check and unknown codes unmapped', () => {
    expect(sectorFromSic('6770')).toBe('Financials')
    expect(sectorFromSic('9995')).toBeNull()
    expect(sectorFromSic(null)).toBeNull()
  })
})

describe('previous regular session', () => {
  it('is the last session already closed at the decision time', () => {
    expect(previousSession('2026-09-23T11:00:00Z')).toEqual({ date: '2026-09-22', closeAt: '2026-09-22T20:00:00.000Z' })
    expect(previousSession('2026-09-23T20:30:00Z').date).toBe('2026-09-23')
    expect(previousSession('2026-09-28T11:00:00Z').date).toBe('2026-09-25')
  })
})

describe('execution facts', () => {
  const candidates = [
    { key: 'figi:AMZN:fundamentals', ticker: 'AMZN', issuerId: 'cik:0001018724' },
    { key: 'figi:THIN:attention', ticker: 'THIN', issuerId: 'cik:0000000001' },
  ]
  const deps = {
    asOf: '2026-09-23T11:00:00Z',
    closingQuote: vi.fn(async (ticker, closeAt) => (ticker === 'AMZN'
      ? { bid: 254.93, ask: 255, at: '2026-09-22T19:59:59.999Z' }
      : { bid: 1, ask: 1.1, at: new Date(Date.parse(closeAt) + 60000).toISOString() })),
    dailyBars: vi.fn(async (_symbols, start) => new Map([['AMZN', [{ date: start, volume: 42007935 }]], ['THIN', []]])),
    industry: vi.fn(async (issuerId) => (issuerId === 'cik:0001018724' ? { sic: '5961', description: 'Retail-Catalog & Mail-Order Houses' } : null)),
  }

  it('gathers the closing NBBO spread, session volume and sector from before the decision', async () => {
    const facts = await executionDataFor(candidates, deps)
    const amzn = facts.get('figi:AMZN:fundamentals')
    expect(amzn).toMatchObject({ session: '2026-09-22', bid: 254.93, ask: 255, volume: 42007935, sector: 'Consumer Cyclical', sic: '5961', missing: [] })
    expect(amzn.spreadBps).toBeCloseTo((255 - 254.93) / 254.965 * 10000, 6)
    expect(deps.dailyBars).toHaveBeenCalledWith(['AMZN', 'THIN'], '2026-09-22', '2026-09-22')
    expect(deps.closingQuote).toHaveBeenCalledWith('AMZN', '2026-09-22T20:00:00.000Z')
  })

  it('keeps anything unavailable, or stamped after the close, explicitly missing', async () => {
    const thin = (await executionDataFor(candidates, deps)).get('figi:THIN:attention')
    expect(thin).toMatchObject({ spreadBps: null, volume: null, sector: null })
    expect(thin.missing).toEqual([
      { field: 'spreadBps', reason: 'closing_quote_unavailable' },
      { field: 'volume', reason: 'session_volume_unavailable' },
      { field: 'sector', reason: 'industry_code_unavailable' },
    ])
  })

  it('records a provider failure as the missing reason rather than failing the run', async () => {
    const facts = await executionDataFor(candidates.slice(0, 1), { ...deps,
      closingQuote: async () => { throw new Error('alpaca_credentials_unavailable') },
      dailyBars: async () => { throw new Error('alpaca_credentials_unavailable') },
      industry: async () => { throw new Error('sec_client_unavailable') } })
    expect(facts.get('figi:AMZN:fundamentals').missing.map((item) => item.reason)).toEqual(['alpaca_credentials_unavailable', 'alpaca_credentials_unavailable', 'sec_client_unavailable'])
  })
})

describe('providers', () => {
  it('asks Alpaca for the last consolidated quote in the minute before the close', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ quotes: [{ bp: 254.93, ap: 255, t: '2026-09-22T19:59:59.999Z' }] }) }))
    expect(await alpacaClosingQuote({ fetchImpl, keyId: 'k', secret: 's' })('AMZN', '2026-09-22T20:00:00.000Z')).toEqual({ bid: 254.93, ask: 255, at: '2026-09-22T19:59:59.999Z' })
    const url = fetchImpl.mock.calls[0][0]
    expect(url.pathname).toBe('/v2/stocks/AMZN/quotes')
    expect(Object.fromEntries(url.searchParams)).toEqual({ start: '2026-09-22T19:59:00.000Z', end: '2026-09-22T20:00:00.000Z', feed: 'sip', limit: '1', sort: 'desc' })
  })

  it('reads the issuer\'s SIC code from its SEC submissions', async () => {
    const client = { request: vi.fn(async () => ({ sic: '5961', sicDescription: 'Retail-Catalog & Mail-Order Houses' })) }
    expect(await secIndustryCode({ client })('cik:0001018724')).toEqual({ sic: '5961', description: 'Retail-Catalog & Mail-Order Houses' })
    expect(client.request).toHaveBeenCalledWith('https://data.sec.gov/submissions/CIK0001018724.json')
    expect(await secIndustryCode({ client })('not-a-cik')).toBeNull()
  })
})
