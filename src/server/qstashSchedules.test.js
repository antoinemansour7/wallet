// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  QSTASH_FREE_SCHEDULE_LIMIT, QSTASH_SCHEDULES, QSTASH_TIMEOUT,
  authorizationStatus, parseScheduleArgs, resolveBaseUrl, resolveQStashApi,
  runScheduleCommand, scheduleRequest, selectSchedules,
} from './qstashSchedules.js'

const TOKEN = 'qstash-token-abcdef123456'
const SECRET = 'cron-secret-987654zyx'
const ORIGIN = 'https://wallai.test'
const env = (extra = {}) => ({ QSTASH_TOKEN: TOKEN, CRON_SECRET: SECRET, SCHEDULE_BASE_URL: ORIGIN, ...extra })
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const byId = (id) => QSTASH_SCHEDULES.find((schedule) => schedule.id === id)
const repoFile = (path) => new URL(`../../${path}`, import.meta.url)

// Enough of the QStash schedules API to exercise the CLI: list, upsert by
// Upstash-Schedule-Id, delete, bearer auth, and injectable failures.
function fakeQStash({ schedules = [], fail = {} } = {}) {
  const store = new Map(schedules.map((row) => [row.scheduleId, row]))
  const calls = []
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const { pathname, search } = new URL(url)
    const method = init.method || 'GET'
    calls.push({ method, path: `${pathname}${search}`, headers: init.headers, body: init.body })
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return new Response('{"error":"unauthorized"}', { status: 401, statusText: 'Unauthorized' })
    if (method === 'GET' && pathname === '/v2/schedules') return Response.json([...store.values()])
    if (method === 'POST' && pathname.startsWith('/v2/schedules/')) {
      const id = init.headers['Upstash-Schedule-Id']
      if (fail[id]) return new Response(fail[id].body, { status: fail[id].status, statusText: fail[id].statusText })
      store.set(id, {
        scheduleId: id, cron: init.headers['Upstash-Cron'], destination: `${pathname.slice('/v2/schedules/'.length)}${search}`,
        method: init.headers['Upstash-Method'], retries: Number(init.headers['Upstash-Retries']), retryDelayExpression: init.headers['Upstash-Retry-Delay'],
        header: { Authorization: [`REDACTED:${sha256(init.headers['Upstash-Forward-Authorization'])}`] },
        isPaused: false, nextScheduleTime: Date.parse('2026-11-02T12:00:00Z'),
      })
      return Response.json({ scheduleId: id })
    }
    if (method === 'DELETE') {
      return store.delete(decodeURIComponent(pathname.split('/').pop())) ? new Response(null, { status: 200 }) : new Response('{"error":"schedule not found"}', { status: 404 })
    }
    return new Response('not found', { status: 404 })
  })
  return { fetchImpl, calls, store }
}

async function run(argv, { qstash = fakeQStash(), environment = env() } = {}) {
  const lines = []
  const out = { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) }
  const code = await runScheduleCommand({ argv, env: environment, fetchImpl: qstash.fetchImpl, out })
  const text = lines.join('\n')
  expect(text).not.toContain(TOKEN)
  expect(text).not.toContain(SECRET)
  return { code, text, qstash }
}

