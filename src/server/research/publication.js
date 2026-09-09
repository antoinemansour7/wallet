import { isSameCycle, mergePicksByScore } from '../researchCycle.js'
import { digest } from './archive.js'
import { HISTORY_LIMIT, HISTORY_RETENTION_SECONDS } from './policy.js'

export const HORIZONS = [5, 20, 60]
export const horizonPicks = (payload, horizon) => payload?.picksByHorizon?.[horizon] ?? (horizon === 5 ? payload?.picks || [] : [])

// Scores are comparable within a horizon only. Keep each winning decision
// whole, including its original publication time, evidence, price and report.
export function cycleBoards(prior, current, { generatedAt, vetoes = [], master } = {}) {
  const blocked = new Set(vetoes)
  const eligible = (pick) => {
    if (blocked.has(pick.securityId)) return false
    if (!master) return true
    const matches = master.resolve({ ticker: pick.ticker, asOf: generatedAt })
    return matches.length === 1 && !blocked.has(matches[0].securityId)
      && (!pick.securityId || matches[0].securityId === pick.securityId)
  }
  const sameCycle = isSameCycle(prior?.generatedAt, new Date(generatedAt))
  return Object.fromEntries(HORIZONS.map((horizon) => {
    const carried = sameCycle ? horizonPicks(prior, horizon).filter(eligible).map((pick) => ({
      ...pick, generatedAt: pick.generatedAt || prior.generatedAt,
    })) : []
    const fresh = (current[horizon] || []).filter(eligible).map((pick) => ({
      ...pick, generatedAt,
      earliestActionAt: new Date(Math.max(Date.parse(pick.earliestActionAt) || 0, Date.parse(generatedAt) + 60000)).toISOString(),
    }))
    return [horizon, mergePicksByScore(carried, fresh, { limit: 5 })]
  }))
}

// Freeze decisions before the optional report work. Reports enrich that same
// publication; they neither create another evaluation sample nor delay its fill.
export async function freezePublication(archive, payload) {
  const publicationId = digest(payload)
  await archive.put('publication', publicationId, { ...payload, publicationId, id: publicationId, availableAt: payload.generatedAt }, 'publications', payload.generatedAt)
  return { ...payload, publicationId }
}

export async function storeProjection(redis, payload) {
  const date = payload.generatedAt.slice(0, 10)
  await redis.set('research:latest', payload, { ex: 48 * 60 * 60 })
  await redis.set(`research:history:${date}`, payload, { ex: HISTORY_RETENTION_SECONDS })
  // Retry on completion too: a partial write may have failed before indexing.
  await redis.lrem('research:history-index', 0, date)
  await redis.lpush('research:history-index', date)
  await redis.ltrim('research:history-index', 0, HISTORY_LIMIT - 1)
}
