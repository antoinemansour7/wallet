import { reviewBudgets, STRATEGIES } from './policy.js'
import { reviewPriorityProposal, REVIEW_PRIORITY_PROPOSAL_VERSION } from './reviewPriority.js'

const unique = (values) => [...new Set(values.filter(Boolean))]
const rankOrder = (a, b) => b.priority - a.priority || a.securityId.localeCompare(b.securityId)

function evidenceSource(evidence) {
  if (evidence.strategyFamily !== 'attention') return 'SEC'
  const labels = (evidence.source?.labels || evidence.measurements?.attention?.sourceLabels || []).map((label) => String(label).toLowerCase())
  const type = String(evidence.source?.type || '').toLowerCase()
  const url = String(evidence.source?.url || '').toLowerCase()
  if (labels.includes('exa-discovery')) return 'Exa / news'
  if (type === 'screener' || labels.some((label) => ['finviz', 'earnings-calendar', 'premarket-movers'].includes(label)) || url.includes('finviz.com')) return 'Screener / technical'
  if (type === 'news' || (url && !url.includes('x.com') && !url.includes('twitter.com'))) return 'News'
  if (type === 'account' || type === 'search' || url.includes('x.com') || url.includes('twitter.com')) return 'X / attention'
  return 'Attention'
}

function evidenceDetails(candidate) {
  const evidence = [...(candidate.evidence || [])].sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.id).localeCompare(String(b.id)))
  return {
    evidenceCount: evidence.length,
    evidence: evidence.slice(0, 10).map((item) => ({
      id: item.id,
      strategy: item.strategyFamily,
      horizon: item.horizon,
      source: evidenceSource(item),
      type: item.source?.form || item.source?.type || (item.source?.accession ? 'SEC filing' : item.strategyFamily === 'attention' ? 'attention signal' : 'primary disclosure'),
    })),
    evidenceTruncated: evidence.length > 10,
    sources: unique(evidence.map(evidenceSource)),
    strategies: unique(evidence.map((item) => item.strategyFamily)),
    horizons: unique(evidence.flatMap((item) => item.horizons || [item.horizon])).sort((a, b) => a - b),
  }
}

function candidateDetails(candidate, extra = {}) {
  return {
    securityId: candidate.securityId ?? null,
    ticker: candidate.ticker ?? null,
    name: candidate.name ?? null,
    streams: candidate.streams || [],
    priority: Number.isFinite(candidate.priority) ? candidate.priority : null,
    ...(candidate.priorityProposal && { priorityProposal: candidate.priorityProposal }),
    duplicateAcrossStreams: (candidate.streams || []).length > 1,
    ...evidenceDetails(candidate),
    ...extra,
  }
}