describe('QStash schedule catalog', () => {
  it('lists every schedule QStash should hold, with its exact trigger', () => {
    expect(QSTASH_SCHEDULES.map(({ id, cron, method, path, retries }) => ({ id, cron, method, path, retries }))).toEqual([
      { id: 'wallai-options-premarket-v1', cron: 'CRON_TZ=America/New_York 15 9 * * 1-5', method: 'POST', path: '/api/options-scan?mode=premarket', retries: 2 },
      { id: 'wallai-options-opening-v1', cron: 'CRON_TZ=America/New_York 31 9 * * 1-5', method: 'POST', path: '/api/options-scan?mode=opening', retries: 2 },
      { id: 'wallai-options-observe-v1', cron: 'CRON_TZ=America/New_York * 9-15 * * 1-5', method: 'POST', path: '/api/options-scan?mode=observe', retries: 0 },
      { id: 'wallai-research-foundation-v1', cron: 'CRON_TZ=UTC 0 1,4,10,13,16,19,22 * * *', method: 'GET', path: '/api/research-foundation', retries: 0 },
      { id: 'wallai-nightly-research-v1', cron: 'CRON_TZ=UTC 0 7 * * *', method: 'GET', path: '/api/nightly-research', retries: 0 },
      { id: 'wallai-research-reports-v1', cron: 'CRON_TZ=UTC 0 9 * * *', method: 'GET', path: '/api/nightly-research?mode=reports', retries: 0 },
      { id: 'wallai-track-performance-v1', cron: 'CRON_TZ=UTC 0 9 * * *', method: 'GET', path: '/api/track-performance', retries: 0 },
      { id: 'wallai-research-evaluation-v1', cron: 'CRON_TZ=UTC 0 11 * * *', method: 'GET', path: '/api/research-evaluation', retries: 0 },
    ])
  })

  it('states a real time zone on every schedule and fits in QStash Free', () => {
    for (const { cron } of QSTASH_SCHEDULES) {
      const [, zone, fields] = /^CRON_TZ=(\S+) (.+)$/.exec(cron)
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone })).not.toThrow()
      expect(fields.split(' ')).toHaveLength(5)
    }
    const ids = QSTASH_SCHEDULES.map((schedule) => schedule.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('wallai-'))).toBe(true)
    expect(ids.length).toBeLessThanOrEqual(QSTASH_FREE_SCHEDULE_LIMIT)
  })

  it('leaves Vercel cron nothing to run twice, and never waits past a function limit', () => {
    const config = JSON.parse(readFileSync(repoFile('vercel.json'), 'utf8'))
    expect(config.crons).toBeUndefined()
    expect(QSTASH_TIMEOUT).toBe('300s')
    for (const schedule of QSTASH_SCHEDULES) {
      const file = `api/${new URL(schedule.path, ORIGIN).pathname.slice('/api/'.length)}.js`
      expect(existsSync(repoFile(file))).toBe(true)
      expect(config.functions[file]?.maxDuration).toBe(300)
    }
  })

  it('keeps options:schedule scoped to the options schedules', () => {
    const scripts = JSON.parse(readFileSync(repoFile('package.json'), 'utf8')).scripts
    expect(scripts['options:schedule']).toBe('node scripts/qstash-schedule.mjs --only options')
    expect(scripts.schedule).toBe('node scripts/qstash-schedule.mjs')
    expect(selectSchedules(['options']).map((schedule) => schedule.name)).toEqual(['premarket', 'opening', 'observe'])
    expect(selectSchedules(['research', 'wallai-options-observe-v1'])).toHaveLength(6)
  })
})

describe('scheduleRequest', () => {
  it('sends the options destination raw, with its retry policy and JSON body', () => {
    expect(scheduleRequest(byId('wallai-options-premarket-v1'), { origin: ORIGIN, cronSecret: SECRET })).toEqual({
      destination: 'https://wallai.test/api/options-scan?mode=premarket',
      path: '/v2/schedules/https://wallai.test/api/options-scan?mode=premarket',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Upstash-Cron': 'CRON_TZ=America/New_York 15 9 * * 1-5',
        'Upstash-Schedule-Id': 'wallai-options-premarket-v1',
        'Upstash-Method': 'POST',
        'Upstash-Retries': '2',
        'Upstash-Retry-Delay': '30000',
        'Upstash-Timeout': '300s',
        'Upstash-Forward-Authorization': `Bearer ${SECRET}`,
        'Upstash-Redact-Fields': 'header[Authorization]',
      },
      body: '{}',
    })
  })

  it('calls research routes exactly as Vercel cron did: GET, no body, no retries', () => {
    expect(scheduleRequest(byId('wallai-research-reports-v1'), { origin: ORIGIN, cronSecret: SECRET })).toEqual({
      destination: 'https://wallai.test/api/nightly-research?mode=reports',
      path: '/v2/schedules/https://wallai.test/api/nightly-research?mode=reports',
      method: 'POST',
      headers: {
        'Upstash-Cron': 'CRON_TZ=UTC 0 9 * * *',
        'Upstash-Schedule-Id': 'wallai-research-reports-v1',
        'Upstash-Method': 'GET',
        'Upstash-Retries': '0',
        'Upstash-Timeout': '300s',
        'Upstash-Forward-Authorization': `Bearer ${SECRET}`,
        'Upstash-Redact-Fields': 'header[Authorization]',
      },
    })
  })
})

