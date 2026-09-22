// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  OPTIONS_WATCHLIST_SNAPSHOT,
  assertOptionsWatchlist,
  createOptionsIdentitySnapshot,
  createOptionsIdentityRegistry,
  normalizeOptionsWatchlist,
  watchlistSnapshotId,
} from './watchlist.js'

describe('options watchlist identity', () => {
  it('contains the 25 verified option underlyings with issuer-bound IDs', () => {
    expect(OPTIONS_WATCHLIST_SNAPSHOT.securities.map((item) => item.ticker)).toEqual([
      'SNDK', 'ASTS', 'MU', 'RKLB', 'MRVL', 'IREN', 'CRDO', 'SOFI', 'CRWV', 'SPCX', 'NBIS', 'PLTR', 'HOOD',
      'NVDA', 'AMD', 'ORCL', 'MSTR', 'AVGO', 'VST', 'INTC', 'SMCI', 'NOW', 'APP', 'AMZN', 'AAOI',
    ])
    expect(new Set(OPTIONS_WATCHLIST_SNAPSHOT.securities.map((item) => item.securityId))).toHaveLength(25)
    expect(watchlistSnapshotId()).toMatch(/^[a-f0-9]{64}$/)
  })

  it('records corrections only when the scanner context explicitly enables them', () => {
    expect(normalizeOptionsWatchlist(['AVGOVST', 'AMZ'])).toMatchObject({
      symbols: [],
      rejected: [
        { original: 'AVGOVST', reason: 'contextual_correction_requires_opt_in' },
        { original: 'AMZ', reason: 'contextual_correction_requires_opt_in' },
      ],
    })
    expect(normalizeOptionsWatchlist('avgovst AMZ NVDA', { allowContextualCorrections: true })).toEqual({
      symbols: ['AVGO', 'VST', 'AMZN', 'NVDA'],
      corrections: [
        { original: 'avgovst', symbols: ['AVGO', 'VST'], reason: 'Verified concatenation of two separately supplied watchlist symbols.' },
        { original: 'AMZ', symbols: ['AMZN'], reason: 'Verified only in the Options Opportunity Scanner source request.' },
      ],
      rejected: [],
    })
  })

  it('rejects unknown and malformed symbols rather than silently guessing', () => {
    const result = normalizeOptionsWatchlist(['NVDA', 'NOPE', '$AMD'])
    expect(result.symbols).toEqual(['NVDA'])
    expect(result.rejected.map((item) => item.reason)).toEqual(['unknown_symbol', 'invalid_symbol_format'])
    expect(() => assertOptionsWatchlist(['NVDA', 'NOPE'])).toThrow('Unresolved options watchlist symbols: NOPE')
  })

  it('resolves identities from the snapshot available at that historical time', () => {
    const original = OPTIONS_WATCHLIST_SNAPSHOT
    const later = {
      ...original,
      version: 'ticker-reuse-fixture',
      availableAt: '2027-01-01T00:00:00.000Z',
      securities: original.securities.map((item) => item.ticker === 'SNDK'
        ? { ...item, securityId: 'wallai:security:different-issuer:common', issuerId: 'wallai:issuer:different-issuer' }
        : item),
    }
    const registry = createOptionsIdentityRegistry([original, later])
    expect(registry.resolve({ ticker: 'SNDK', asOf: '2026-10-01T00:00:00Z' })[0].issuerId).toBe('wallai:issuer:sandisk')
    expect(registry.resolve({ ticker: 'SNDK', asOf: '2027-01-02T00:00:00Z' })[0].issuerId).toBe('wallai:issuer:different-issuer')
    expect(registry.resolve({ ticker: 'SNDK', asOf: '2026-01-01T00:00:00Z' })).toEqual([])
  })

  it('keeps issuer identity stable across a rename or split while changing the ticker interval', () => {
    const base = OPTIONS_WATCHLIST_SNAPSHOT.securities.find((item) => item.ticker === 'SNDK')
    const renamed = { ...base, ticker: 'SNDSK', tickerValidFrom: '2027-02-01T00:00:00.000Z', corporateActions: [{ type: 'split', effectiveDate: '2027-02-01', ratio: '2:1' }] }
    const snapshot = createOptionsIdentitySnapshot({
      version: 'rename-and-split-fixture',
      availableAt: '2027-02-01T12:00:00.000Z',
      source: { provider: 'fixture', url: 'https://example.test/identity', retrievedAt: '2027-02-01T12:00:00.000Z' },
      securities: [renamed],
    })
    const registry = createOptionsIdentityRegistry([OPTIONS_WATCHLIST_SNAPSHOT, snapshot])
    expect(registry.resolve({ ticker: 'SNDK', asOf: '2026-10-01T00:00:00Z' })[0].securityId).toBe(base.securityId)
    expect(registry.resolve({ ticker: 'SNDSK', asOf: '2027-02-02T00:00:00Z' })[0]).toMatchObject({ securityId: base.securityId, issuerId: base.issuerId })
    expect(snapshot.snapshotId).toMatch(/^[a-f0-9]{64}$/)
  })

  it('places an explicit historical boundary around the current SPCX issuer', () => {
    const spcx = OPTIONS_WATCHLIST_SNAPSHOT.securities.find((item) => item.ticker === 'SPCX')
    expect(spcx).toMatchObject({
      issuerId: 'wallai:issuer:space-exploration-technologies',
      tickerValidFrom: '2026-06-12T00:00:00.000Z',
    })
    expect(spcx.identityBoundary).toContain('predecessor')
    expect(createOptionsIdentityRegistry().resolve({ ticker: 'SPCX', asOf: '2026-06-11T23:59:59Z' })).toEqual([])
  })
})