export function admitCandidates(candidates, { budgets = reviewBudgets(), asOf = Date.now() } = {}) {
  budgets = reviewBudgets(budgets)
  const decisionTime = new Date(asOf).getTime()
  if (!Number.isFinite(decisionTime)) throw new Error('Invalid admission time')
  const known = (e) => Date.parse(e.availableAt) <= decisionTime && Date.parse(e.publicAt) <= decisionTime
  const eligible = [], rejected = []
  const merged = new Map()
  for (const candidate of candidates) {
    if (!candidate.securityId || !candidate.issuerId) { rejected.push(candidateDetails(candidate, { reason: 'unresolved_identity' })); continue }
    const prior = merged.get(candidate.securityId)
    if (prior) {
      prior.evidence = [...new Map([...prior.evidence, ...candidate.evidence].map((item) => [item.id, item])).values()]
      prior.attention = prior.attention || candidate.attention
    } else merged.set(candidate.securityId, { ...candidate, evidence: [...candidate.evidence] })
  }
  for (const candidate of merged.values()) {
    const adverse = candidate.evidence.find((e) => known(e) && (e.decision.status === 'rejected' || e.interpretation.adverse === true))
    if (adverse) { rejected.push(candidateDetails(candidate, { reason: adverse.decision.reason, evidenceId: adverse.id })); continue }
    const streams = Object.keys(STRATEGIES).filter((family) => candidate.evidence.some((e) => e.strategyFamily === family && e.decision.status === 'eligible' && known(e)))
    if (!streams.length) { rejected.push(candidateDetails(candidate, { reason: 'evidence_not_actionable_yet' })); continue }
    const eligibleEvidence = candidate.evidence.filter((e) => streams.includes(e.strategyFamily) && known(e))
    const priority = Math.max(...eligibleEvidence.map((e) => e.priority))
    eligible.push({ ...candidate, streams, priority,
      priorityProposal: reviewPriorityProposal(candidate, { asOf: decisionTime, evidence: eligibleEvidence }) })
  }
  eligible.sort(rankOrder)
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
  const admitted = [...selected.values()]
  const waiting = eligible.filter((candidate) => !selected.has(candidate.securityId))
  const overallRanks = new Map(eligible.map((candidate, index) => [candidate.securityId, index + 1]))
  const proposedRankOrder = (a, b) => b.priorityProposal.score - a.priorityProposal.score || a.securityId.localeCompare(b.securityId)
  const proposedOverallRanks = new Map([...eligible].sort(proposedRankOrder).map((candidate, index) => [candidate.securityId, index + 1]))
  const streamRanks = Object.fromEntries(Object.keys(budgets).map((stream) => [stream,
    new Map(eligible.filter((candidate) => candidate.streams.includes(stream)).sort(rankOrder)
      .map((candidate, index) => [candidate.securityId, index + 1])),
  ]))
  const proposedStreamRanks = Object.fromEntries(Object.keys(budgets).map((stream) => [stream,
    new Map(eligible.filter((candidate) => candidate.streams.includes(stream)).sort((a, b) =>
      b.priorityProposal.streamScores[stream] - a.priorityProposal.streamScores[stream] || a.securityId.localeCompare(b.securityId))
      .map((candidate, index) => [candidate.securityId, index + 1])),
  ]))
  const rankedDetails = (candidate, extra = {}) => candidateDetails(candidate, {
    overallRank: overallRanks.get(candidate.securityId),
    streamRanks: Object.fromEntries(candidate.streams.map((stream) => [stream, streamRanks[stream].get(candidate.securityId)])),
    proposedOverallRank: proposedOverallRanks.get(candidate.securityId),
    proposedStreamRanks: Object.fromEntries(candidate.streams.map((stream) => [stream, proposedStreamRanks[stream].get(candidate.securityId)])),
    ...extra,
  })
  const streams = Object.entries(budgets).map(([stream, configured]) => {
    const streamEligible = eligible.filter((candidate) => candidate.streams.includes(stream))
    const streamAdmitted = admitted.filter((candidate) => candidate.admission.stream === stream).sort(rankOrder)
    const streamWaiting = waiting.filter((candidate) => candidate.streams.includes(stream)).sort(rankOrder)
    const reallocatedIn = reallocations.filter((item) => item.to === stream).length
    const reallocatedOut = reallocations.filter((item) => item.from === stream).length
    const lowest = streamAdmitted.at(-1)
    return {
      strategy: stream,
      horizon: STRATEGIES[stream].horizon,
      configured,
      reservedUsed: used[stream],
      selected: streamAdmitted.length,
      reallocatedIn,
      reallocatedOut,
      eligible: streamEligible.length,
      waiting: streamWaiting.length,
      sources: Object.entries(streamEligible.flatMap((candidate) => evidenceDetails(candidate).sources)
        .reduce((counts, source) => ({ ...counts, [source]: (counts[source] || 0) + 1 }), {}))
        .map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
      lowestAdmitted: lowest ? rankedDetails(lowest) : null,
      belowCutoff: streamWaiting.slice(0, 10).map((candidate) => rankedDetails(candidate, {
        priorityGap: lowest ? Number((lowest.priority - candidate.priority).toFixed(4)) : null,
      })),
    }
  })
  const usageByStream = Object.fromEntries(streams.map((stream) => [stream.strategy, {
    configured: stream.configured,
    reservedUsed: stream.reservedUsed,
    selected: stream.selected,
    reallocatedIn: stream.reallocatedIn,
    reallocatedOut: stream.reallocatedOut,
  }]))
  const withBudget = (candidate, extra = {}) => rankedDetails(candidate, {
    budgetUsage: Object.fromEntries(candidate.streams.map((stream) => [stream, usageByStream[stream]])),
    ...extra,
  })
  return { candidates: admitted, audit: {
    priorityProposal: { version: REVIEW_PRIORITY_PROPOSAL_VERSION, usedForAdmission: false },
    budgets,
    reservedUsed: used,
    reallocations,
    rejected,
    funnel: {
      discovered: candidates.length,
      eligible: eligible.length,
      admitted: admitted.length,
      notReviewed: waiting.length,
      rejected: rejected.length,
    },
    streams,
    selected: admitted.map((candidate) => withBudget(candidate, {
      admission: candidate.admission,
      representedThroughOtherStream: candidate.streams.length > 1,
    })),
    notReviewed: waiting.map((candidate) => withBudget(candidate, {
      admitted: false,
      representedThroughOtherStream: false,
      reason: 'review_budget_exhausted',
    })),
  } }
}

export function candidatesFromEvidence(evidence, attentionBoard = []) {
  const board = new Map(attentionBoard.map((item) => [item.ticker, item]))
  const map = new Map()
  for (const item of evidence) {
    if (!map.has(item.securityId)) map.set(item.securityId, { securityId: item.securityId, issuerId: item.issuerId,
      ticker: item.ticker, name: item.name, exchange: item.exchange, currency: item.currency, evidence: [], attention: board.get(item.ticker) || null })
    map.get(item.securityId).evidence.push(item)
  }
  return [...map.values()]
}
