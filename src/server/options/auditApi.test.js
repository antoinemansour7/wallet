// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ verifyOwner: vi.fn(), redisFromEnv: vi.fn(), createArchive: vi.fn(), latest: vi.fn(), record: vi.fn(), refresh: vi.fn() }))
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: mocks.redisFromEnv } }))
vi.mock('../research/evaluationApi.js', () => ({ verifyOwner: mocks.verifyOwner }))
vi.mock('../research/archive.js', () => ({ createArchive: mocks.createArchive }))
vi.mock('./auditStore.js', () => ({ latestOptionsManifest: mocks.latest, optionsAuditRecord: mocks.record }))
vi.mock('./detailRefresh.js', () => ({ refreshOptionsContractDetail: mocks.refresh }))
import handler, { createOptionsAuditHandler } from './auditApi.js'

const response = () => ({ setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() })
const request = (overrides = {}) => ({ method: 'GET', headers: { authorization: 'Bearer owner-token' }, query: {}, ...overrides })
const body = (res) => res.json.mock.calls.at(-1)[0]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fixture.invalid')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fixture')
  mocks.verifyOwner.mockResolvedValue({ uid: 'owner' })
  mocks.redisFromEnv.mockReturnValue({ fixture: 'redis' })
  mocks.createArchive.mockReturnValue({ fixture: 'archive' })
  mocks.latest.mockResolvedValue({ manifestId: 'manifest-1' })
  mocks.record.mockResolvedValue({ recordId: 'a'.repeat(64) })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('owner-only options audit API', () => {
  it('returns the latest manifest privately to the owner', async () => {
    const res = response(); await handler(request(), res)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(body(res)).toEqual({ summary: expect.objectContaining({ state: 'unavailable', referenceId: 'manifest-1' }) })
  })

  it('authorizes before any storage read', async () => {
    mocks.verifyOwner.mockResolvedValue({ status: 403, error: 'Owner access required' })
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(mocks.redisFromEnv).not.toHaveBeenCalled()
    expect(mocks.latest).not.toHaveBeenCalled()
  })

  it.each([
    [undefined, 401, 'Sign in required'],
    ['ordinary', 403, 'Owner access required'],
  ])('denies a private read for %s', async (_caller, status, error) => {
    mocks.verifyOwner.mockResolvedValue({ status, error })
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(status)
    expect(body(res)).toEqual({ error })
    expect(mocks.createArchive).not.toHaveBeenCalled()
  })

  it('reads only an allowlisted record type and digest-shaped ID', async () => {
    const id = 'a'.repeat(64)
    const res = response(); await handler(request({ query: { recordType: 'chain', recordId: id } }), res)
    expect(mocks.record).toHaveBeenCalledWith({ fixture: 'archive' }, 'chain', id)
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('returns not found for invalid or absent private record identifiers', async () => {
    mocks.record.mockResolvedValue(null)
    const res = response(); await handler(request({ query: { recordType: 'unknown', recordId: 'not-a-digest' } }), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(body(res)).toEqual({ error: 'Options audit record not found' })
  })

  it('returns a sanitized reference ID while keeping the storage error private', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.latest.mockRejectedValue(new Error('ERR max requests limit exceeded; secret-provider-detail'))
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(503)
    expect(body(res)).toMatchObject({ error: 'Options audit data is unavailable', referenceId: expect.stringMatching(/^options-/) })
    expect(JSON.stringify(body(res))).not.toContain('max requests')
    expect(JSON.stringify(body(res))).not.toContain('secret-provider-detail')
  })

  it('rejects unsupported methods before authentication or storage', async () => {
    const res = response(); await handler(request({ method: 'PATCH' }), res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(mocks.verifyOwner).not.toHaveBeenCalled()
    expect(mocks.redisFromEnv).not.toHaveBeenCalled()
  })

  it('creates a separate owner-only detail refresh revision', async () => {
    const refreshDetail = vi.fn(async () => ({
      morning: { recordId: 'morning' }, refresh: { recordId: 'refresh', status: 'accepted' },
    }))
    const latestManifest = vi.fn(async () => ({ manifestId: 'f'.repeat(64), scanId: 'scan', records: [] }))
    const local = createOptionsAuditHandler({
      authorize: vi.fn(async () => ({ uid: 'owner' })), redisFromEnv: () => ({}), makeArchive: () => ({ archive: true }),
      latestManifest, readRecord: vi.fn(), refreshDetail, now: () => Date.parse('2026-09-22T14:00:00.000Z'),
    })
    const res = response()
    await local(request({ method: 'POST', body: { contractId: 'osi:EX' } }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(body(res).detail).toMatchObject({ morning: { recordId: 'morning' }, refresh: { recordId: 'refresh' } })
    expect(refreshDetail).toHaveBeenCalledWith(expect.objectContaining({ contractId: 'osi:EX', archive: { archive: true } }))
  })

  it('returns a fresh owner summary that becomes stale without rewriting storage', async () => {
    const publication = {
      tradingDate: '2026-09-22', state: 'theoretical', observationMode: 'theoretical', result: 'candidates',
      availableAt: '2026-09-22T13:32:00.000Z', validUntil: '2026-09-22T13:32:30.000Z', selected: [],
    }
    const dependencies = {
      authorize: vi.fn(async () => ({ uid: 'owner' })), redisFromEnv: () => ({}), makeArchive: () => ({}),
      latestManifest: vi.fn(async () => ({ manifestId: 'manifest', publication })), readRecord: vi.fn(),
    }
    let res = response()
    await createOptionsAuditHandler({ ...dependencies, now: () => Date.parse('2026-09-22T13:32:20.000Z') })(request(), res)
    expect(body(res).summary.state).toBe('theoretical')
    res = response()
    await createOptionsAuditHandler({ ...dependencies, now: () => Date.parse('2026-09-22T13:33:00.000Z') })(request(), res)
    expect(body(res).summary.state).toBe('stale')
  })
})
