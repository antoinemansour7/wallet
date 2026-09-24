import { createHash } from 'node:crypto'
import { OPTIONS_SCHEDULE_POLICY } from './options/scheduler.js'
import { OPTIONS_FORWARD_CAPTURE_POLICY } from './options/forwardCapture.js'
import { RESEARCH_SCHEDULES } from './research/scheduleHealth.js'

// Upstash QStash is the only trigger for WallAI's scheduled jobs; the Vercel
// routes still do all of the work. Vercel Hobby cron was dropped because its
// daily jobs fire anywhere inside the declared hour. `npm run schedule` (see
// scripts/qstash-schedule.mjs and docs/research/qstash-scheduling.md) installs,
// checks and removes exactly the schedules listed here.

export const QSTASH_DEFAULT_API = 'https://qstash.upstash.io'
// QStash Free allows ten active schedules. apply refuses to go over it unless
// --schedule-limit says the plan allows more.
export const QSTASH_FREE_SCHEDULE_LIMIT = 10
// Every scheduled route has maxDuration 300 in vercel.json. QStash waits that
// long for the response; it cannot make a Vercel function run any longer.
export const QSTASH_TIMEOUT = '300s'
// A millisecond expression (e.g. `pow(2, retried) * 1000`), not a duration.
export const QSTASH_RETRY_DELAY_MS = '30000'
// The forwarded CRON_SECRET appears in the QStash console and schedule API as
// REDACTED:<sha256> instead of in plain text; deliveries still carry it.
export const QSTASH_REDACT_FIELDS = 'header[Authorization]'
const MANAGED_PREFIX = 'wallai-'
const REQUEST_TIMEOUT_MS = 15_000

const optionsSchedule = (stage, cron, retries) => ({
  id: `wallai-options-${stage}-v1`, group: 'options', name: stage, cron,
  path: `/api/options-scan?mode=${stage}`, method: 'POST', retries,
})

export const QSTASH_SCHEDULES = Object.freeze([
  ...Object.entries(OPTIONS_SCHEDULE_POLICY.provider.schedules).map(([stage, cron]) => optionsSchedule(stage, cron, 2)),
  // A retried capture tick arrives after the instant it was meant to observe, so
  // it could never satisfy the evaluator; it would only spend daily messages.
  optionsSchedule('observe', OPTIONS_FORWARD_CAPTURE_POLICY.schedule, 0),
  // Vercel cron called these with GET, in UTC, and never retried; all three are
  // kept. A retried nightly run would publish a second board, and the other jobs
  // already resume whatever a failed run left on their next slot. One schedule
  // per job, not per hour: seven foundation schedules would not fit the plan.
  ...RESEARCH_SCHEDULES.map(({ job, path, hours, minutes = [0] }) => ({
    id: `wallai-${job}-v1`, group: 'research', name: job,
    cron: `CRON_TZ=UTC ${minutes.join(',')} ${hours.join(',')} * * *`, path, method: 'GET', retries: 0,
  })),
].map((schedule) => Object.freeze(schedule)))

class UsageError extends Error {}
class ConfigError extends Error {}
export class QStashRequestError extends Error {
  constructor(message, status = null) {
    super(message)
    this.name = 'QStashRequestError'
    this.status = status
  }
}

const USAGE = `Usage: npm run schedule -- <check|apply|remove> [options]

  check    compare each expected schedule with what QStash has installed (read-only)
  apply    create or update the schedules in place; safe to re-run
  remove   delete the schedules (lists them only, unless --yes)

  --only <group|job|id>[,...]  limit to options, research, a job name or a schedule id
  --dry-run                    apply: show the requests without sending them
  --yes                        remove: actually delete
  --schedule-limit <n>         apply: active-schedule ceiling (default ${QSTASH_FREE_SCHEDULE_LIMIT}, QStash Free)

Environment: QSTASH_TOKEN, CRON_SECRET (apply; optional for check), SCHEDULE_BASE_URL
(or OPTIONS_SCAN_BASE_URL / VERCEL_PROJECT_PRODUCTION_URL), optional QSTASH_URL.`

