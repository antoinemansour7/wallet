import { randomUUID } from 'node:crypto'
import { Redis } from '@upstash/redis'
import { createArchive, digest } from './archive.js'
import { ingestIssuerBudget } from './policy.js'
import { loadSecurityMaster, refreshSecurityMaster, MASTER_MAX_AGE_MS } from './securityMaster.js'
import { createSecClient, ingestIssuer, parseDailyIndex } from './secDisclosures.js'
import { archiveAttentionSignals } from './evidence.js'
import { candidatesFromEvidence } from './admission.js'

// Nightly discovery reads the durable cache only. Basic pagination belongs to
// ingestion so a rate limit or provider outage cannot consume the review budget.
export async function loadFoundation({ redis = Redis.fromEnv(), archive = createArchive(redis), refresh = false, forceMasterRefresh = false,
  now = new Date().toISOString(), masterOptions = {} } = {}) {
  let master = await loadSecurityMaster(archive, now)
  const latest = master.snapshots.at(-1)
  let masterRefresh = { status: 'cached' }
  if (refresh && (forceMasterRefresh || !latest || Date.parse(now) - Date.parse(latest.asOf) >= MASTER_MAX_AGE_MS)) {
    try {
      const result = await refreshSecurityMaster(archive, { redis, ...masterOptions })
      masterRefresh = { status: result.complete ? 'refreshed' : 'pending' }
      if (result.complete) master = await loadSecurityMaster(archive)
    } catch (error) {
      if (!latest) throw error
      masterRefresh = { status: 'stale', error: error.message }
    }
  }
  if (!master.securities().length) throw new Error('No complete US common-stock master available; run research-foundation (Basic pagination may resume on the next daily run)')
  return { redis, archive, master, masterRefresh }
}

export async function collectFoundationCandidates(signals, attentionBoard, { archive, master, asOf = new Date().toISOString(), evidence: supplied } = {}) {
  const attention = await archiveAttentionSignals(signals, master, archive, asOf)
  // Attention is reviewed in this run but cannot be acted on until latency has
  // elapsed. The review budget is independent of the eventual executable time.
  const primary = supplied || await archive.list('evidence', asOf, { since: Date.parse(asOf) - 14 * 86400000 })
  const recent = primary.filter((e) => e.strategyFamily !== 'attention' && Date.parse(e.publicAt) >= Date.parse(asOf) - 14 * 86400000)
  return candidatesFromEvidence([...attention, ...recent], attentionBoard).map((candidate) => {
    const matches = master.resolve({ securityId: candidate.securityId, asOf })
    if (matches.length !== 1 || matches[0].issuerId !== candidate.issuerId) return { ...candidate, securityId: null }
    return { ...candidate, ...matches[0] }
  })
}

// Separate, resumable ingestion job: the nightly ranking request never waits
// for a whole-universe filing crawl. The daily SEC index is independent of X.
export async function syncFoundation(options = {}) {
  const redis = options.redis || Redis.fromEnv()
  const lock = 'research:foundation:lock:v1', token = randomUUID()
  // Vercel may retry a cron, and a manual invocation may overlap it. Keep the
  // pagination checkpoint and the free-key request cadence single-writer.
  if (!await redis.set(lock, token, { nx: true, ex: 360 })) return { skipped: 'already_running', completed: [], errors: [] }
  try { return await syncUnlocked({ ...options, redis }) }
  finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [lock], [token])
  }
}

