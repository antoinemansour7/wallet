// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createArchive } from '../research/archive.js'
import { createOptionsAuditRecord } from './audit.js'
import { commitOptionsScan, latestOptionsManifest, OPTIONS_LATEST_POINTER_KEY, OPTIONS_SCAN_LOCK_KEY } from './auditStore.js'
import { createOpeningAuditRecords } from './publication.js'

function memoryRedis() {
  const values = new Map(), indexes = new Map(), calls = { set: 0, get: 0, zadd: 0, eval: 0 }
  return {
    values, indexes, calls,
    async get(key) { calls.get++; return structuredClone(values.get(key) ?? null) },
    async set(key, value, options = {}) { calls.set++; if (options.nx && values.has(key)) return null; values.set(key, structuredClone(value)); return 'OK' },
    async zadd(key, { score, member }) { calls.zadd++; if (!indexes.has(key)) indexes.set(key, new Map()); indexes.get(key).set(member, score) },
    async zrange() { return [] },
    async eval(_script, keys, args) {
      calls.eval++
      if (values.get(keys[0]) !== args[0]) return 0
      const prior = values.get(keys[2])
      if (prior) return prior === args[2] ? 2 : -1
      values.set(keys[1], args[1]); values.set(keys[2], args[2]); return 1
    },
  }
}

function memoryObjectStore() {
  const objects = new Map()
  return { objects,
    async putIfAbsent(key, bytes) { if (!objects.has(key)) objects.set(key, Buffer.from(bytes)) },
    async get(key) { const value = objects.get(key); if (!value) throw new Error('missing object'); return value },
  }
}

const common = {
  scanId: 'scan-1', availableAt: '2026-09-22T13:32:01.000Z',
  source: { provider: 'alpaca', feed: 'indicative', session: 'rth', entitlement: 'basic-free' },
  versions: { code: 'fixture', model: 'none', policy: 'v0' }, inputHashes: [], fieldTimes: {}, missing: [],
}

const scanRecord = () => createOptionsAuditRecord({ ...common, type: 'scan', payload: { stage: 'opening', status: 'complete' } })
const chainRecord = (contracts = 1) => createOptionsAuditRecord({ ...common, type: 'chain', payload: {
  underlying: { securityId: 'security', issuerId: 'issuer', ticker: 'NVDA' },
  contracts: Array.from({ length: contracts }, (_, index) => ({ rawId: `raw-${index}`, contractId: `osi:${index}` })),
  rejected: [], prefilter: { manifestHash: 'a'.repeat(64) },
} })