export function parseScheduleArgs(argv = []) {
  const args = { action: null, only: [], dryRun: false, yes: false, scheduleLimit: QSTASH_FREE_SCHEDULE_LIMIT }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const [flag, inline] = arg.startsWith('--') ? arg.split(/=(.*)/s, 2) : [arg]
    const value = () => {
      const next = inline ?? argv[++index]
      if (!next || next.startsWith('--')) throw new UsageError(`${flag} needs a value`)
      return next
    }
    if (flag === '--only') args.only.push(...value().split(',').map((item) => item.trim()).filter(Boolean))
    else if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--yes') args.yes = true
    else if (flag === '--schedule-limit') {
      const limit = Number(value())
      if (!Number.isInteger(limit) || limit < 1) throw new UsageError('--schedule-limit must be a positive integer')
      args.scheduleLimit = limit
    } else if (flag === '--help' || flag === '-h') args.action = 'help'
    else if (!arg.startsWith('-') && !args.action) args.action = arg
    else throw new UsageError(`Unknown argument: ${arg}`)
  }
  args.action ||= 'check'
  if (!['check', 'apply', 'remove', 'help'].includes(args.action)) throw new UsageError(`Unknown command: ${args.action}`)
  return args
}

export function selectSchedules(only = [], schedules = QSTASH_SCHEDULES) {
  if (!only.length) return schedules
  const matches = (schedule, token) => [schedule.group, schedule.name, schedule.id].includes(token)
  const unknown = only.filter((token) => !schedules.some((schedule) => matches(schedule, token)))
  if (unknown.length) throw new UsageError(`--only matched no schedule: ${unknown.join(', ')}`)
  return schedules.filter((schedule) => only.some((token) => matches(schedule, token)))
}

function httpsOrigin(raw, name) {
  let url
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { url = null }
  // The value itself is never echoed: a mistyped variable may hold a secret.
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new ConfigError(`${name} must be an HTTPS origin with no path, query or credentials, e.g. https://example.com`)
  }
  return url.origin
}

export function resolveQStashApi(env = {}) {
  return httpsOrigin(env.QSTASH_URL?.trim() || QSTASH_DEFAULT_API, 'QSTASH_URL')
}

export function resolveBaseUrl(env = {}) {
  const source = ['SCHEDULE_BASE_URL', 'OPTIONS_SCAN_BASE_URL', 'VERCEL_PROJECT_PRODUCTION_URL'].find((name) => env[name]?.trim())
  if (!source) throw new ConfigError('SCHEDULE_BASE_URL is required: the production origin QStash calls, e.g. https://example.com (OPTIONS_SCAN_BASE_URL or VERCEL_PROJECT_PRODUCTION_URL are also read)')
  return { origin: httpsOrigin(env[source].trim(), source), source }
}

export const scheduleDestination = (schedule, origin) => new URL(schedule.path, origin).href

