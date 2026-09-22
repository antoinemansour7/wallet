// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'
import { createContractEnumeration, listedContract, parseOsiSymbol, validateOptionContract } from './contracts.js'

const security = OPTIONS_WATCHLIST_SNAPSHOT.securities.find((item) => item.ticker === 'NVDA')
const enumeratedAt = '2026-09-22T13:32:00.000Z'
const standard = {
  id: 'provider-contract-id',
  symbol: 'NVDA261016C00200000',
  status: 'active',
  tradable: true,
  expiration_date: '2026-10-16',
  root_symbol: 'NVDA',
  underlying_symbol: 'NVDA',
  underlying_asset_id: 'provider-underlying-id',
  type: 'call',
  style: 'american',
  strike_price: '200',
  multiplier: '100',
  size: '100',
  ppind: false,
}

describe('option contract identity', () => {
  it('parses canonical OSI symbols without relying on a display name', () => {
    expect(parseOsiSymbol('NVDA261016C00200000')).toEqual({ root: 'NVDA', expirationDate: '2026-10-16', type: 'call', strikePrice: 200 })
    expect(parseOsiSymbol('bad')).toBeNull()
  })

  it('binds a listed contract to the intended dated issuer identity', () => {
    const result = validateOptionContract(standard, { security, enumeratedAt, provider: 'alpaca-basic-indicative' })
    expect(result.ok).toBe(true)
    expect(result.contract).toMatchObject({
      contractId: 'osi:NVDA261016C00200000',
      providerContractId: 'provider-contract-id',
      securityId: security.securityId,
      issuerId: security.issuerId,
      underlyingTicker: 'NVDA',
      lastTradingAt: '2026-10-16T20:00:00.000Z',
      multiplier: 100,
      deliverableShares: 100,
      adjusted: false,
      pennyProgram: false,
    })
    expect(result.contract.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects identity mismatches, adjusted deliverables and inconsistent OSI fields', () => {
    const result = validateOptionContract({
      ...standard,
      underlying_symbol: 'SPCX',
      root_symbol: 'NVDA1',
      expiration_date: '2026-10-23',
      strike_price: '205',
      multiplier: '10',
      ppind: true,
      additional_underlyings: [{ symbol: 'NVDA', qty: '5' }],
    }, { security, enumeratedAt, provider: 'fixture' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toEqual(expect.arrayContaining([
      'underlying_identity_mismatch', 'root_symbol_mismatch', 'expiration_mismatch', 'strike_mismatch', 'nonstandard_deliverable',
    ]))
  })

  it('derives last trading time from an early-close calendar day', () => {
    const result = validateOptionContract({
      ...standard,
      symbol: 'NVDA261224P00200000',
      expiration_date: '2026-12-24',
      type: 'put',
    }, { security, enumeratedAt, provider: 'fixture' })
    expect(result.ok).toBe(true)
    expect(result.contract.lastTradingAt).toBe('2026-12-24T18:00:00.000Z')
  })

  it('archives accepted and rejected rows in a dated enumeration', () => {
    const enumeration = createContractEnumeration({
      security,
      rawContracts: [standard, { ...standard, id: 'adjusted', symbol: 'NVDA1261016C00200000', root_symbol: 'NVDA1', additional_underlyings: [{ symbol: 'NVDA', qty: '5' }] }],
      enumeratedAt,
      provider: 'alpaca-basic-indicative',
      complete: true,
      requestedExpirationRange: { from: '2026-09-29', through: '2026-11-21' },
    })
    expect(enumeration.contracts).toHaveLength(1)
    expect(enumeration.rejected).toHaveLength(1)
    expect(enumeration.rejected[0].reasons).toContain('nonstandard_deliverable')
    expect(enumeration).toMatchObject({ securityId: security.securityId, issuerId: security.issuerId, complete: true })
    expect(enumeration.enumerationId).toMatch(/^[a-f0-9]{64}$/)
    expect(listedContract(enumeration, { contractId: standard.symbol, expirationDate: '2026-10-16', securityId: security.securityId, issuerId: security.issuerId })).toMatchObject({ listed: true, enumerationId: enumeration.enumerationId })
    expect(listedContract(enumeration, { expirationDate: '2026-10-23' })).toEqual({ listed: false, reason: 'contract_not_listed' })
  })

  it('cannot prove listing from a partial provider page', () => {
    const enumeration = createContractEnumeration({ security, rawContracts: [standard], enumeratedAt, provider: 'fixture', nextPageToken: 'more' })
    expect(enumeration.complete).toBe(false)
    expect(listedContract(enumeration, { contractId: standard.symbol })).toEqual({ listed: false, reason: 'enumeration_incomplete' })
  })
})
