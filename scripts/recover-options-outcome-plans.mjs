// Gives the options mornings published without outcome plans (Sep 25, 28 and
// 29, 2026) the plans they should have had, so the forward capture observes
// their remaining checkpoints. See src/server/options/outcomeRecovery.js.
// Endpoints already in the past stay unobserved; nothing is back-filled.
//
//   node --env-file=.env scripts/recover-options-outcome-plans.mjs                    dry run
//   node --env-file=.env scripts/recover-options-outcome-plans.mjs --apply            archive the recoveries
//   node --env-file=.env scripts/recover-options-outcome-plans.mjs --rebuild-capture  make the next capture
//                                                                                     tick rebuild today's schedule
import { Redis } from '@upstash/redis'
import { createArchive } from '../src/server/research/archive.js'
import { OPTIONS_CAPTURE_ACTIVE_KEY } from '../src/server/options/forwardCapture.js'
import { archiveOutcomeRecovery, buildOutcomeRecovery } from '../src/server/options/outcomeRecovery.js'

const apply = process.argv.includes('--apply')
const rebuild = process.argv.includes('--rebuild-capture')
const redis = Redis.fromEnv()
const archive = createArchive(redis)
const now = Date.now()

const manifests = (await archive.list('options-manifests', now, { since: now - 45 * 86400000 }))
  .filter((manifest) => manifest.publication?.result === 'candidates')
  .sort((a, b) => a.availableAt.localeCompare(b.availableAt))

let recovered = 0
for (const manifest of manifests) {
  const recovery = await buildOutcomeRecovery({ archive, manifest, availableAt: new Date().toISOString() })
  const upcoming = recovery.plans[0]?.endpointTargets
    ?.filter((target) => target.scheduledAt && Date.parse(target.scheduledAt) > now)
    .map((target) => `${target.kind === 'endpoint_close' ? `+${target.sessionOffset}` : 'expiry'} ${target.tradingDate}`)
  console.log(`${manifest.publication.tradingDate} ${manifest.scanId}: ${manifest.publication.selected.length} published, `
    + `${recovery.plans.length} to recover${recovery.unrecoverable.length ? `, unrecoverable ${JSON.stringify(recovery.unrecoverable)}` : ''}`
    + `${upcoming ? `; still to observe: ${upcoming.join(', ')}` : ''}`)
  if (apply && recovery.record) {
    await archiveOutcomeRecovery(archive, recovery.record)
    recovered += recovery.plans.length
  }
}
if (apply) console.log(`archived ${recovered} recovered plan(s)`)
else console.log('dry run: nothing written (pass --apply)')
if (rebuild) {
  await redis.del(OPTIONS_CAPTURE_ACTIVE_KEY)
  console.log('capture schedule cleared: the next observe tick rebuilds it')
}