/** The create-or-update request for one schedule. Upstash-Schedule-Id makes it an upsert. */
export function scheduleRequest(schedule, { origin, cronSecret }) {
  const destination = scheduleDestination(schedule, origin)
  const hasBody = schedule.method !== 'GET'
  return {
    destination,
    // QStash reads the destination from the raw path: it must stay unencoded,
    // including its ?mode= query, or it is rejected as having no scheme.
    path: `/v2/schedules/${destination}`,
    method: 'POST',
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      'Upstash-Cron': schedule.cron,
      'Upstash-Schedule-Id': schedule.id,
      'Upstash-Method': schedule.method,
      'Upstash-Retries': String(schedule.retries),
      ...(schedule.retries > 0 ? { 'Upstash-Retry-Delay': QSTASH_RETRY_DELAY_MS } : {}),
      'Upstash-Timeout': QSTASH_TIMEOUT,
      'Upstash-Forward-Authorization': `Bearer ${cronSecret}`,
      'Upstash-Redact-Fields': QSTASH_REDACT_FIELDS,
    },
    ...(hasBody ? { body: '{}' } : {}),
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

/**
 * What the installed schedule forwards as Authorization, without revealing it:
 * matches, differs (plain text that is not CRON_SECRET), redacted (hash that
 * could not be tied to CRON_SECRET), present (no CRON_SECRET to compare), missing.
 */
export function authorizationStatus(header, cronSecret) {
  const entry = Object.entries(header || {}).find(([name]) => ['authorization', 'upstash-forward-authorization'].includes(name.toLowerCase()))
  const value = [entry?.[1]].flat()[0]
  if (typeof value !== 'string' || !value) return 'missing'
  if (/^REDACTED/i.test(value)) {
    const hash = /([a-f\d]{64})/i.exec(value)?.[1]?.toLowerCase()
    return cronSecret && hash && [`Bearer ${cronSecret}`, cronSecret].some((candidate) => sha256(candidate) === hash) ? 'matches' : 'redacted'
  }
  if (!cronSecret) return 'present'
  return value === `Bearer ${cronSecret}` ? 'matches' : 'differs'
}

export function compareSchedule(schedule, installed, { origin, cronSecret }) {
  if (!installed) return { state: 'missing', differences: [] }
  const differences = []
  const differ = (field, expected, actual) => { if (expected !== actual) differences.push({ field, expected, actual }) }
  differ('cron', schedule.cron, installed.cron)
  differ('destination', scheduleDestination(schedule, origin), installed.destination)
  differ('method', schedule.method, String(installed.method || 'POST').toUpperCase())
  differ('retries', schedule.retries, Number(installed.retries))
  if (schedule.retries > 0 && installed.retryDelayExpression != null) differ('retryDelay', QSTASH_RETRY_DELAY_MS, String(installed.retryDelayExpression))
  differ('paused', false, Boolean(installed.isPaused))
  const authorization = authorizationStatus(installed.header, cronSecret)
  if (authorization === 'missing' || authorization === 'differs') differences.push({ field: 'authorization', expected: 'Bearer $CRON_SECRET', actual: authorization })
  return { state: differences.length ? 'different' : 'ok', differences, authorization }
}

/** Replace anything secret-shaped before it is printed. */
export function redactSecrets(text, secrets = []) {
  let output = String(text ?? '')
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 4) output = output.split(secret).join('[redacted]')
  return output.replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
}

export function describeQStashFailure({ label, status, statusText, text, secrets = [] }) {
  let detail = text
  try {
    const body = JSON.parse(text)
    detail = body?.error || body?.message || text
  } catch { /* not JSON: keep QStash's plain-text body */ }
  detail = redactSecrets(typeof detail === 'string' ? detail : JSON.stringify(detail), secrets).replace(/\s+/g, ' ').trim().slice(0, 500) || 'no response body'
  const hint = status === 401 || status === 403 ? ' (QSTASH_TOKEN was rejected: check the token, and that QSTASH_URL is the region it belongs to)' : ''
  return `QStash ${label} failed: HTTP ${status}${statusText ? ` ${statusText}` : ''}: ${detail}${hint}`
}

