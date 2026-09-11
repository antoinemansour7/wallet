import { Redis } from '@upstash/redis'
import { compareAttentionPriorities, reviewPriorityProposal } from '../src/server/research/reviewPriority.js'

const countArg = process.argv.find((argument) => argument.startsWith('--runs='))
const requestedRuns = Number(countArg?.split('=')[1] || 5)
const json = process.argv.includes('--json')
if (!Number.isInteger(requestedRuns) || requestedRuns < 1 || requestedRuns > 100) throw new Error('--runs must be an integer from 1 to 100')

const redis = Redis.fromEnv()
const raw = await redis.lrange('research:runs:v1', 0, 499)
const runs = raw.map((value) => typeof value === 'string' ? JSON.parse(value) : value)
  .filter((run) => run.job === 'nightly-research' && run.candidates?.some((candidate) => Number.isFinite(candidate.priority)))
  .slice(0, requestedRuns)

async function evidenceFor(candidates) {
  const ids = [...new Set(candidates.flatMap((candidate) => (candidate.evidence || []).map((item) => item.id)).filter(Boolean))]
  const records = new Map()
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100)
    const values = await redis.mget(...batch.map((id) => `research:archive:v1:evidence:${id}`))
    values.forEach((value, offset) => { if (value) records.set(batch[offset], typeof value === 'string' ? JSON.parse(value) : value) })
  }
  return records
}

const reports = []
for (const run of runs) {
  const attention = run.candidates.filter((candidate) => (candidate.strategies || []).includes('attention'))
  const records = await evidenceFor(attention)
  const candidates = attention.map((candidate) => {
    const evidence = (candidate.evidence || []).map((item) => records.get(item.id)).filter(Boolean)
    return { ...candidate, streams: candidate.strategies, evidence,
      priorityProposal: reviewPriorityProposal({ ...candidate, evidence }, { asOf: run.startedAt }) }
  })
  reports.push({ runId: run.runId, startedAt: run.startedAt,
    evidenceCoverage: { loaded: records.size, referenced: new Set(attention.flatMap((candidate) => (candidate.evidence || []).map((item) => item.id))).size,
      truncatedCandidates: attention.filter((candidate) => candidate.evidenceTruncated).length },
    ...compareAttentionPriorities(candidates, { asOf: run.startedAt, budget: run.admission?.budgets?.attention || 12 }),
  })
}

if (json) console.log(JSON.stringify(reports, null, 2))
else if (!reports.length) console.log('No persisted nightly run with priority diagnostics was found.')
else for (const report of reports) {
  console.log(`\n${report.startedAt} · ${report.runId}`)
  console.log(`Evidence loaded      ${report.evidenceCoverage.loaded}/${report.evidenceCoverage.referenced}${report.evidenceCoverage.truncatedCandidates ? ` (${report.evidenceCoverage.truncatedCandidates} candidate traces were truncated at 10 items)` : ''}`)
  console.log(`Scores >= 95         current ${report.saturation.currentAt95} · proposal ${report.saturation.proposedAt95}`)
  console.log(`Attention cutoff     current ${report.currentCutoff?.ticker || '—'} ${report.currentCutoff?.score ?? '—'} · proposal ${report.proposedCutoff?.ticker || '—'} ${report.proposedCutoff?.score ?? '—'}`)
  console.log(`Would enter          ${report.entering.map((item) => `${item.ticker} (#${item.currentRank} -> #${item.proposedRank}, ${item.proposedScore})`).join(', ') || 'none'}`)
  console.log(`Would leave          ${report.leaving.map((item) => `${item.ticker} (#${item.currentRank} -> #${item.proposedRank}, ${item.proposedScore})`).join(', ') || 'none'}`)
}
