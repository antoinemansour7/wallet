import { Redis } from '@upstash/redis'
import { getApps, initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { createArchive } from './archive.js'
import { evaluationReport } from './evaluationPerformance.js'

// The owner is configured either as a Firebase UID or as the account's email
// address. An email only counts when Firebase reports it verified, since an
// unverified address says nothing about who holds the account. A UID is the
// stronger form of the two: an email can be reassigned, a UID cannot.
function isOwner(owner, decoded) {
  if (!owner.includes('@')) return decoded.uid === owner
  return decoded.email_verified === true && decoded.email?.toLowerCase() === owner.toLowerCase()
}

export async function verifyOwner(req) {
  const owner = process.env.RESEARCH_EVALUATION_OWNER?.trim()
  if (!owner) return { status: 503, error: 'Private evaluation owner is not configured' }
  const authorization = req.headers?.authorization || ''
  if (!authorization.startsWith('Bearer ')) return { status: 401, error: 'Sign in required' }
  let app
  try {
    app = getApps().find((a) => a.name === 'research-evaluation')
    if (!app) {
      const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').replace(/^\uFEFF/, '').trim()
      app = initializeApp({ credential: cert(JSON.parse(raw)) }, 'research-evaluation')
    }
  } catch { return { status: 503, error: 'Private evaluation authentication is unavailable' } }
  try {
    const decoded = await getAuth(app).verifyIdToken(authorization.slice(7), true)
    return isOwner(owner, decoded) ? { uid: decoded.uid } : { status: 403, error: 'Owner access required' }
  } catch { return { status: 401, error: 'Sign in required' } }
}

// Mounted on the existing research API to stay within the deployment's function
// limit. Authorization precedes all storage reads, including empty-state reads.
export default async function evaluationHandler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Vary', 'Authorization')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const caller = await verifyOwner(req)
  if (caller.error) return res.status(caller.status).json({ error: caller.error })
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return res.status(503).json({ error: 'Evaluation storage is unavailable' })
  }
  try {
    const data = await evaluationReport(createArchive(Redis.fromEnv()))
    return res.status(200).json(data)
  } catch {
    return res.status(503).json({ error: 'Evaluation data is unavailable' })
  }
}