export function createQStashClient({ api, token, fetchImpl = fetch, secrets = [] }) {
  async function call(label, path, init = {}, { allowStatuses = [] } = {}) {
    let response
    try {
      response = await fetchImpl(new URL(path, api), {
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      const reason = ['TimeoutError', 'AbortError'].includes(error?.name) ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s`
        : [error?.message, error?.cause?.code || error?.cause?.message].filter(Boolean).join(': ') || 'network error'
      throw new QStashRequestError(`QStash ${label} failed: ${redactSecrets(reason, secrets)}`)
    }
    const text = await response.text().catch(() => '')
    if (!response.ok && !allowStatuses.includes(response.status)) {
      throw new QStashRequestError(describeQStashFailure({ label, status: response.status, statusText: response.statusText, text, secrets }), response.status)
    }
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    return { status: response.status, body }
  }
  return {
    async list() {
      const { body } = await call('list schedules', '/v2/schedules')
      const rows = Array.isArray(body) ? body : body?.schedules
      if (!Array.isArray(rows)) throw new QStashRequestError('QStash list schedules returned an unexpected response; nothing was changed')
      return rows
    },
    upsert: (schedule, request) => call(`apply ${schedule.id}`, request.path, { method: request.method, headers: request.headers, body: request.body }),
    async remove(scheduleId) {
      const { status } = await call(`remove ${scheduleId}`, `/v2/schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' }, { allowStatuses: [404] })
      return status !== 404
    },
  }
}

function formatInstant(ms, timeZone) {
  if (!Number.isFinite(Number(ms)) || !Number(ms)) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(Number(ms))).replace(', ', ' ')
}

const describeTarget = (schedule) => `${schedule.cron}  ${schedule.method} ${schedule.path}`

async function checkSchedules({ client, selected, origin, cronSecret, out }) {
  const rows = await client.list()
  const byId = new Map(rows.map((row) => [row.scheduleId, row]))
  let healthy = 0
  for (const schedule of selected) {
    const installed = byId.get(schedule.id)
    const result = compareSchedule(schedule, installed, { origin, cronSecret })
    if (result.state === 'ok') healthy += 1
    out.log(`${{ ok: 'ok      ', missing: 'MISSING ', different: 'DIFFERS ' }[result.state]}${schedule.id}  ${describeTarget(schedule)}`)
    for (const { field, expected, actual } of result.differences) out.log(`          ${field}: expected ${JSON.stringify(expected)}, installed ${JSON.stringify(actual)}`)
    if (!installed) continue
    const next = formatInstant(installed.nextScheduleTime, 'UTC')
    const states = [...new Set(Object.values(installed.lastScheduleStates || {}).filter((state) => typeof state === 'string'))]
    const last = formatInstant(installed.lastScheduleTime, 'UTC')
    out.log(`          next ${next ? `${next} UTC = ${formatInstant(installed.nextScheduleTime, 'America/New_York')} New York` : 'not reported'}`
      + `${last ? ` · last ${last} UTC${states.length ? ` (${states.join(', ')})` : ''}` : ''} · auth ${result.authorization}`)
  }
  const managed = new Set(QSTASH_SCHEDULES.map((schedule) => schedule.id))
  const stray = rows.filter((row) => String(row.scheduleId || '').startsWith(MANAGED_PREFIX) && !managed.has(row.scheduleId))
  if (stray.length) out.log(`Not in the catalog (left untouched): ${stray.map((row) => row.scheduleId).join(', ')}`)
  if (!cronSecret) out.log('CRON_SECRET is not set, so the forwarded Authorization header was only checked for presence.')
  out.log(`${healthy}/${selected.length} expected schedules installed and matching; ${rows.length} active schedule(s) in this QStash account.`)
  return healthy === selected.length ? 0 : 1
}

async function applySchedules({ client, selected, origin, cronSecret, args, out }) {
  if (!cronSecret && !args.dryRun) throw new ConfigError('CRON_SECRET is required for apply: QStash forwards it as the Authorization header the routes check')
  const planned = selected.map((schedule) => ({ schedule, request: scheduleRequest(schedule, { origin, cronSecret: cronSecret || 'CRON_SECRET' }) }))
  // Read first, so a plan that would overflow the schedule limit changes nothing
  // instead of failing halfway through.
  const rows = await client.list()
  const installed = new Set(rows.map((row) => row.scheduleId))
  const total = rows.length + planned.filter(({ schedule }) => !installed.has(schedule.id)).length
  if (total > args.scheduleLimit) {
    throw new ConfigError(`apply would leave ${total} active schedules, over the limit of ${args.scheduleLimit} (QStash Free allows ${QSTASH_FREE_SCHEDULE_LIMIT}). Nothing was changed. Remove unused schedules, or pass --schedule-limit if your plan allows more.`)
  }
  let failed = 0
  for (const { schedule, request } of planned) {
    const verb = installed.has(schedule.id) ? 'update' : 'create'
    if (args.dryRun) {
      const headers = { ...request.headers, 'Upstash-Forward-Authorization': 'Bearer $CRON_SECRET' }
      out.log(`would ${verb} ${schedule.id}\n  POST ${request.path}\n${Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`).join('\n')}${request.body ? `\n  body: ${request.body}` : ''}`)
      continue
    }
    try {
      await client.upsert(schedule, request)
      out.log(`${verb}d ${schedule.id}  ${describeTarget(schedule)}`)
    } catch (error) {
      failed += 1
      out.error(error.message)
    }
  }
  if (args.dryRun) out.log(`Dry run: nothing was sent. ${total} active schedule(s) after apply.`)
  else if (failed) out.log(`${failed} of ${planned.length} schedules failed; the others were applied. Re-running apply is safe.`)
  else out.log(`Applied ${planned.length} schedule(s); ${total} active in this QStash account. Verify with: npm run schedule -- check`)
  return failed ? 1 : 0
}

async function removeSchedules({ client, selected, args, out }) {
  const rows = await client.list()
  const installed = new Set(rows.map((row) => row.scheduleId))
  const targets = selected.filter((schedule) => installed.has(schedule.id))
  const absent = selected.filter((schedule) => !installed.has(schedule.id))
  if (absent.length) out.log(`Not installed: ${absent.map((schedule) => schedule.id).join(', ')}`)
  if (!targets.length) { out.log('Nothing to remove.'); return 0 }
  if (!args.yes) {
    out.log(`Would delete: ${targets.map((schedule) => schedule.id).join(', ')}`)
    out.log('Nothing was deleted. Re-run with --yes to delete. A removed schedule stops that job: there is no Vercel cron behind it.')
    return 0
  }
  let failed = 0
  for (const schedule of targets) {
    try { out.log(`${await client.remove(schedule.id) ? 'deleted' : 'already absent'} ${schedule.id}`) }
    catch (error) { failed += 1; out.error(error.message) }
  }
  return failed ? 1 : 0
}

function secretFromEnv(env, name) {
  const value = env[name]
  if (!value) return null
  if (value !== value.trim()) throw new ConfigError(`${name} has leading or trailing whitespace`)
  return value
}

/** The whole CLI, with I/O injected so it can be exercised without QStash. Returns the exit code. */
export async function runScheduleCommand({ argv = [], env = process.env, fetchImpl = fetch, out = console } = {}) {
  let secrets = []
  try {
    const args = parseScheduleArgs(argv)
    if (args.action === 'help') { out.log(USAGE); return 0 }
    const selected = selectSchedules(args.only)
    const token = secretFromEnv(env, 'QSTASH_TOKEN')
    const cronSecret = secretFromEnv(env, 'CRON_SECRET')
    secrets = [token, cronSecret]
    if (!token) throw new ConfigError('QSTASH_TOKEN is required')
    const api = resolveQStashApi(env)
    const { origin, source } = resolveBaseUrl(env)
    const client = createQStashClient({ api, token, fetchImpl, secrets })
    out.log(`QStash ${api} · destinations on ${origin} (from ${source}) · ${selected.length} schedule(s)`)
    const context = { client, selected, origin, cronSecret, args, out }
    if (args.action === 'check') return await checkSchedules(context)
    if (args.action === 'apply') return await applySchedules(context)
    return await removeSchedules(context)
  } catch (error) {
    if (error instanceof UsageError) { out.error(`${error.message}\n\n${USAGE}`); return 2 }
    if (error instanceof ConfigError) { out.error(error.message); return 2 }
    out.error(redactSecrets(error instanceof QStashRequestError ? error.message : error?.stack || error, secrets))
    return 1
  }
}
