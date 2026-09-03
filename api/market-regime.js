import { getMarketRegime } from '../src/server/marketRegime.js'
import { withRunLog } from '../src/server/runLog.js'

// Split out of get-research.js (#68), which used to bundle this in because
// there was nowhere else to put it when the function-slot count was at its
// limit — see #58. Computed live rather than read out of the overnight
// research payload: the tape this describes moves during the session, so a
// score frozen at 03:00 UTC would be stale by the open. getMarketRegime
// caches for an hour, so this is a Redis read on nearly every request.
async function realHandler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')

  try {
    const regime = await getMarketRegime()
    return res.status(200).json({ regime })
  } catch (err) {
    // Never fatal on the client's side: the picks matter more than the gauge
    // above them, so a failure here answers null rather than an error status.
    console.error('[market-regime] failed:', err.message)
    return res.status(200).json({ regime: null })
  }
}

export default withRunLog('market-regime', realHandler)
