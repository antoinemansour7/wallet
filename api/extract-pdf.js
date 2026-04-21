import { extractPositionsWithGroq } from '../src/server/extractPositions.js'

function getBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') return JSON.parse(req.body)
  return req.body
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { text } = getBody(req)
    const rows = await extractPositionsWithGroq(text, process.env.GROQ_API_KEY)
    return res.status(200).json({ rows })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
