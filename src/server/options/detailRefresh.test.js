// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { refreshOptionsContractDetail } from './detailRefresh.js'
import { validateOptionsAuditRecord } from './audit.js'

const CONTRACT_ID = 'osi:EX261016C00100000'
const originalContract = {
  rawId: 'raw-original', contractId: CONTRACT_ID, osiSymbol: 'EX261016C00100000', type: 'call',
  strikePrice: 100, expirationDate: '2026-10-16', quote: { bid: 2, ask: 2.1, bidSize: 5, askSize: 5, marketAt: '2026-09-22T13:32:00.000Z', ageMs: 2000 },
}
const originalRecord = {
  recordId: 'a'.repeat(64), availableAt: '2026-09-22T13:32:02.000Z',
  payload: {
    underlying: { securityId: 'sec:EX', issuerId: 'iss:EX', ticker: 'EX', direction: 'call', regularOpenAt: '2026-09-22T13:30:00.000Z' },
    contracts: [originalContract], rejected: [], prefilter: { manifestHash: 'b'.repeat(64) },
  },
}
const manifest = {
  manifestId: 'c'.repeat(64), scanId: '2026-09-22:opening:policy',
  records: [{ type: 'chain', id: originalRecord.recordId }],
}

function observation() {
  return {
    fetchedAt: '2026-09-22T14:00:02.000Z',
    underlying: { quote: { bid: 99.9, ask: 100.1, marketAt: '2026-09-22T14:00:01.000Z', ageMs: 1000 } },
    contracts: [{
      rawId: 'raw-refresh', contractId: CONTRACT_ID, osiSymbol: 'EX261016C00100000', type: 'call',
      strikePrice: 100, expirationDate: '2026-10-16',
      quote: { bid: 2.2, ask: 2.3, bidSize: 5, askSize: 5, marketAt: '2026-09-22T14:00:00.000Z', ageMs: 2000 },
      trade: null, volume: { value: 12, session: 'rth', sessionDate: '2026-09-22' }, previousDailyBar: null,
      openInterest: { value: 300, asOfDate: '2026-09-21' }, analytics: { greeks: { delta: 0.4 }, age: 'unknown' },
      fetchedAt: '2026-09-22T14:00:02.000Z', rawReferenceHash: 'd'.repeat(64),
    }],
    rejected: [],
  }
}

describe('refreshOptionsContractDetail', () => {
  it('archives a separate quote revision and leaves the morning evidence untouched', async () => {
    const before = structuredClone(originalRecord)
    const archiveRecord = vi.fn(async (_archive, record) => validateOptionsAuditRecord(record))
    const result = await refreshOptionsContractDetail({
      archive: {}, manifest, contractId: CONTRACT_ID,
      readRecord: vi.fn(async () => originalRecord), archiveRecord,
      createAlpaca: () => ({ optionChain: vi.fn(async () => observation()) }),
      now: () => Date.parse('2026-09-22T14:00:02.000Z'),
    })
    expect(originalRecord).toEqual(before)
    expect(result.morning).toMatchObject({ recordId: originalRecord.recordId, contract: { quote: { bid: 2 } } })
    expect(result.refresh).toMatchObject({ status: 'accepted', contract: { quote: { bid: 2.2 } } })
    expect(result.refresh.recordId).not.toBe(originalRecord.recordId)
    const archived = archiveRecord.mock.calls[0][1]
    expect(archived.scanId).toContain(':detail:')
    expect(archived.payload.prefilter).toMatchObject({ supersedesRecordId: originalRecord.recordId, morningManifestId: manifest.manifestId })
  })
})
