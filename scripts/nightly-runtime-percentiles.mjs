// Read-only operator report. Run with trusted server credentials, for example:
// node --env-file=.env scripts/nightly-runtime-percentiles.mjs
import { Redis } from '@upstash/redis'
import { RESEARCH_RUNS_KEY } from '../src/server/research/observability.js'

const percentile = (sorted, p) => {
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[index]
}

const redis = Redis.fromEnv()
const stored = await redis.lrange(RESEARCH_RUNS_KEY, 0, 499)
const runs = stored.map((entry) => { try { return typeof entry === 'string' ? JSON.parse(entry) : entry } catch { return null } })
  .filter((run) => run?.job === 'nightly-research')

const durations = runs.map((run) => run.durationMs).filter(Number.isFinite).sort((a, b) => a - b)
const byStage = new Map()
for (const run of runs) {
  for (const stage of run.stages || []) {
    if (!Number.isFinite(stage.durationMs)) continue
    if (!byStage.has(stage.stage)) byStage.set(stage.stage, [])
    byStage.get(stage.stage).push(stage.durationMs)
  }
}

const stageSummary = [...byStage.entries()].map(([stage, values]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return { stage, samples: sorted.length, p50: percentile(sorted, 50), p90: percentile(sorted, 90), p95: percentile(sorted, 95), max: sorted.at(-1) }
}).sort((a, b) => (b.p90 || 0) - (a.p90 || 0))

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  sampleSize: durations.length,
  totalRuntimeMs: {
    p50: percentile(durations, 50), p90: percentile(durations, 90), p95: percentile(durations, 95), max: durations.at(-1),
  },
  exceeded250s: durations.filter((d) => d > 250_000).length,
  exceeded260s: durations.filter((d) => d > 260_000).length,
  exceeded270s: durations.filter((d) => d > 270_000).length,
  degradedRuns: runs.filter((run) => run.status !== 'success').length,
  slowestStages: stageSummary.slice(0, 8),
}, null, 2))
