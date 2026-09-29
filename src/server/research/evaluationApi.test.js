// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ verify: vi.fn(), report: vi.fn(), redis: vi.fn(), runLog: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{ name: 'research-evaluation' }], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify }) }))
vi.mock('@upstash/redis', () => ({ Redis: { fromEnv: mocks.redis } }))
vi.mock('./evaluationSummary.js', () => ({ readEvaluationSummary: mocks.report }))
vi.mock('../runLog.js', () => ({ withRunLog: (_name, handler) => (...args) => { mocks.runLog(); return handler(...args) } }))
import handler from '../../../api/get-research.js'
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() })
const request = (extra = {}) => ({ method: 'GET', headers: { authorization: 'Bearer signed-token' }, query: { evaluation: '1' }, ...extra })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('RESEARCH_EVALUATION_OWNER', 'owner-uid')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fixture.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test')
  mocks.verify.mockResolvedValue({ uid: 'owner-uid' }); mocks.redis.mockReturnValue({ get: vi.fn() })
  mocks.report.mockResolvedValue({ arms: [], observations: [] })
})
afterEach(() => vi.unstubAllEnvs())
describe('private read-only evaluation API', () => {
  it('checks a verified owner UID before any storage access', async () => {
    const res = response(); await handler(request(), res)
    expect(mocks.verify).toHaveBeenCalledWith('signed-token', true)
    expect(mocks.report).toHaveBeenCalledOnce()
    expect(mocks.report).toHaveBeenCalledWith(mocks.redis.mock.results[0].value)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Authorization')
    expect(mocks.runLog).not.toHaveBeenCalled()
  })
  it.each([undefined, '', 'Bearer cron-secret'])('denies unverified credentials: %s', async (authorization) => {
    mocks.verify.mockRejectedValue(new Error('Invalid token'))
    const res = response(); await handler(request({ headers: { authorization } }), res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(mocks.redis).not.toHaveBeenCalled()
    expect(mocks.report).not.toHaveBeenCalled()
  })
  it('rejects another signed-in user even if query/body claim the owner identity', async () => {
    mocks.verify.mockResolvedValue({ uid: 'someone-else' })
    const res = response(); await handler(request({ query: { evaluation: '1', uid: 'owner-uid' }, body: { uid: 'owner-uid' } }), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(mocks.redis).not.toHaveBeenCalled()
  })
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('does not permit %s mutations', async (method) => {
    const res = response(); await handler(request({ method }), res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.redis).not.toHaveBeenCalled()
  })
  it('accepts the owner configured as a verified email address', async () => {
    vi.stubEnv('RESEARCH_EVALUATION_OWNER', 'owner@example.com')
    mocks.verify.mockResolvedValue({ uid: 'any-uid', email: 'Owner@Example.com', email_verified: true })
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(200)
  })
  it('refuses an unverified email that matches the configured owner', async () => {
    vi.stubEnv('RESEARCH_EVALUATION_OWNER', 'owner@example.com')
    mocks.verify.mockResolvedValue({ uid: 'any-uid', email: 'owner@example.com', email_verified: false })
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(mocks.redis).not.toHaveBeenCalled()
  })
  it('refuses a different verified email', async () => {
    vi.stubEnv('RESEARCH_EVALUATION_OWNER', 'owner@example.com')
    mocks.verify.mockResolvedValue({ uid: 'any-uid', email: 'someone@example.com', email_verified: true })
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(403)
  })
  it('fails closed when no owner is configured', async () => {
    vi.stubEnv('RESEARCH_EVALUATION_OWNER', '')
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(503)
    expect(mocks.redis).not.toHaveBeenCalled()
  })
  it('does not expose shadow observations through the normal research endpoint', async () => {
    const get = vi.fn(async (key) => key === 'research:latest' ? { picks: [{ ticker: 'LIVE' }] } : { ticker: 'SHADOW' })
    mocks.redis.mockReturnValue({ get })
    const res = response(); await handler(request({ query: {} }), res)
    expect(res.json).toHaveBeenCalledWith({ picks: [{ ticker: 'LIVE' }] })
    expect(get).toHaveBeenCalledWith('research:latest')
    expect(mocks.report).not.toHaveBeenCalled()
  })
})

// A cheap yes/no check the client polls to decide whether to show any
// owner-only navigation at all — it must never touch Redis, since its whole
// point is to be safe to call from every signed-in session, not just the
// owner's.
describe('private owner check (GET /api/get-research?owner=1)', () => {
  const request = (extra = {}) => ({ method: 'GET', headers: { authorization: 'Bearer signed-token' }, query: { owner: '1' }, ...extra })

  it('confirms a verified owner without reading any research data', async () => {
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ isOwner: true })
    expect(mocks.redis).not.toHaveBeenCalled()
  })

  it('refuses a regular signed-in user without revealing anything else', async () => {
    mocks.verify.mockResolvedValue({ uid: 'someone-else' })
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(mocks.redis).not.toHaveBeenCalled()
  })

  it('denies an unverified caller', async () => {
    mocks.verify.mockRejectedValue(new Error('Invalid token'))
    const res = response(); await handler(request(), res)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('does not permit mutations', async () => {
    const res = response(); await handler(request({ method: 'POST' }), res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(mocks.verify).not.toHaveBeenCalled()
  })
})
