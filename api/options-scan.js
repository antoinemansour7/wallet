import { Redis } from '@upstash/redis'
import { createArchive, digest } from '../src/server/research/archive.js'
import { OptionsSchedulerUnavailableError, runOptionsScheduledStage } from '../src/server/options/scheduler.js'
import { runOptionsPremarketStage as defaultRunPremarketStage } from '../src/server/options/premarketEvidence.js'
import { runOptionsOpeningStage as defaultRunOpeningStage } from '../src/server/options/openingEvidence.js'
import { archiveOptionsAuditRecord, commitOptionsScan } from '../src/server/options/auditStore.js'
import { instrumentRedisCommandCount } from '../src/server/options/operations.js'
import { runOptionsForwardCaptureTick } from '../src/server/options/forwardCapture.js'
import { createAlpacaOptionsAdapter } from '../src/server/options/alpaca.js'
import { runOptionsExperimentStage, archiveOptionsExperiment } from '../src/server/options/experimentScan.js'
import { OPTIONS_EXPERIMENT_LATEST_KEY } from '../src/server/options/forwardCapture.js'

function authorized(req) {
  return Boolean(process.env.CRON_SECRET) && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
}

function redisFromEnv() {
  return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null
}

// Outcome capture must be able to finish a cohort's +10-session tail after the
// scanner itself is switched off, so it has its own flag that defaults to the
// scanner's. The Redis kill switch still stops both.
function forwardCaptureEnabled() {
  const explicit = process.env.OPTIONS_FORWARD_CAPTURE_ENABLED
  return explicit ? explicit === 'true' : process.env.OPTIONS_SCANNER_ENABLED === 'true'
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
  runShadowStage = runOptionsExperimentStage,
  archiveRecord = archiveOptionsAuditRecord,
  commitScan = commitOptionsScan,
  enabled = () => process.env.OPTIONS_SCANNER_ENABLED === 'true',
  captureEnabled = forwardCaptureEnabled,
  runObserveTick = runOptionsForwardCaptureTick,
  makeAdapter = () => createAlpacaOptionsAdapter(),
} = {}) {
  return async function optionsScanHandler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
    if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
    const stage = req.query?.mode
    if (!['premarket', 'opening', 'shadow', 'observe'].includes(stage)) return res.status(400).json({ error: 'Invalid options scan mode' })
    if (stage === 'observe') {
      // Per-minute outcome capture is not a once-a-day stage: it has no window,
      // deadline or completion record, so it does not go through runStage.
      const reference = digest([stage, requestId(req), Date.now()]).slice(0, 16)
      try {
        const enabledNow = captureEnabled()
        const redis = getRedis()
        const result = await runObserveTick({ redis, archive: redis ? makeArchive(redis) : null, adapter: enabledNow ? makeAdapter() : null, enabled: enabledNow })
        return res.status(result.status === 'partial' ? 503 : 200).json({
          status: result.status, stage, tradingDate: result.tradingDate,
          instants: result.instants?.length ?? 0, failed: result.failed?.length ?? 0,
        })
      } catch {
        console.error(JSON.stringify({ service: 'options-forward-capture', category: 'capture_failed', reference }))
        return res.status(503).json({ error: 'Options outcome capture is unavailable.', category: 'capture_failed', reference })
      }
    }
    const rawRedis = getRedis()
    // Metrics only, never a behavior change: every Redis command the whole
    // stage attempt issues -- the scheduler's own lease/checkpoint calls and
    // the stage body's archive reads/writes alike -- is counted through this
    // one shared, proxied client (see operations.js). The count is read and
    // merged into the stage's own metrics inside `execute`, before the final
    // publish commit runs, so it undercounts that last write by a command or
    // two; that is a documented near-final figure, not an exact ledger.
    const counted = rawRedis ? instrumentRedisCommandCount(rawRedis) : null
    const redis = counted ? counted.redis : rawRedis
    const archive = redis ? makeArchive(redis) : null
    const reference = digest([stage, requestId(req), Date.now()]).slice(0, 16)
    try {
      const result = await runStage({
        redis, archive, stage, requestId: requestId(req), enabled: enabled(),
        execute: async (context) => {
          const outcome = stage === 'premarket' ? await runPremarketStage({ ...context, archive })
            : stage === 'shadow' ? await runShadowStage({ ...context, archive, redis }) : await runOpeningStage({ ...context, archive, redis })
          if (!outcome.metrics) return outcome
          const r2Bytes = (outcome.records || []).reduce((sum, record) => sum + (Number.isFinite(record.byteLength) ? record.byteLength : 0), 0)
          return { ...outcome, metrics: { ...outcome.metrics, r2Bytes, redisCommandCount: counted?.counter.count ?? null } }
        },
        publish: async (result, lease) => {
          if (stage === 'shadow') {
            if (!result.experiment) throw new Error('Shadow result is missing its frozen experiment')
            await archiveOptionsExperiment(archive, result.experiment)
            await redis.set(OPTIONS_EXPERIMENT_LATEST_KEY, result.experiment.experimentId)
            return null
          }
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
