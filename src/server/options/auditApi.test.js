// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ verifyOwner: vi.fn(), redisFromEnv: vi.fn(), createArchive: vi.fn(), latest: vi.fn(), record: vi.fn() }))
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: mocks.redisFromEnv } }))
vi.mock('../research/evaluationApi.js', () => ({ verifyOwner: mocks.verifyOwner }))
vi.mock('../research/archive.js', () => ({ createArchive: mocks.createArchive }))
vi.mock('./auditStore.js', () => ({ latestOptionsManifest: mocks.latest, optionsAuditRecord: mocks.record }))
import handler from './auditApi.js'

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
    expect(body(res)).toEqual({ manifest: { manifestId: 'manifest-1' } })
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

  it('rejects mutations before authentication or storage', async () => {
    const res = response(); await handler(request({ method: 'POST' }), res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(mocks.verifyOwner).not.toHaveBeenCalled()
    expect(mocks.redisFromEnv).not.toHaveBeenCalled()
  })
})
