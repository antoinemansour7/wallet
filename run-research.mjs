// Use the same admission, archive, horizons and retention as the scheduled run.
// This publishes research and uses the configured alert integration.
import handler from './api/nightly-research.js'

if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET is required')
let status = 200
await handler({ method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, query: {} }, {
  status(code) { status = code; return this },
  json(body) { console.log(JSON.stringify({ status, ...body }, null, 2)); if (status >= 400) process.exitCode = 1 },
})
