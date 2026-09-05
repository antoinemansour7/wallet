import { Redis } from '@upstash/redis'
import { createArchive, digest } from './archive.js'
import { loadSecurityMaster, refreshSecurityMaster } from './securityMaster.js'
import { createSecClient, ingestIssuer, parseDailyIndex } from './secDisclosures.js'
import { archiveAttentionSignals } from './evidence.js'
import { candidatesFromEvidence } from './admission.js'

export async function loadFoundation({ redis = Redis.fromEnv(), archive = createArchive(redis), refresh = true, now = new Date().toISOString() } = {}) {
  let master = await loadSecurityMaster(archive, now)
  const latest = master.snapshots.at(-1)
  if (refresh && (!latest || Date.parse(now) - Date.parse(latest.asOf) > 36 * 3600000)) {
    await refreshSecurityMaster(archive)
    master = await loadSecurityMaster(archive)
  }
  if (!master.securities().length) throw new Error('No complete US common-stock master available; run the research foundation sync')
  return { redis, archive, master }
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
export async function syncFoundation({ redis = Redis.fromEnv(), archive = createArchive(redis), client = createSecClient(), maxIssuers = 5, now = new Date().toISOString(), refresh = true } = {}) {
  if (!Number.isInteger(maxIssuers) || maxIssuers < 1) throw new Error('maxIssuers must be positive')
  const { master } = await loadFoundation({ redis, archive, refresh, now })
  const errors = []
  const pending = 'research:disclosures:pending:v1'
  // Retry the last seven complete UTC days; immutable jobs deduplicate retries.
  for (let ago = 1; ago <= 7; ago++) {
    const date = new Date(Date.parse(now) - ago * 86400000)
    if ([0, 6].includes(date.getUTCDay())) continue
    const day = date.toISOString().slice(0, 10)
    const stamp = day.replaceAll('-', '')
    const url = `https://www.sec.gov/Archives/edgar/daily-index/${date.getUTCFullYear()}/QTR${Math.floor(date.getUTCMonth() / 3) + 1}/master.${stamp}.idx`
    try {
      const bytes = await client.request(url, false)
      for (const item of parseDailyIndex(bytes.toString('utf8'), master, now)) {
        const jobId = digest([item.issuerId, day])
        if (await redis.get(`research:disclosures:done:${jobId}`)) continue
        const job = { ...item, since: `${day}T00:00:00Z`, availableAt: now }
        await archive.put('ingestion-job', jobId, job, 'ingestion-jobs', now)
        await redis.zadd(pending, { score: Date.parse(day), member: jobId })
      }
    } catch (error) { errors.push({ stage: 'daily-index', date: day, message: error.message }) }
  }
  const jobs = await redis.zrange(pending, 0, Math.max(0, maxIssuers - 1))
  const completed = []
  for (const jobId of jobs) {
    const job = await archive.get('ingestion-job', jobId)
    try {
      const result = await ingestIssuer(archive, master, job.issuerId.slice(4), { client, since: job.since, limit: 3, afterAccession: await redis.get(`research:disclosures:cursor:${jobId}`) })
      if (result.truncated) {
        await redis.set(`research:disclosures:cursor:${jobId}`, result.nextAccession)
        continue
      }
      await redis.set(`research:disclosures:done:${jobId}`, { completedAt: new Date().toISOString(), documents: result.documents.length, evidence: result.evidence.length })
      await redis.zrem(pending, jobId)
      completed.push({ issuerId: job.issuerId, documents: result.documents.length, evidence: result.evidence.length })
    } catch (error) { errors.push({ stage: 'issuer', issuerId: job?.issuerId, message: error.message }) }
  }
  return { universe: master.securities().length, completed, errors, pending: await redis.zcard(pending) }
}
