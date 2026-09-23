import { OPTIONS_SCHEDULE_POLICY } from '../src/server/options/scheduler.js'
import { OPTIONS_FORWARD_CAPTURE_POLICY } from '../src/server/options/forwardCapture.js'

const action = process.argv[2] || 'check'
const token = process.env.QSTASH_TOKEN
const appUrl = process.env.OPTIONS_SCAN_BASE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL
const cronSecret = process.env.CRON_SECRET
const apiBase = new URL(process.env.QSTASH_URL || 'https://qstash.upstash.io')
if (apiBase.protocol !== 'https:' || apiBase.username || apiBase.password || apiBase.pathname !== '/') throw new Error('QSTASH_URL must be an HTTPS origin')
if (!['check', 'apply', 'remove'].includes(action)) throw new Error('Usage: npm run options:schedule -- check|apply|remove')
if (!token) throw new Error('QSTASH_TOKEN is required')
if (!appUrl) throw new Error('OPTIONS_SCAN_BASE_URL or VERCEL_PROJECT_PRODUCTION_URL is required')

// A retried capture tick arrives after the instant it was meant to observe, so
// it could never satisfy the evaluator; it would only spend daily messages.
const retries = { observe: '0' }
const schedules = Object.entries({
  ...OPTIONS_SCHEDULE_POLICY.provider.schedules,
  observe: OPTIONS_FORWARD_CAPTURE_POLICY.schedule,
}).map(([stage, cron]) => ({
  stage,
  cron,
  retries: retries[stage] || '2',
  scheduleId: `wallai-options-${stage}-v1`,
  destination: new URL(`/api/options-scan?mode=${stage}`, appUrl?.startsWith('http') ? appUrl : `https://${appUrl}`).href,
}))

async function request(path, init = {}) {
  const response = await fetch(new URL(path, apiBase), {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`QStash schedule request failed (${response.status})`)
  return body
}

if (action === 'check') {
  const existing = await request('/v2/schedules')
  const rows = Array.isArray(existing) ? existing : existing.schedules || []
  console.log(JSON.stringify(schedules.map((expected) => {
    const actual = rows.find((item) => item.scheduleId === expected.scheduleId || item.id === expected.scheduleId)
    return { stage: expected.stage, installed: Boolean(actual), cron: actual?.cron || expected.cron, destination: expected.destination }
  }), null, 2))
} else if (action === 'remove') {
  for (const schedule of schedules) await request(`/v2/schedules/${encodeURIComponent(schedule.scheduleId)}`, { method: 'DELETE' })
  console.log(JSON.stringify({ removed: schedules.map((item) => item.scheduleId) }))
} else {
  if (!cronSecret) throw new Error('CRON_SECRET is required')
  for (const schedule of schedules) {
    await request(`/v2/schedules/${encodeURIComponent(schedule.destination)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Upstash-Cron': schedule.cron,
        'Upstash-Schedule-Id': schedule.scheduleId,
        'Upstash-Method': 'POST',
        'Upstash-Retries': schedule.retries,
        'Upstash-Retry-Delay': '30s',
        'Upstash-Timeout': '300s',
        'Upstash-Forward-Authorization': `Bearer ${cronSecret}`,
      },
      body: '{}',
    })
  }
  console.log(JSON.stringify({ installed: schedules.map(({ stage, scheduleId, cron, destination }) => ({ stage, scheduleId, cron, destination })) }, null, 2))
}
