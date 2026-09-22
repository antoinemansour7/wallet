import { filingRows } from '../research/secDisclosures.js'
import { planCurrentDaySecRefresh } from './features.js'
import { runBounded } from './scheduler.js'

export const OPTIONS_SEC_EVIDENCE_SOURCE = Object.freeze({ provider: 'sec', licenseId: 'sec-edgar-public' })
const CATALYST_FORMS = new Set(['8-K', '8-K/A'])
const DAY = 86400000

function paddedCik(secIssuerId) {
  return secIssuerId.slice(4)
}

function submissionsUrl(secIssuerId) {
  return `https://data.sec.gov/submissions/CIK${paddedCik(secIssuerId)}.json`
}

async function defaultFetch(client, secIssuerId) {
  const submissions = await client.request(submissionsUrl(secIssuerId))
  return filingRows(submissions)
}

function mapRow(row, request, fetchedAt) {
  const publicAt = new Date(row.publicAt).toISOString()
  const documentId = `sec:${request.secIssuerId}:${row.accession}`
  const source = { ...OPTIONS_SEC_EVIDENCE_SOURCE, url: submissionsUrl(request.secIssuerId) }
  const secItem = { documentId, issuerId: request.issuerId, ticker: request.ticker, accession: row.accession, form: row.form, publicAt, availableAt: fetchedAt, source }
  const catalystItem = CATALYST_FORMS.has(row.form)
    ? { eventId: documentId, issuerId: request.issuerId, ticker: request.ticker, eventDate: publicAt.slice(0, 10), kind: 'sec_8k', label: `${row.form} filing ${row.accession}`, publicAt, availableAt: fetchedAt, source }
    : null
  return { secItem, catalystItem }
}

export async function gatherOptionsSecEvidence({
  securityMaster, securities, freezeAt, completed = [], client, deadline, maxConcurrency = 4, sinceDays = 3,
  fetch = defaultFetch, now = () => new Date().toISOString(),
} = {}) {
  if (!securityMaster || !client) throw new Error('SEC evidence gathering requires a securityMaster and client')
  // planCurrentDaySecRefresh's own `completed` filter expects
  // {secIssuerId, completedAt, tradingDate} objects (features.js's
  // planCurrentDaySecRefresh). This module's checkpoint is a plain array of
  // secIssuerId strings, so the already-completed filtering happens here
  // instead of being delegated to it.
  const plan = planCurrentDaySecRefresh({ securities, freezeAt, completed: [], securityMaster })
  const pending = plan.requests.filter((request) => !completed.includes(request.secIssuerId))
  const alreadyDone = plan.requests.filter((request) => completed.includes(request.secIssuerId))
  const since = new Date(Date.parse(freezeAt) - sinceDays * DAY).toISOString()
  const secItems = []
  const catalystItems = []
  const newlyCompleted = []
  // planCurrentDaySecRefresh's requests carry issuerId/ticker, not
  // securityId — resolve it from the watchlist so coverage is keyed the
  // same way createOptionsFeatureSnapshot's `securities` are.
  const securityIdByTicker = new Map(securities.map((security) => [security.ticker, security.securityId]))
  // "checked this issuer, found nothing" must read differently from "never
  // checked it at all" — the caller folds this into per-feed coverage so
  // evaluateNonEventHorizon can eventually reach 'eligible', not just
  // perpetually 'unknown'. A ticker with no entry here (time-budget
  // truncated before it was attempted) is left for the caller's default.
  const coverage = {}
  for (const item of plan.unresolved) coverage[item.securityId] = { status: 'unavailable', reason: item.reason }
  for (const request of alreadyDone) coverage[securityIdByTicker.get(request.ticker)] = { status: 'complete' }

  await runBounded(pending, Math.max(1, maxConcurrency), async (request) => {
    if (deadline != null && Date.now() + 5000 >= deadline) return
    const securityId = securityIdByTicker.get(request.ticker)
    try {
      const rows = await fetch(client, request.secIssuerId)
      const fetchedAt = now()
      for (const row of rows) {
        if (Date.parse(row.publicAt) < Date.parse(since)) continue
        const { secItem, catalystItem } = mapRow(row, request, fetchedAt)
        secItems.push(secItem)
        if (catalystItem) catalystItems.push(catalystItem)
      }
      newlyCompleted.push(request.secIssuerId)
      coverage[securityId] = { status: 'complete' }
    } catch (error) {
      coverage[securityId] = { status: 'unavailable', reason: 'sec_request_failed' }
      console.error(JSON.stringify({ service: 'options-premarket', stage: 'sec-issuer', ticker: request.ticker, message: String(error?.message || error) }))
    }
  })

  return { secItems, catalystItems, completed: [...new Set([...completed, ...newlyCompleted])], coverage }
}
