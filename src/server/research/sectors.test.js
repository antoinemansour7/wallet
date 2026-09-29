// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createArchive } from './archive.js'
import { evaluationTestStore } from './evaluationTestStore.js'
import { SECTOR_BENCHMARKS } from './evaluationPerformance.js'
import { SIC_SECTOR_VERSION, fetchPolygonSector, sectorFromSic, withSectors } from './sectors.js'

describe('sector from SIC code', () => {
  it.each([
    ['7372', 'Technology'], ['3674', 'Technology'], ['2834', 'Health Care'], ['8062', 'Health Care'],
    ['6022', 'Financials'], ['6770', 'Financials'], ['6798', 'Real Estate'], ['1311', 'Energy'], ['2911', 'Energy'],
    ['4911', 'Utilities'], ['4813', 'Communication Services'], ['3711', 'Consumer Discretionary'], ['5812', 'Consumer Discretionary'],
    ['5411', 'Consumer Staples'], ['2080', 'Consumer Staples'], ['2821', 'Materials'], ['1040', 'Materials'],
    ['3721', 'Industrials'], ['4512', 'Industrials'], ['7389', 'Industrials'],
  ])('maps SIC %s to %s', (sic, sector) => {
    expect(sectorFromSic(sic)).toBe(sector)
  })

  it('leaves a missing or unclassifiable code unknown instead of guessing', () => {
    expect(sectorFromSic(null)).toBeNull()
    expect(sectorFromSic('9995')).toBeNull()
    expect(sectorFromSic('abc')).toBeNull()
  })

  it('only produces sectors the evaluation can benchmark', () => {
    const codes = Array.from({ length: 10000 }, (_, code) => String(code).padStart(4, '0'))
    const sectors = new Set(codes.map(sectorFromSic).filter(Boolean))
    expect([...sectors].every((sector) => SECTOR_BENCHMARKS[sector])).toBe(true)
  })
})

describe('Polygon company details lookup', () => {
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })

  it('reads the company SIC code into a sector', async () => {
    const fetchImpl = vi.fn(async () => reply(200, { results: { sic_code: '7372', sic_description: 'SERVICES-PREPACKAGED SOFTWARE' } }))
    expect(await fetchPolygonSector('BAND', { fetchImpl, apiKey: 'key' })).toEqual({ sector: 'Technology', sicCode: '7372', sicDescription: 'SERVICES-PREPACKAGED SOFTWARE' })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.polygon.io/v3/reference/tickers/BAND?apiKey=key')
  })

  it('waits out the free plan rate limit and then retries', async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply(429, {})).mockResolvedValueOnce(reply(200, { results: { sic_code: '2834' } }))
    expect((await fetchPolygonSector('ABC', { fetchImpl, apiKey: 'key', sleep })).sector).toBe('Health Care')
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('returns nothing without a key or for an unknown ticker', async () => {
    expect(await fetchPolygonSector('ABC', { apiKey: '' })).toBeNull()
    expect(await fetchPolygonSector('ZZZZ', { fetchImpl: async () => reply(404, {}), apiKey: 'key' })).toBeNull()
  })
})

describe('sector enrichment for accepted candidates', () => {
  const candidate = (ticker, extra = {}) => ({ key: `figi:${ticker}:fundamentals`, securityId: `figi:${ticker}`, ticker, sector: null, ...extra })
  const accept = (c, score) => ({ key: c.key, status: 'accepted', score })

  it('looks up only accepted candidates, best first, within the lookup limit', async () => {
    const archive = createArchive(evaluationTestStore())
    const [a, b, c, d] = ['AAA', 'BBB', 'CCC', 'DDD'].map((ticker) => candidate(ticker))
    const lookup = vi.fn(async (ticker) => ({ sector: 'Technology', sicCode: '7372', sicDescription: ticker }))
    const enriched = await withSectors(archive, [a, b, c, d], [accept(a, 40), { key: b.key, status: 'rejected', score: 90 }, accept(c, 80), accept(d, 60)], { lookup, limit: 2 })
    expect(lookup.mock.calls.map(([ticker]) => ticker)).toEqual(['CCC', 'DDD'])
    expect(enriched.map((item) => [item.ticker, item.sector, item.sectorSource ?? null])).toEqual([
      ['AAA', null, null], ['BBB', null, null], ['CCC', 'Technology', SIC_SECTOR_VERSION], ['DDD', 'Technology', SIC_SECTOR_VERSION],
    ])
  })

  it('remembers a company sector so it is looked up once', async () => {
    const archive = createArchive(evaluationTestStore())
    const a = candidate('AAA')
    const lookup = vi.fn(async () => ({ sector: 'Energy', sicCode: '1311', sicDescription: 'CRUDE PETROLEUM' }))
    await withSectors(archive, [a], [accept(a, 50)], { lookup })
    const again = await withSectors(archive, [a], [accept(a, 50)], { lookup })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(again[0].sector).toBe('Energy')
  })

  it('keeps a sector the candidate already has, and never fails the review over a lookup error', async () => {
    const archive = createArchive(evaluationTestStore())
    const known = candidate('KNOWN', { sector: 'Utilities' }), broken = candidate('BROKEN')
    const lookup = vi.fn(async () => { throw new Error('network down') })
    const enriched = await withSectors(archive, [known, broken], [accept(known, 90), accept(broken, 80)], { lookup })
    expect(enriched.map((item) => item.sector)).toEqual(['Utilities', null])
    expect(lookup).toHaveBeenCalledTimes(1)
  })
})
