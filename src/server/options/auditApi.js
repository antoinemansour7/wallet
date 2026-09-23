import { randomUUID } from 'node:crypto'
import { Redis } from '@upstash/redis'
import { createArchive } from '../research/archive.js'
import { verifyOwner } from '../research/evaluationApi.js'
import { latestOptionsManifest, optionsAuditRecord } from './auditStore.js'
import { optionsPublicationSummary } from './publication.js'
import { refreshOptionsContractDetail } from './detailRefresh.js'
import { buildOptionsOperationsReport } from './operations.js'
import { buildOptionsResearchView } from './researchView.js'
import { buildOptionsShadowView } from './shadowView.js'

function unavailable(res, error) {
  const referenceId = `options-${randomUUID()}`
  console.error(`[${referenceId}] options audit read failed:`, error?.message || error)
  return res.status(503).json({ error: 'Options audit data is unavailable', referenceId })
}
export function createOptionsAuditHandler({
  authorize = verifyOwner,
  redisFromEnv = () => Redis.fromEnv(),
  makeArchive = createArchive,
  latestManifest = latestOptionsManifest,
  readRecord = optionsAuditRecord,
  refreshDetail = refreshOptionsContractDetail,
  buildReport = buildOptionsOperationsReport,
  buildResearch = buildOptionsResearchView,
  buildShadow = buildOptionsShadowView,
  now = Date.now,
} = {}) {
  return async function optionsAuditHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Vary', 'Authorization')
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })

    const caller = await authorize(req)
    if (caller.error) return res.status(caller.status).json({ error: caller.error })
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return unavailable(res, new Error('storage_not_configured'))
    }

    // The shadow-test dashboard is read-only: no refresh or other write goes through it.
    if (req.query?.view === 'shadow' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    const type = req.query?.recordType
    const id = req.query?.recordId
    if ((type && !id) || (!type && id)) return res.status(400).json({ error: 'recordType and recordId must be provided together' })

    try {
      const redis = redisFromEnv()
      const archive = makeArchive(redis)
      // Deep links and refreshes stay pinned to the morning the owner opened,
      // even if another publication has since advanced the latest pointer.
      const manifestId = req.body?.manifestId || req.query?.manifestId
      if (manifestId && (typeof manifestId !== 'string' || !/^[a-f0-9]{64}$/.test(manifestId))) {
        return res.status(400).json({ error: 'Invalid morning reference' })
      }
      const resolveManifest = () => manifestId ? archive.get('options-manifest', manifestId) : latestManifest(archive, redis)
      if (req.method === 'POST') {
        const contractId = req.body?.contractId || req.query?.contractId
        if (typeof contractId !== 'string' || !contractId) return res.status(400).json({ error: 'contractId is required' })
        const manifest = await resolveManifest()
        if (!manifest) return res.status(404).json({ error: 'No published options scan is available' })
        return res.status(200).json({ detail: await refreshDetail({ archive, manifest, contractId, now }) })
      }
      if (type) {
        const record = await readRecord(archive, String(type), String(id))
        if (!record) return res.status(404).json({ error: 'Options audit record not found' })
        return res.status(200).json({ record })
      }
      // Same owner gate, same sanitized-error pattern, same route -- a
      // dedicated Operations page/route is deliberately not added here
      // (#215's scope is the API and its diagnostics; #216 is the UI, and
      // #207 already called out keeping mode dispatch on existing routes
      // over unbounded new handlers).
      if (req.query?.view === 'operations') {
        const operations = await buildReport({ archive, redis, latestManifest, now })
        return res.status(200).json({ operations })
      }
      if (req.query?.view === 'shadow') {
        return res.status(200).json({ shadow: await buildShadow({ archive, readRecord, now }) })
      }
      const manifest = await resolveManifest()
      if (manifestId && !manifest) return res.status(404).json({ error: 'Morning record is unavailable' })
      if (req.query?.view === 'research') {
        const research = await buildResearch({ archive, manifest, contractId: req.query?.contractId, readRecord, now })
        if (!research) return res.status(404).json({ error: 'Morning candidate not found' })
        return res.status(200).json({ research })
      }
      return res.status(200).json({ summary: optionsPublicationSummary(manifest, now()) })
    } catch (error) {
      return unavailable(res, error)
    }
  }
}

export default createOptionsAuditHandler()