describe('options audit storage', () => {
  it('stores immutable batches in R2 and publishes a small manifest/latest pointer only after success', async () => {
    const redis = memoryRedis(), objectStore = memoryObjectStore(), archive = createArchive(redis, { objectStore })
    await redis.set(OPTIONS_SCAN_LOCK_KEY, 'owner-token')
    const records = [scanRecord(), chainRecord(500)]
    const before = { ...redis.calls }
    const result = await commitOptionsScan({ archive, redis, records, scanId: 'scan-1', availableAt: common.availableAt, lockToken: 'owner-token' })

    expect(result.manifest.storage).toMatchObject({ recordBatches: 2, uncompressedBytes: expect.any(Number) })
    expect(result.manifest.records.find((item) => item.type === 'chain').count).toBe(500)
    expect(objectStore.objects.size).toBe(2)
    expect(redis.values.get(`research:archive:v1:options-chain:${records[1].recordId}`)).toMatchObject({ storage: 'r2-json-gzip-v1' })
    expect(redis.values.get('research:archive:v1:options-manifest:' + result.manifest.manifestId)).toMatchObject({ scanId: 'scan-1' })
    expect(JSON.parse(redis.values.get(OPTIONS_LATEST_POINTER_KEY))).toMatchObject({ manifestId: result.manifest.manifestId, scanId: 'scan-1' })
    expect(await latestOptionsManifest(archive, redis)).toEqual(result.manifest)
    expect(redis.calls.set - before.set).toBe(3) // two batch pointers + one manifest; never one per contract
    expect(redis.calls.eval - before.eval).toBe(1)
  })

  it('accepts identical retries but detects an immutable ID collision', async () => {
    const redis = memoryRedis(), archive = createArchive(redis, { objectStore: memoryObjectStore() })
    const first = { availableAt: common.availableAt, value: 1 }
    expect(await archive.put('options-scan', 'fixed-id', first)).toEqual(first)
    expect(await archive.put('options-scan', 'fixed-id', first)).toEqual(first)
    await expect(archive.put('options-scan', 'fixed-id', { ...first, value: 2 })).rejects.toMatchObject({ code: 'ARCHIVE_CONFLICT' })
  })

  it('does not write any batch when the publication lock is absent', async () => {
    const redis = memoryRedis(), objectStore = memoryObjectStore(), archive = createArchive(redis, { objectStore })
    await expect(commitOptionsScan({ archive, redis, records: [scanRecord()], scanId: 'scan-1', availableAt: common.availableAt, lockToken: 'not-owner' })).rejects.toThrow('lock is not owned')
    expect(objectStore.objects.size).toBe(0)
    expect(redis.values.has(OPTIONS_LATEST_POINTER_KEY)).toBe(false)
  })

  it('never publishes when R2 or an index write fails', async () => {
    const redis = memoryRedis(), brokenStore = memoryObjectStore(), archive = createArchive(redis, { objectStore: brokenStore })
    await redis.set(OPTIONS_SCAN_LOCK_KEY, 'owner-token')
    brokenStore.putIfAbsent = vi.fn(async () => { throw new Error('R2 quota') })
    await expect(commitOptionsScan({ archive, redis, records: [scanRecord()], scanId: 'scan-1', availableAt: common.availableAt, lockToken: 'owner-token' })).rejects.toThrow('R2 quota')
    expect(redis.values.has(OPTIONS_LATEST_POINTER_KEY)).toBe(false)

    const redis2 = memoryRedis(), archive2 = createArchive(redis2, { objectStore: memoryObjectStore() })
    await redis2.set(OPTIONS_SCAN_LOCK_KEY, 'owner-token')
    redis2.zadd = vi.fn(async () => { throw new Error('Redis index quota') })
    await expect(commitOptionsScan({ archive: archive2, redis: redis2, records: [scanRecord()], scanId: 'scan-1', availableAt: common.availableAt, lockToken: 'owner-token' })).rejects.toThrow('Redis index quota')
    expect(redis2.values.has(OPTIONS_LATEST_POINTER_KEY)).toBe(false)
  })

  it('leaves an immutable orphan but no latest pointer when the lock is lost during commit', async () => {
    const redis = memoryRedis(), archive = createArchive(redis, { objectStore: memoryObjectStore() })
    await redis.set(OPTIONS_SCAN_LOCK_KEY, 'owner-token')
    redis.eval = vi.fn(async () => 0)
    await expect(commitOptionsScan({ archive, redis, records: [scanRecord()], scanId: 'scan-1', availableAt: common.availableAt, lockToken: 'owner-token' })).rejects.toThrow('lock was lost')
    expect(redis.values.has(OPTIONS_LATEST_POINTER_KEY)).toBe(false)
  })

  it('publishes one complete opening revision and treats an identical retry as a duplicate', async () => {
    const redis = memoryRedis(), archive = createArchive(redis, { objectStore: memoryObjectStore() })
    await redis.set(OPTIONS_SCAN_LOCK_KEY, 'owner-token')
    const ranking = {
      policyVersion: 'score-v0', cohort: null, maxPerUnderlyingDirection: 2,
      ranked: [], displayed: [], suppressed: [], ineligible: [],
      metrics: { scoredCount: 0, ineligibleCount: 0, displayedCount: 0, suppressedCount: 0, topScore: null, blockerCodes: [] },
    }
    const built = createOpeningAuditRecords({
      scanId: 'scan-1', tradingDate: '2026-09-22', availableAt: common.availableAt, ranking, scenarios: [],
    })
    const records = Object.values(built)
    const first = await commitOptionsScan({
      archive, redis, records, scanId: 'scan-1', availableAt: common.availableAt,
      lockToken: 'owner-token', requirePublication: true,
    })
    const second = await commitOptionsScan({
      archive, redis, records, scanId: 'scan-1', availableAt: common.availableAt,
      lockToken: 'owner-token', requirePublication: true,
    })
    expect(first.duplicate).toBe(false)
    expect(second).toMatchObject({ duplicate: true, manifest: { manifestId: first.manifest.manifestId } })
    expect(first.manifest.publication).toMatchObject({ state: 'empty', result: 'empty' })
  })
})
