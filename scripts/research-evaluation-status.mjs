// Read-only operator report. Run with trusted server credentials, for example:
// node --env-file=.env scripts/research-evaluation-status.mjs
import { Redis } from '@upstash/redis'
import { createArchive } from '../src/server/research/archive.js'
import { evaluationReport } from '../src/server/research/evaluationPerformance.js'

const report = await evaluationReport(createArchive(Redis.fromEnv()), Date.now(), { includeObservations: false })
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), experimentId: report.experimentId, status: report.status,
  latestRun: report.latestRun, currentJob: report.currentJob, variantsTried: report.variantsTried,
  arms: report.arms.map((a) => ({ arm: a.id, cohort: a.cohort, observations: a.observations,
    accepted: a.accepted, rejected: a.rejected, cohorts: a.cohorts,
    ...(a.cohorts.length ? {} : { horizons: a.emptyHorizons }) })),
}, null, 2))