describe('runScheduleCommand', () => {
  it('reports every schedule missing from an empty account and exits non-zero', async () => {
    const { code, text, qstash } = await run(['check'])
    expect(code).toBe(1)
    expect(text.match(/^MISSING /gm)).toHaveLength(QSTASH_SCHEDULES.length)
    expect(text).toContain('0/8 expected schedules installed and matching')
    expect(qstash.calls.map((call) => call.method)).toEqual(['GET'])
  })

  it('installs every schedule idempotently, then verifies them', async () => {
    const qstash = fakeQStash()
    const first = await run(['apply'], { qstash })
    expect(first.code).toBe(0)
    const posts = qstash.calls.filter((call) => call.method === 'POST')
    expect(posts.map((call) => call.path)).toEqual(QSTASH_SCHEDULES.map((schedule) => `/v2/schedules/${ORIGIN}${schedule.path}`))
    expect(first.text.match(/^created /gm)).toHaveLength(8)

    const second = await run(['apply'], { qstash })
    expect(second.code).toBe(0)
    expect(second.text.match(/^updated /gm)).toHaveLength(8)
    const again = qstash.calls.filter((call) => call.method === 'POST').slice(8)
    expect(again).toEqual(posts)
    expect(qstash.store.size).toBe(8)

    const check = await run(['check'], { qstash })
    expect(check.code).toBe(0)
    expect(check.text).toContain('8/8 expected schedules installed and matching; 8 active schedule(s)')
    // After the November DST change, 12:00 UTC is 07:00 in New York.
    expect(check.text).toContain('next 2026-11-02 12:00 UTC = 2026-11-02 07:00 New York')
    expect(check.text.match(/auth matches/g)).toHaveLength(8)
  })

  it('names each drift without printing the installed credential', async () => {
    const qstash = fakeQStash()
    await run(['apply'], { qstash })
    qstash.store.set('wallai-nightly-research-v1', { ...qstash.store.get('wallai-nightly-research-v1'), cron: '0 7 * * *', isPaused: true, header: {} })
    qstash.store.set('wallai-track-performance-v1', { ...qstash.store.get('wallai-track-performance-v1'), method: 'POST', header: { Authorization: ['Bearer old-secret-value'] } })
    qstash.store.set('wallai-options-premarket-v0', { scheduleId: 'wallai-options-premarket-v0', cron: '0 0 * * *' })
    const { code, text } = await run(['check'], { qstash })
    expect(code).toBe(1)
    expect(text).toContain('DIFFERS wallai-nightly-research-v1')
    expect(text).toContain('cron: expected "CRON_TZ=UTC 0 7 * * *", installed "0 7 * * *"')
    expect(text).toContain('paused: expected false, installed true')
    expect(text).toContain('authorization: expected "Bearer $CRON_SECRET", installed "missing"')
    expect(text).toContain('method: expected "GET", installed "POST"')
    expect(text).toContain('authorization: expected "Bearer $CRON_SECRET", installed "differs"')
    expect(text).not.toContain('old-secret-value')
    expect(text).toContain('Not in the catalog (left untouched): wallai-options-premarket-v0')
    expect(text).toContain('6/8 expected schedules installed and matching')
  })

  it('refuses before writing anything when apply would exceed the schedule limit', async () => {
    const others = Array.from({ length: 6 }, (_, index) => ({ scheduleId: `other-${index}`, cron: '0 0 * * *' }))
    const qstash = fakeQStash({ schedules: others })
    const refused = await run(['apply'], { qstash })
    expect(refused.code).toBe(2)
    expect(refused.text).toContain('apply would leave 14 active schedules, over the limit of 10')
    expect(qstash.calls.filter((call) => call.method === 'POST')).toEqual([])

    const allowed = await run(['apply', '--schedule-limit', '20'], { qstash })
    expect(allowed.code).toBe(0)
    expect(qstash.store.size).toBe(14)
  })

  it("reports QStash's own reason and status for a rejected schedule, and applies the rest", async () => {
    const qstash = fakeQStash({ fail: { 'wallai-nightly-research-v1': {
      status: 400, statusText: 'Bad Request', body: JSON.stringify({ error: `invalid cron expression (sent Bearer ${SECRET} with ${TOKEN})` }),
    } } })
    const { code, text } = await run(['apply'], { qstash })
    expect(code).toBe(1)
    expect(text).toContain('QStash apply wallai-nightly-research-v1 failed: HTTP 400 Bad Request: invalid cron expression (sent Bearer [redacted] with [redacted])')
    expect(text).toContain('1 of 8 schedules failed; the others were applied. Re-running apply is safe.')
    expect(qstash.store.size).toBe(7)
  })

  it('explains a rejected token and an unreachable QStash', async () => {
    const rejected = await run(['check'], { environment: env({ QSTASH_TOKEN: 'wrong-token-value' }) })
    expect(rejected.code).toBe(1)
    expect(rejected.text).toContain('QStash list schedules failed: HTTP 401 Unauthorized: unauthorized (QSTASH_TOKEN was rejected')
    expect(rejected.text).not.toContain('wrong-token-value')

    const offline = { fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }) }) }
    const unreachable = await run(['check'], { qstash: offline })
    expect(unreachable.code).toBe(1)
    expect(unreachable.text).toContain('QStash list schedules failed: fetch failed: ENOTFOUND')
  })

  it('needs CRON_SECRET to apply, but not to preview', async () => {
    const qstash = fakeQStash()
    const missing = await run(['apply'], { qstash, environment: env({ CRON_SECRET: '' }) })
    expect(missing.code).toBe(2)
    expect(missing.text).toContain('CRON_SECRET is required for apply')

    const preview = await run(['apply', '--dry-run', '--only', 'wallai-research-reports-v1'], { qstash, environment: env({ CRON_SECRET: '' }) })
    expect(preview.code).toBe(0)
    expect(preview.text).toContain('would create wallai-research-reports-v1\n  POST /v2/schedules/https://wallai.test/api/nightly-research?mode=reports')
    expect(preview.text).toContain('Upstash-Forward-Authorization: Bearer $CRON_SECRET')
    expect(qstash.calls.filter((call) => call.method !== 'GET')).toEqual([])
  })

  it('removes only managed schedules, and only with --yes', async () => {
    const qstash = fakeQStash({ schedules: [{ scheduleId: 'someone-else', cron: '0 0 * * *' }] })
    await run(['apply'], { qstash })
    const preview = await run(['remove', '--only', 'research'], { qstash })
    expect(preview.code).toBe(0)
    expect(preview.text).toContain('Nothing was deleted. Re-run with --yes to delete.')
    expect(qstash.store.size).toBe(9)

    const removed = await run(['remove', '--only', 'research', '--yes'], { qstash })
    expect(removed.code).toBe(0)
    expect(removed.text.match(/^deleted /gm)).toHaveLength(5)
    expect([...qstash.store.keys()].sort()).toEqual(['someone-else', 'wallai-options-observe-v1', 'wallai-options-opening-v1', 'wallai-options-premarket-v1'])
    expect((await run(['remove', '--only', 'research', '--yes'], { qstash })).text).toContain('Nothing to remove.')
  })

  it.each([
    [{ QSTASH_TOKEN: '' }, 'QSTASH_TOKEN is required'],
    [{ SCHEDULE_BASE_URL: '' }, 'SCHEDULE_BASE_URL is required'],
    [{ SCHEDULE_BASE_URL: 'http://wallai.test' }, 'SCHEDULE_BASE_URL must be an HTTPS origin'],
    [{ SCHEDULE_BASE_URL: 'https://wallai.test/api' }, 'SCHEDULE_BASE_URL must be an HTTPS origin'],
    [{ SCHEDULE_BASE_URL: 'https://user:pass@wallai.test' }, 'SCHEDULE_BASE_URL must be an HTTPS origin'],
    [{ QSTASH_URL: 'http://qstash.upstash.io' }, 'QSTASH_URL must be an HTTPS origin'],
    [{ CRON_SECRET: `${SECRET}\n` }, 'CRON_SECRET has leading or trailing whitespace'],
  ])('rejects %j before contacting QStash', async (override, message) => {
    const qstash = fakeQStash()
    const { code, text } = await run(['check'], { qstash, environment: env(override) })
    expect(code).toBe(2)
    expect(text).toContain(message)
    expect(text).not.toContain('user:pass')
    expect(qstash.fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects unknown commands, flags and selections', async () => {
    expect((await run(['deploy'])).code).toBe(2)
    expect((await run(['check', '--force'])).code).toBe(2)
    const unknown = await run(['check', '--only', 'plaid'])
    expect(unknown.code).toBe(2)
    expect(unknown.text).toContain('--only matched no schedule: plaid')
  })
})

