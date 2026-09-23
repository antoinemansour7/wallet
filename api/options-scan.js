import { Redis } from '@upstash/redis'
import { createArchive, digest } from '../src/server/research/archive.js'
import { OptionsSchedulerUnavailableError, runOptionsScheduledStage } from '../src/server/options/scheduler.js'
import { runOptionsPremarketStage as defaultRunPremarketStage } from '../src/server/options/premarketEvidence.js'
import { runOptionsOpeningStage as defaultRunOpeningStage } from '../src/server/options/openingEvidence.js'
import { archiveOptionsAuditRecord, commitOptionsScan } from '../src/server/options/auditStore.js'

function authorized(req) {
  return Boolean(process.env.CRON_SECRET) && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
}

function redisFromEnv() {
  return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null
}

function requestId(req) {
  return req.headers['upstash-message-id'] || req.headers['x-qstash-message-id'] || req.headers['x-vercel-id'] || req.headers['x-request-id'] || 'unidentified-dispatch'
}

export function createOptionsScanHandler({
  getRedis = redisFromEnv,
  makeArchive = createArchive,
  runStage = runOptionsScheduledStage,
  runPremarketStage = defaultRunPremarketStage,
  runOpeningStage = defaultRunOpeningStage,
  archiveRecord = archiveOptionsAuditRecord,
  commitScan = commitOptionsScan,
  enabled = () => process.env.OPTIONS_SCANNER_ENABLED === 'true',
} = {}) {
  return async function optionsScanHandler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
    if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
    const stage = req.query?.mode
    if (!['premarket', 'opening'].includes(stage)) return res.status(400).json({ error: 'Invalid options scan mode' })
    const redis = getRedis()
    const archive = redis ? makeArchive(redis) : null
    const reference = digest([stage, requestId(req), Date.now()]).slice(0, 16)
    try {
      const result = await runStage({
        redis, archive, stage, requestId: requestId(req), enabled: enabled(),
        execute: (context) => stage === 'premarket' ? runPremarketStage({ ...context, archive }) : runOpeningStage({ ...context, archive, redis }),
        publish: async (result, lease) => {
          if (stage === 'opening') {
            if (!result.scanId || !result.availableAt) throw new Error('Opening result is missing publication identity')
            return commitScan({
              archive, redis, records: result.records, scanId: result.scanId, availableAt: result.availableAt,
              lockKey: lease.lockKey, lockToken: lease.lockToken, requirePublication: true,
            })
          }
          for (const record of result.records || []) await archiveRecord(archive, record)
          return null
        },
      })
      const statusCode = ['incomplete', 'late', 'missed'].includes(result.status) ? 503 : result.status === 'in_progress' ? 202 : 200
      return res.status(statusCode).json({
        status: result.status, stage: result.stage || stage, tradingDate: result.tradingDate,
        attempt: result.attempt, reference: result.auditRecordId || reference,
      })
    } catch (error) {
      const category = error instanceof OptionsSchedulerUnavailableError ? 'schedule_storage_unavailable' : 'schedule_dispatch_failed'
      console.error(JSON.stringify({ service: 'options-scheduler', stage, category, reference }))
      return res.status(503).json({ error: 'Options scan scheduling is unavailable.', category, reference })
    }
  }
}

export default createOptionsScanHandler()
