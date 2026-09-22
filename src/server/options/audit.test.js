// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createOptionsAuditRecord, createOptionsRetention, validateOptionsAuditRecord } from './audit.js'

const hash = 'a'.repeat(64)
const base = (overrides = {}) => ({
  type: 'chain',
  scanId: 'scan-2026-09-22',
  availableAt: '2026-09-22T13:32:01.123456789Z',
  source: { provider: 'alpaca', feed: 'indicative', session: 'rth', entitlement: 'basic-free' },
  versions: { code: 'commit-fixture', model: 'none', policy: 'options-policy-v0' },
  inputHashes: [hash],
  payload: {
    underlying: { securityId: 'wallai:security:nvidia:common', issuerId: 'wallai:issuer:nvidia', ticker: 'NVDA' },
    contracts: [{ rawId: 'provider-1', contractId: 'osi:NVDA261016C00200000', sipTimestampNs: '1790083921123456789', openInterest: null }],
    rejected: [{ rawId: 'provider-2', reason: 'wide_spread' }],
    prefilter: { manifestHash: hash, requestedDte: [7, 60] },
  },
  fieldTimes: {
    'payload.contracts[0].quote': {
      marketAt: '2026-09-22T13:32:01.123456789Z',
      publicAt: '2026-09-22T13:32:01.200000000Z',
      fetchedAt: '2026-09-22T13:32:01.300000000Z',
      availableAt: '2026-09-22T13:32:01.300000000Z',
    },
  },
  missing: [{ path: 'payload.contracts[0].openInterest', reason: 'provider_returned_null' }],
  ...overrides,
})

describe('options audit records', () => {
  it('preserves source lineage, field-level nanoseconds, versions and missing-data reasons', () => {
    const record = createOptionsAuditRecord(base())
    expect(record).toMatchObject({
      envelopeVersion: 'options-audit-envelope-v1',
      recordType: 'chain',
      archiveKind: 'options-chain',
      recordSchemaVersion: 'options-chain-v1',
      scanId: 'scan-2026-09-22',
      inputHashes: [hash],
      source: { provider: 'alpaca', feed: 'indicative', session: 'rth', entitlement: 'basic-free' },
      versions: { code: 'commit-fixture', model: 'none', policy: 'options-policy-v0', schema: 'options-chain-v1' },
    })
    expect(record.payload.contracts[0].sipTimestampNs).toBe('1790083921123456789')
    expect(record.fieldTimes['payload.contracts[0].quote'].marketAt).toBe('2026-09-22T13:32:01.123456789Z')
    expect(record.recordId).toMatch(/^[a-f0-9]{64}$/)
    expect(record.byteLength).toBeGreaterThan(0)
    expect(validateOptionsAuditRecord(record)).toBe(record)
  })

  it('rejects nulls without reasons and never substitutes a value', () => {
    expect(() => createOptionsAuditRecord(base({ missing: [] }))).toThrow('Null value requires a missing-data reason')
  })

  it('rejects rounded or unsafe provider timestamps', () => {
    const numericNs = base()
    numericNs.payload.contracts[0].sipTimestampNs = Number('1790083921123456789')
    expect(() => createOptionsAuditRecord(numericNs)).toThrow(/nanoseconds|unsafe integer/)
  })

  it('requires raw and normalized contract IDs plus rejection and prefilter evidence', () => {
    const noRawId = base()
    delete noRawId.payload.contracts[0].rawId
    expect(() => createOptionsAuditRecord(noRawId)).toThrow('rawId and contractId')
    const noManifest = base()
    noManifest.payload.prefilter = {}
    expect(() => createOptionsAuditRecord(noManifest)).toThrow('prefilter requires a manifest hash')

    const undatedOpenInterest = base()
    undatedOpenInterest.payload.contracts[0].openInterest = 42
    expect(() => createOptionsAuditRecord(undatedOpenInterest)).toThrow('open interest requires an as-of date')
  })

  it('records an explicit license and index/archive lifecycle', () => {
    const retention = createOptionsRetention({ availableAt: '2026-09-22T13:32:01Z', licenseId: 'fixture-license', indexDays: 30, normalizedDays: 365 })
    expect(retention).toEqual({
      policyVersion: 'options-retention-v1',
      licenseId: 'fixture-license',
      rawPayloadAllowed: false,
      indexExpiresAt: '2026-10-22T13:32:01.000Z',
      normalizedArchiveReviewAt: '2027-09-22T13:32:01.000Z',
      deletionMode: 'expire-index-then-review-object',
    })
    expect(() => createOptionsAuditRecord(base({ retention, payload: { ...base().payload, rawProviderPayload: { secret: 'not allowed' } } }))).toThrow('forbids raw provider payloads')
  })
})
