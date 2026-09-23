// A seeded shadow-test archive for server and UI tests: one published morning
// (a winning call, a losing put), a valid empty day, a degraded day, a day with
// no scan, a provider gap and a checkpoint that was never captured.
import { createArchive } from '../server/research/archive.js'
import { archiveOptionsAuditRecord } from '../server/options/auditStore.js'
import { forwardCaptureScanId, rollUpObservationDay } from '../server/options/forwardCapture.js'
import { archiveObservationRecord, createObservationAuditRecord } from '../server/options/observations.js'
import { memoryObjectStore, memoryRedis } from './memoryRedis.js'
import { optionsResearchFixture } from './optionsResearchFixture.js'

export const SHADOW_CALL = 'osi:EX261022C00200000'
export const SHADOW_PUT = 'osi:EX261022P00160000'
const iso = (ms) => new Date(ms).toISOString()

export async function optionsShadowFixture() {
  const redis = memoryRedis()
  const archive = createArchive(redis, { objectStore: memoryObjectStore() })
  const fixture = optionsResearchFixture()
  const planFor = (contractId) => fixture.records.find((record) => record.recordType === 'outcome').payload.outcomes.find((plan) => plan.contract.contractId === contractId)
  const publish = (manifest) => archive.put('options-manifest', manifest.manifestId, manifest, 'options-manifests', manifest.availableAt)
  const morning = (tradingDate, overrides) => {
    const publication = { ...fixture.manifest.publication, tradingDate, availableAt: `${tradingDate}T13:32:20.000Z`, selected: [], result: 'empty', state: 'empty', completeness: 'complete', revision: 1, ...overrides }
    return { manifestId: tradingDate.replace(/-/g, '').padEnd(64, 'd'), scanId: `${tradingDate}:opening`, availableAt: publication.availableAt, publication, records: [] }
  }
  // Mirrors what the capture tick archives: taken 15s before the instant.
  const capture = async (tradingDate, instant, entries) => {
    const target = Date.parse(instant), at = iso(target - 15000)
    const observations = entries.map(({ contractId, bid, underlying = null, gap = false }) => ({
      planId: planFor(contractId).planId, scanId: fixture.manifest.scanId, contractId, securityId: 'sec:EX', issuerId: 'iss:EX',
      scheduledAt: instant, purposes: ['test'], at, availableAt: at, status: gap ? 'provider_snapshot_absent' : 'observed',
      quote: gap ? null : { bid, ask: bid + 0.2, bidSize: 10, askSize: 10, marketAt: iso(target - 17000), availableAt: at },
      underlyingPrice: underlying, underlyingMarketAt: at, iv: 0.6, volume: 10,
    }))
    await archiveObservationRecord(archive, createObservationAuditRecord({
      scanId: forwardCaptureScanId(tradingDate), availableAt: at, observations, licenseId: 'test-fixture',
      request: { endpoint: 'test', parametersHash: 'a'.repeat(64), requestedAt: at, receivedAt: at, attempt: 1, bodyChecksum: 'b'.repeat(64) },
      source: { provider: 'fixture', feed: 'indicative', session: 'regular', entitlement: 'internal' },
    }))
  }

  for (const record of fixture.records) await archiveOptionsAuditRecord(archive, record)
  await publish(fixture.manifest)
  await publish(morning('2026-09-23'))
  await publish(morning('2026-09-24', { completeness: 'partial', state: 'partial' }))
  // Same-day close: the call gains, the put loses. Stock 185 is below the call's 200 strike.
  await capture('2026-09-22', '2026-09-22T20:00:00.000Z', [{ contractId: SHADOW_CALL, bid: 6.4, underlying: 185 }, { contractId: SHADOW_PUT, bid: 4, underlying: 185 }])
  // Midday +1: the call reaches its 25% and 50% premium targets while still OTM.
  await capture('2026-09-23', '2026-09-23T15:00:00.000Z', [{ contractId: SHADOW_CALL, bid: 8.4, underlying: 188 }])
  // +1 close: the provider omitted the put.
  await capture('2026-09-23', '2026-09-23T20:00:00.000Z', [{ contractId: SHADOW_CALL, bid: 7, underlying: 186 }, { contractId: SHADOW_PUT, gap: true }])
  await rollUpObservationDay(archive, '2026-09-22')
  return { redis, archive, fixture }
}
