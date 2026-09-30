// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { createArchive } from '../research/archive.js'
import { memoryObjectStore, memoryRedis } from '../../test/memoryRedis.js'
import { optionsResearchFixture } from '../../test/optionsResearchFixture.js'
import { archiveOptionsAuditRecord } from './auditStore.js'
import { OUTCOME_RECOVERY_FEED, archiveOutcomeRecovery, buildOutcomeRecovery, recoveredOutcomePlans } from './outcomeRecovery.js'

const RECOVERED_AT = '2026-09-23T12:00:00.000Z'
let archive, fixture, readRecord

// A morning as it was published before chain contracts had their identity
// stamped on: contracts without securityId/issuerId and an empty outcome record.
beforeEach(async () => {
  archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() })
  fixture = optionsResearchFixture()
  for (const record of fixture.records) await archiveOptionsAuditRecord(archive, record)
  readRecord = async (ref, type, id) => {
    const record = await fixture.readRecord(ref, type, id)
    if (record && type === 'outcome') return { ...record, payload: { ...record.payload, outcomes: [] } }
    if (record && type === 'chain') {
      return { ...record, payload: { ...record.payload, contracts: record.payload.contracts.map(({ securityId, issuerId, underlyingTicker, ...contract }) => contract) } }
    }
    return record
  }
})

const build = (options = {}) => buildOutcomeRecovery({ archive, manifest: fixture.manifest, availableAt: RECOVERED_AT, readRecord, ...options })

describe('outcome plan recovery', () => {
  it('plans every published contract stored without a plan, from the chain underlying identity', async () => {
    const recovery = await build()
    expect(recovery.unrecoverable).toEqual([])
    expect(recovery.plans.map((plan) => plan.contract.contractId).sort()).toEqual(fixture.contracts.map((contract) => contract.contractId).sort())
    expect(recovery.plans[0]).toMatchObject({
      tradingDate: '2026-09-22', entryAt: '2026-09-22T13:32:15.000Z',
      contract: { securityId: 'sec:EX', issuerId: 'iss:EX', ticker: 'EX' },
    })
    expect(recovery.record).toMatchObject({ recordType: 'outcome', scanId: fixture.manifest.scanId, source: { feed: OUTCOME_RECOVERY_FEED } })
  })

  it('makes the recovered plans readable for their scan, and recovers nothing a second time', async () => {
    const recovery = await build()
    await archiveOutcomeRecovery(archive, recovery.record)
    const stored = await recoveredOutcomePlans(archive, fixture.manifest.scanId)
    expect(stored.map((plan) => plan.planId).sort()).toEqual(recovery.plans.map((plan) => plan.planId).sort())
    expect(await build()).toMatchObject({ plans: [], record: null })
  })

  it('leaves a morning whose plans were stored with it alone', async () => {
    expect(await build({ readRecord: fixture.readRecord })).toMatchObject({ plans: [], record: null })
  })

  it('never mistakes the original outcome record for a recovery', async () => {
    expect(await recoveredOutcomePlans(archive, fixture.manifest.scanId)).toEqual([])
  })

  it('reports a contract whose chain evidence is missing instead of dropping it silently', async () => {
    const recovery = await build({ readRecord: async (ref, type, id) => (type === 'chain' ? null : readRecord(ref, type, id)) })
    expect(recovery.plans).toEqual([])
    expect(recovery.unrecoverable.map((item) => item.reason)).toEqual(['chain_evidence_unavailable', 'chain_evidence_unavailable'])
  })
})
