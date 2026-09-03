import { runPositionSizingAgent } from '../src/server/agents/positionSizingAgent.js'
import { isRateLimited } from '../src/server/rateLimit.js'
import { withRunLog } from '../src/server/runLog.js'

async function realHandler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // This calls Claude on every request — the cheapest endpoint here to abuse
  // into running up a bill, so it gets the tightest budget.
  if (await isRateLimited(req, res, 'position-sizing', { requests: 5, window: '1 m' })) return

  const { picks, portfolioRows } = req.body || {}

  if (!picks || !Array.isArray(picks) || picks.length === 0) {
    return res.status(400).json({ error: 'picks array is required' })
  }
  if (!portfolioRows || !Array.isArray(portfolioRows) || portfolioRows.length === 0) {
    return res.status(400).json({ error: 'portfolioRows array is required' })
  }

  // Limit inputs to prevent abuse
  if (picks.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 picks allowed' })
  }
  if (portfolioRows.length > 200) {
    return res.status(400).json({ error: 'Maximum 200 portfolio rows allowed' })
  }

  try {
    const result = await runPositionSizingAgent(picks, portfolioRows)
    return res.status(200).json(result)
  } catch (err) {
    console.error('[position-sizing] agent failed:', err.message)
    return res.status(500).json({ error: 'Position sizing analysis failed' })
  }
}

export default withRunLog('position-sizing', realHandler)
