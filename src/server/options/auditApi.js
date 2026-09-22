import { randomUUID } from 'node:crypto'
import { Redis } from '@upstash/redis'
import { createArchive } from '../research/archive.js'
import { verifyOwner } from '../research/evaluationApi.js'
import { latestOptionsManifest, optionsAuditRecord } from './auditStore.js'

function unavailable(res, error) {
  const referenceId = `options-${randomUUID()}`
  console.error(`[${referenceId}] options audit read failed:`, error?.message || error)
  return res.status(503).json({ error: 'Options audit data is unavailable', referenceId })
}
export default async function optionsAuditHandler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Vary', 'Authorization')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const caller = await verifyOwner(req)
  if (caller.error) return res.status(caller.status).json({ error: caller.error })
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(503).json({ error: 'Options audit storage is unavailable' })
  }

  const type = req.query?.recordType
  const id = req.query?.recordId
  if ((type && !id) || (!type && id)) return res.status(400).json({ error: 'recordType and recordId must be provided together' })

  try {
    const redis = Redis.fromEnv()
    const archive = createArchive(redis)
    if (type) {
      const record = await optionsAuditRecord(archive, String(type), String(id))
      if (!record) return res.status(404).json({ error: 'Options audit record not found' })
      return res.status(200).json({ record })
    }
    return res.status(200).json({ manifest: await latestOptionsManifest(archive, redis) })
  } catch (error) {
    return unavailable(res, error)
  }
}
