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
  it.each([
    { method: 'GET', query: { view: 'research' } },
    { method: 'GET', query: { view: 'research', manifestId: 'f'.repeat(64), contractId: 'osi:EX' } },
    { method: 'GET', query: { view: 'operations' } },
    { method: 'GET', query: { view: 'shadow' } },
    { method: 'GET', query: { view: 'results' } },
    { method: 'GET', query: { recordType: 'scenario', recordId: 'a'.repeat(64) } },
    { method: 'POST', body: { manifestId: 'f'.repeat(64), contractId: 'osi:EX' } },
  ])('enforces ownership on direct research, detail, lineage, operations and refresh requests: %j', async (overrides) => {
    mocks.verifyOwner.mockResolvedValue({ status: 403, error: 'Owner access required' })
    const res = response(); await handler(request(overrides), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(mocks.redisFromEnv).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it.each(['GET', 'POST'])('pins %s research/detail requests to an immutable morning reference', async (method) => {
    const manifest = { manifestId: 'f'.repeat(64), scanId: 'original', records: [] }
    const archive = { get: vi.fn(async () => manifest) }
    const buildResearch = vi.fn(async () => ({ manifestId: manifest.manifestId }))
    const refreshDetail = vi.fn(async () => ({ morning: { manifestId: manifest.manifestId } }))
    const local = createOptionsAuditHandler({ makeArchive: () => archive, buildResearch, refreshDetail })
    const res = response()
    await local(request({ method, query: { view: 'research', manifestId: manifest.manifestId }, body: { contractId: 'osi:EX' } }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.latest).not.toHaveBeenCalled()
    expect(archive.get).toHaveBeenCalledWith('options-manifest', manifest.manifestId)
    expect(method === 'GET' ? buildResearch : refreshDetail).toHaveBeenCalledWith(expect.objectContaining({ manifest }))
  })

  it('rejects malformed or absent morning references without falling back to latest', async () => {
    const archive = { get: vi.fn(async () => null) }
    const local = createOptionsAuditHandler({ makeArchive: () => archive })
    let res = response()
    await local(request({ query: { view: 'research', manifestId: '../other' } }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(archive.get).not.toHaveBeenCalled()
    res = response()
    await local(request({ query: { view: 'research', manifestId: 'f'.repeat(64) } }), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(mocks.latest).not.toHaveBeenCalled()
  })
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

  it('serves the owner-only operations report on ?view=operations, same gate as everything else', async () => {
    const buildReport = vi.fn(async () => ({ policyVersion: 'options-operations-diagnostics-v1', status: 'ok' }))
    const local = createOptionsAuditHandler({
      authorize: vi.fn(async () => ({ uid: 'owner' })), redisFromEnv: () => ({ fixture: 'redis' }), makeArchive: () => ({ fixture: 'archive' }),
      latestManifest: vi.fn(), readRecord: vi.fn(), buildReport, now: () => Date.parse('2026-09-22T14:00:00.000Z'),
    })
    const res = response()
    await local(request({ query: { view: 'operations' } }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(body(res)).toEqual({ operations: { policyVersion: 'options-operations-diagnostics-v1', status: 'ok' } })
    expect(buildReport).toHaveBeenCalledWith(expect.objectContaining({ archive: { fixture: 'archive' }, redis: { fixture: 'redis' } }))
  })

  it('denies the operations view to a non-owner exactly like every other private read', async () => {
    mocks.verifyOwner.mockResolvedValue({ status: 403, error: 'Owner access required' })
    const res = response(); await handler(request({ query: { view: 'operations' } }), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(mocks.redisFromEnv).not.toHaveBeenCalled()
  })

  it('never leaks a raw storage error through the operations view; it degrades to the same sanitized 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const local = createOptionsAuditHandler({
      authorize: vi.fn(async () => ({ uid: 'owner' })), redisFromEnv: () => ({}), makeArchive: () => ({}),
      latestManifest: vi.fn(), readRecord: vi.fn(),
      buildReport: vi.fn(async () => { throw new Error('ERR max requests limit exceeded; secret-provider-detail') }),
    })
    const res = response()
    await local(request({ query: { view: 'operations' } }), res)
    expect(res.status).toHaveBeenCalledWith(503)
    expect(JSON.stringify(body(res))).not.toContain('secret-provider-detail')
  })

  it('serves the read-only shadow-test dashboard on ?view=shadow without resolving a morning', async () => {
    const buildShadow = vi.fn(async () => ({ policyVersion: 'options-shadow-dashboard-v1', rows: [] }))
    const latestManifest = vi.fn()
    const local = createOptionsAuditHandler({
      authorize: vi.fn(async () => ({ uid: 'owner' })), redisFromEnv: () => ({ fixture: 'redis' }), makeArchive: () => ({ fixture: 'archive' }),
      latestManifest, readRecord: vi.fn(), buildShadow, now: () => Date.parse('2026-09-22T14:00:00.000Z'),
    })
    const res = response()
    await local(request({ query: { view: 'shadow' } }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(body(res)).toEqual({ shadow: { policyVersion: 'options-shadow-dashboard-v1', rows: [] } })
    expect(buildShadow).toHaveBeenCalledWith(expect.objectContaining({ archive: { fixture: 'archive' } }))
    expect(latestManifest).not.toHaveBeenCalled()
  })

  it('serves the plain results pages on ?view=results from the same shadow evaluation', async () => {
    const buildShadow = vi.fn(async () => ({ checkedAt: '2026-09-22T14:00:00.000Z', days: [{ tradingDate: '2026-09-22', status: 'empty', candidates: 0 }], rows: [] }))
    const local = createOptionsAuditHandler({
      authorize: vi.fn(async () => ({ uid: 'owner' })), redisFromEnv: () => ({}), makeArchive: () => ({}),
      latestManifest: vi.fn(), readRecord: vi.fn(), buildShadow, now: () => Date.parse('2026-09-22T14:00:00.000Z'),
    })
    const res = response()
    await local(request({ query: { view: 'results' } }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(body(res).results).toMatchObject({ checkedAt: '2026-09-22T14:00:00.000Z', winDay: 3, days: [{ tradingDate: '2026-09-22', status: 'empty', picks: [] }] })
  })

  it('refuses to change anything through the results view', async () => {
    const buildShadow = vi.fn()
    const local = createOptionsAuditHandler({ authorize: vi.fn(async () => ({ uid: 'owner' })), redisFromEnv: () => ({}), makeArchive: () => ({}), buildShadow, refreshDetail: vi.fn() })
    const res = response()
    await local(request({ method: 'POST', query: { view: 'results' }, body: {} }), res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(buildShadow).not.toHaveBeenCalled()
  })

  it('refuses to change anything through the shadow view', async () => {
    const buildShadow = vi.fn()
    const local = createOptionsAuditHandler({ authorize: vi.fn(async () => ({ uid: 'owner' })), redisFromEnv: () => ({}), makeArchive: () => ({}), buildShadow, refreshDetail: vi.fn() })
    const res = response()
    await local(request({ method: 'POST', query: { view: 'shadow' }, body: {} }), res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(buildShadow).not.toHaveBeenCalled()
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
