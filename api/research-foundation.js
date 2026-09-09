import { syncFoundation } from '../src/server/research/foundation.js'
import { withRunLog } from '../src/server/runLog.js'

export async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const result = await syncFoundation({ forceMasterRefresh: req.method === 'POST' && req.body?.refreshMaster === true })
    return res.status(result.errors.length && !result.completed.length ? 503 : 200).json(result)
  } catch (error) {
    return res.status(503).json({ error: error.message })
  }
}
export default withRunLog('research-foundation', handler)
