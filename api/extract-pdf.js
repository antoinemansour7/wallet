import { extractPositionsWithGroq } from '../src/server/extractPositions.js'
import { isRateLimited } from '../src/server/rateLimit.js'

// buildPrompt() already truncates at 120,000 characters before it reaches
// Groq, but silently truncating still pays for the call. A statement text
// dump running past this is not a real brokerage statement — dozens of pages
// of dense text lands nowhere close — so it's rejected outright instead.
const MAX_TEXT_LENGTH = 200_000

function getBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') return JSON.parse(req.body)
  return req.body
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Calls Groq on every request — a rare, deliberate action (uploading a
  // statement), so the budget stays tight.
  if (await isRateLimited(req, res, 'extract-pdf', { requests: 5, window: '1 m' })) return

  try {
    const { text } = getBody(req)

    if (typeof text === 'string' && text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters` })
    }

    const rows = await extractPositionsWithGroq(text, process.env.GROQ_API_KEY)
    return res.status(200).json({ rows })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
