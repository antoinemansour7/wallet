import { Redis } from '@upstash/redis'
import { syncFoundation } from '../src/server/research/foundation.js'
import { withRunLog } from '../src/server/runLog.js'
import { STAGES, recordResearchRun, skipStage, stage } from '../src/server/research/observability.js'

export async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' })
  const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null
  const execute = async (out = res) => {
    try {
      const result = await stage(STAGES.foundation_sync,
        () => syncFoundation({ forceMasterRefresh: req.method === 'POST' && req.body?.refreshMaster === true }),
        { metrics: (value) => ({ completed: value.completed.length, pending: value.pending.length, errors: value.errors.length }) })
      if (result.errors.length) skipStage(STAGES.foundation_followup, 'source_errors', { errors: result.errors.length, pending: result.pending.length })
      return out.status(result.errors.length && !result.completed.length ? 503 : 200).json(result)
    } catch (error) {
      return out.status(503).json({ error: error.message })
    }
  }
  return redis ? recordResearchRun(redis, { job: 'research-foundation', res }, execute) : execute()
}
export default withRunLog('research-foundation', handler)