async function syncUnlocked({ redis = Redis.fromEnv(), archive = createArchive(redis), deadline = Date.now() + 240000, client, maxIssuers = ingestIssuerBudget(), now = new Date().toISOString(), refresh = true, forceMasterRefresh = false } = {}) {
  if (!Number.isInteger(maxIssuers) || maxIssuers < 1) throw new Error('maxIssuers must be positive')
  const { master, masterRefresh } = await loadFoundation({ redis, archive, refresh, forceMasterRefresh, now, masterOptions: { deadline: Math.min(deadline, Date.now() + 120000) } })
  const errors = []
  // Identity comes from the reference provider; only disclosure ingestion needs
  // an identifying SEC User-Agent. Built in the parameter list, a missing one
  // threw before the master could publish — and with no master nightly research
  // cannot resolve a ticker from any source, so an ingestion credential quietly
  // decided whether any research ran at all. Its absence now costs filings, not
  // identity, and says so in the run's errors.
  let secClient = client
  if (!secClient) {
    try { secClient = createSecClient({ deadline }) }
    catch (error) { errors.push({ stage: 'sec-client', message: error.message }) }
  }
  // A bootstrap may publish identity after this invocation's starting timestamp.
  const identityAt = new Date(Math.max(Date.parse(now), Date.parse(master.snapshots.at(-1).asOf))).toISOString()
  const pending = 'research:disclosures:pending:v1'
  // Retry the last seven complete UTC days; immutable jobs deduplicate retries.
  for (let ago = 1; secClient && ago <= 7; ago++) {
    if (Date.now() + 20000 >= deadline) break
    const date = new Date(Date.parse(now) - ago * 86400000)
    if ([0, 6].includes(date.getUTCDay())) continue
    const day = date.toISOString().slice(0, 10)
    const stamp = day.replaceAll('-', '')
    const url = `https://www.sec.gov/Archives/edgar/daily-index/${date.getUTCFullYear()}/QTR${Math.floor(date.getUTCMonth() / 3) + 1}/master.${stamp}.idx`
    const indexKey = `research:disclosures:index:${day}`
    try {
      const progress = await redis.get(indexKey)
      if (progress?.complete) continue
      const bytes = await secClient.request(url, false)
      // An issuer can file several forms in one day; enqueue it once. A bounded
      // cursor avoids spending the entire Hobby invocation in Redis round trips.
      const items = [...new Map(parseDailyIndex(bytes.toString('utf8'), master, identityAt).map((item) => [item.issuerId, item])).values()]
      let cursor = progress?.cursor || 0
      for (; cursor < items.length; cursor++) {
        if (Date.now() + 90000 >= deadline) break // leave time for actual filings
        const item = items[cursor]
        const jobId = digest([item.issuerId, day])
        if (await redis.get(`research:disclosures:done:${jobId}`)) continue
        const job = { ...item, since: `${day}T00:00:00Z`, availableAt: identityAt }
        await archive.put('ingestion-job', jobId, job, 'ingestion-jobs', identityAt)
        await redis.zadd(pending, { score: Date.parse(day), member: jobId })
        if ((cursor + 1) % 25 === 0) await redis.set(indexKey, { cursor: cursor + 1, complete: false })
      }
      await redis.set(indexKey, { cursor, complete: cursor === items.length })
    } catch (error) { errors.push({ stage: 'daily-index', date: day, message: error.message }) }
  }
  const jobs = secClient ? await redis.zrange(pending, 0, Math.max(0, maxIssuers - 1)) : []
  const completed = []
  for (const jobId of jobs) {
    if (Date.now() + 45000 >= deadline) break
    const job = await archive.get('ingestion-job', jobId)
    try {
      const result = await ingestIssuer(archive, master, job.issuerId.slice(4), { client: secClient, deadline, since: job.since, limit: 3, afterAccession: await redis.get(`research:disclosures:cursor:${jobId}`) })
      if (result.truncated) {
        await redis.set(`research:disclosures:cursor:${jobId}`, result.nextAccession)
        continue
      }
      await redis.set(`research:disclosures:done:${jobId}`, { completedAt: new Date().toISOString(), documents: result.documents.length, evidence: result.evidence.length })
      await redis.zrem(pending, jobId)
      completed.push({ issuerId: job.issuerId, documents: result.documents.length, evidence: result.evidence.length })
    } catch (error) { errors.push({ stage: 'issuer', issuerId: job?.issuerId, message: error.message }) }
  }
  return { universe: master.securities().length, masterAsOf: master.snapshots.at(-1).asOf, masterRefresh, completed, errors, pending: await redis.zcard(pending) }
}