describe('configuration helpers', () => {
  it('parses flags in any position, defaulting to a read-only check', () => {
    expect(parseScheduleArgs([])).toMatchObject({ action: 'check', only: [], dryRun: false, yes: false, scheduleLimit: 10 })
    expect(parseScheduleArgs(['--only', 'options', 'apply', '--dry-run'])).toMatchObject({ action: 'apply', only: ['options'], dryRun: true })
    expect(parseScheduleArgs(['remove', '--only=research,wallai-options-observe-v1', '--yes'])).toMatchObject({ only: ['research', 'wallai-options-observe-v1'], yes: true })
  })

  it('resolves the production origin and QStash region', () => {
    expect(resolveBaseUrl({ OPTIONS_SCAN_BASE_URL: 'wallai.test' })).toEqual({ origin: 'https://wallai.test', source: 'OPTIONS_SCAN_BASE_URL' })
    expect(resolveBaseUrl({ SCHEDULE_BASE_URL: 'https://a.test/', OPTIONS_SCAN_BASE_URL: 'https://b.test' }).origin).toBe('https://a.test')
    expect(resolveBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'wallai.vercel.app' }).origin).toBe('https://wallai.vercel.app')
    expect(resolveQStashApi({})).toBe('https://qstash.upstash.io')
    expect(resolveQStashApi({ QSTASH_URL: 'https://qstash-us-east-1.upstash.io/' })).toBe('https://qstash-us-east-1.upstash.io')
  })

  it('verifies the forwarded credential without needing to see it', () => {
    expect(authorizationStatus({ Authorization: [`REDACTED:${sha256(`Bearer ${SECRET}`)}`] }, SECRET)).toBe('matches')
    expect(authorizationStatus({ authorization: [`REDACTED:${sha256('Bearer rotated')}`] }, SECRET)).toBe('redacted')
    expect(authorizationStatus({ Authorization: ['REDACTED:opaque'] }, SECRET)).toBe('redacted')
    expect(authorizationStatus({ Authorization: [`Bearer ${SECRET}`] }, SECRET)).toBe('matches')
    expect(authorizationStatus({ Authorization: ['Bearer rotated'] }, SECRET)).toBe('differs')
    expect(authorizationStatus({ Authorization: ['Bearer anything'] }, null)).toBe('present')
    expect(authorizationStatus({ 'Upstash-Forward-Authorization': [`Bearer ${SECRET}`] }, SECRET)).toBe('matches')
    expect(authorizationStatus({}, SECRET)).toBe('missing')
    expect(authorizationStatus(undefined, SECRET)).toBe('missing')
  })
})
