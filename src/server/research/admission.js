import { reviewBudgets, STRATEGIES } from './policy.js'

export function admitCandidates(candidates, { budgets = reviewBudgets(), asOf = Date.now() } = {}) {
  budgets = reviewBudgets(budgets)
  const decisionTime = new Date(asOf).getTime()
  if (!Number.isFinite(decisionTime)) throw new Error('Invalid admission time')
  const known = (e) => Date.parse(e.availableAt) <= decisionTime && Date.parse(e.publicAt) <= decisionTime
  const eligible = [], rejected = []
  const merged = new Map()
  for (const candidate of candidates) {
    if (!candidate.securityId || !candidate.issuerId) { rejected.push({ ticker: candidate.ticker, reason: 'unresolved_identity' }); continue }
    const prior = merged.get(candidate.securityId)
    if (prior) {
      prior.evidence = [...new Map([...prior.evidence, ...candidate.evidence].map((item) => [item.id, item])).values()]
      prior.attention = prior.attention || candidate.attention
    } else merged.set(candidate.securityId, { ...candidate, evidence: [...candidate.evidence] })
  }
  for (const candidate of merged.values()) {
    const adverse = candidate.evidence.find((e) => known(e) && (e.decision.status === 'rejected' || e.interpretation.adverse === true))
    if (adverse) { rejected.push({ securityId: candidate.securityId, reason: adverse.decision.reason, evidenceId: adverse.id }); continue }
    const streams = Object.keys(STRATEGIES).filter((family) => candidate.evidence.some((e) => e.strategyFamily === family && e.decision.status === 'eligible' && known(e)))
    if (!streams.length) { rejected.push({ securityId: candidate.securityId, reason: 'evidence_not_actionable_yet' }); continue }
    eligible.push({ ...candidate, streams, priority: Math.max(...candidate.evidence.filter((e) => streams.includes(e.strategyFamily) && known(e)).map((e) => e.priority)) })
  }
  eligible.sort((a, b) => b.priority - a.priority || a.securityId.localeCompare(b.securityId))
  const selected = new Map(), used = Object.fromEntries(Object.keys(budgets).map((key) => [key, 0]))
  // Assign least-flexible candidates first, with augmenting paths for overlaps.
  // This maximizes filled reserved capacity rather than consuming a rare lane
  // with a stock that another lane could have funded.
  const slots = Object.entries(budgets).flatMap(([stream, count]) => Array.from({ length: count }, () => ({ stream, candidate: null })))
  const assign = (candidate, visited = new Set()) => {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      if (visited.has(i) || !candidate.streams.includes(slot.stream)) continue
      visited.add(i)
      if (!slot.candidate || assign(slot.candidate, visited)) { slot.candidate = candidate; return true }
    }
    return false
  }
  const ordered = [...eligible].sort((a, b) => a.streams.length - b.streams.length || b.priority - a.priority || a.securityId.localeCompare(b.securityId))
  for (const candidate of ordered) assign(candidate)
  for (const { stream, candidate } of slots) if (candidate) {
    selected.set(candidate.securityId, { ...candidate, admission: { stream, kind: 'reserved' } })
    used[stream]++
  }
  const reallocations = []
  for (const [from, budget] of Object.entries(budgets)) {
    for (let i = used[from]; i < budget; i++) {
      const next = eligible.find((candidate) => !selected.has(candidate.securityId))
      if (!next) break
      const to = next.streams[0]
      const admission = { stream: to, to, kind: 'reallocated', from, reason: 'No remaining eligible candidate can use the reserved slot' }
      selected.set(next.securityId, { ...next, admission })
      reallocations.push({ securityId: next.securityId, ...admission })
    }
  }
  return { candidates: [...selected.values()], audit: { budgets, reservedUsed: used, reallocations, rejected,
    notReviewed: eligible.filter((c) => !selected.has(c.securityId)).map((c) => ({ securityId: c.securityId, reason: 'review_budget_exhausted' })) } }
}

export function candidatesFromEvidence(evidence, attentionBoard = []) {
  const board = new Map(attentionBoard.map((item) => [item.ticker, item]))
  const map = new Map()
  for (const item of evidence) {
    if (!map.has(item.securityId)) map.set(item.securityId, { securityId: item.securityId, issuerId: item.issuerId,
      ticker: item.ticker, exchange: item.exchange, currency: item.currency, evidence: [], attention: board.get(item.ticker) || null })
    map.get(item.securityId).evidence.push(item)
  }
  return [...map.values()]
}
