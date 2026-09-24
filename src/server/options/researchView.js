import { optionsAuditRecord } from './auditStore.js'
import { optionsPublicationSummary } from './publication.js'
import { marketDay, optionsLocalParts, zonedMarketInstant } from './calendar.js'
import { optionsStageWindow } from './scheduler.js'

const OPENING_ATTEMPTS = new Set(['complete', 'late', 'incomplete', 'missed'])
const OPENING_STATUS = { complete: 'published', late: 'late', incomplete: 'failed', missed: 'missed' }

// Why today has no morning yet, in the owner's terms: not due, due, failed,
// finished too late, or never ran in its window. Attempts are read only when
// the answer depends on them; an unreadable history is `unknown`, never an
// error, so the page still renders. Null on closed or uncalendared days.
async function openingScanStatus({ archive, at, publication }) {
  const window = optionsStageWindow(at, 'opening')
  if (!['early', 'on_time', 'late'].includes(window.state)) return null
  const base = { tradingDate: window.tradingDate, scheduledAt: window.scheduledAt, deadlineAt: window.deadlineAt }
  if (publication?.tradingDate === window.tradingDate) return { ...base, status: 'published' }
  if (window.state === 'early') return { ...base, status: 'scheduled' }
  let records
  try { records = await archive.list('options-records:scan', at, { since: window.windowStartAt, count: Infinity }) }
  catch { return { ...base, status: 'unknown' } }
  const attempts = (records || []).map((record) => record?.payload)
    .filter((item) => item?.stage === 'opening' && item.tradingDate === window.tradingDate && OPENING_ATTEMPTS.has(item.status))
    .sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt))
  const latest = attempts.find((item) => item.status === 'complete') || attempts.at(-1)
  if (latest) return { ...base, status: OPENING_STATUS[latest.status], at: latest.endedAt }
  return { ...base, status: window.state === 'late' ? 'missed' : 'due' }
}

// Display policy only: a fixed directional +/−5% move, three sessions and
// unchanged IV. Never choose the highest-return cell or reprice on a read.
export function selectedResearchScenario(set, direction) {
  const row = set?.scenarios?.find((row) => row.horizonId === '3_sessions'
    && row.movePct === (direction === 'put' ? -5 : 5) && row.ivMultiplier === 1)
  if (!row) return null
  const { greeks, ...display } = row
  return display
}

function identity(contract) {
  if (!contract) return null
  const { contractId, osiSymbol, type, strikePrice, expirationDate } = contract
  return { contractId, osiSymbol, type, strikePrice, expirationDate }
}

export async function buildOptionsResearchView({ archive, manifest, contractId, readRecord = optionsAuditRecord, now = Date.now }) {
  const at = now()
  const summary = optionsPublicationSummary(manifest, at)
  const local = optionsLocalParts(at)
  const day = marketDay(local.date)
  const session = day.known && day.open
    ? { opensAt: zonedMarketInstant(local.date, day.openTime), closesAt: zonedMarketInstant(local.date, day.closeTime) } : null
  const publication = manifest?.publication
  const base = {
    summary, session, manifestId: manifest?.manifestId || null,
    morning: publication || null, candidates: [],
    ...(contractId ? {} : { opening: await openingScanStatus({ archive, at, publication }) }),
  }
  if (!publication) return base
  if (contractId && !publication.selected.some((row) => row.contractId === contractId)) return null

  const references = (manifest.records || []).filter((ref) => ['chain', 'scenario', 'score'].includes(ref.type))
  const records = await Promise.all(references.map((ref) => readRecord(archive, ref.type, ref.id)))
  const chains = records.filter((record) => record?.recordType === 'chain')
  const scenarios = records.filter((record) => record?.recordType === 'scenario').flatMap((record) => record.payload.scenarios || [])
  const scores = records.filter((record) => record?.recordType === 'score').flatMap((record) => record.payload.scores || [])
  const chainFor = (selected) => selected.revalidation?.chainRecordId
    ? chains.find((record) => record.recordId === selected.revalidation.chainRecordId)
    : chains.find((record) => record.payload.contracts.some((item) => item.contractId === selected.contractId))
  const candidates = publication.selected.map((selected) => {
    const score = scores.find((item) => item.contract.contractId === selected.contractId)
    const chain = chainFor(selected)
    const contract = chain?.payload.contracts.find((item) => item.contractId === selected.contractId)
    const scenario = scenarios.find((item) => item.contractId === selected.contractId && item.purpose === 'selected_full_matrix')
    const set = scenario?.scenarioSet
    const returns = (set?.scenarios || []).map((row) => row.askEntryModeledBidReturnPct).filter(Number.isFinite)
    const risk = [...(score?.penalties || [])].sort((a, b) => b.points - a.points)[0]
    return {
      contractId: selected.contractId, ticker: selected.ticker, direction: selected.direction,
      rank: selected.rank, score: selected.score, contract: identity(contract || score?.contract || set?.contract),
      observed: {
        mid: selected.observedMid, spreadPct: selected.spreadPct, bid: contract?.quote?.bid ?? null,
        ask: contract?.quote?.ask ?? null, marketAt: selected.quoteMarketAt, underlyingMarketAt: selected.underlyingMarketAt,
      },
      selectedScenario: selectedResearchScenario(set, selected.direction),
      worstReturnPct: returns.length ? Math.min(...returns) : null,
      premiumAtRisk: set?.entry?.premiumAtRiskPerContract ?? null,
      drivers: [...(score?.components || [])].filter((item) => item.points > 0).sort((a, b) => b.points - a.points).slice(0, 2)
        .map(({ component, points, max }) => ({ component, points, max })),
      risk: risk?.code || 'full_premium_at_risk', riskReason: risk?.reason || null,
      earnings: score?.earnings || [], earningsCoverage: score?.earningsCoverage || null,
      detailsAvailable: Boolean(contract && set && score),
    }
  })
  if (!contractId) return { ...base, candidates, evidenceStatus: records.some((record) => !record) || candidates.some((row) => !row.detailsAvailable) ? 'partial' : 'complete' }

  const selected = publication.selected.find((item) => item.contractId === contractId)
  const chain = chainFor(selected)
  const scenario = scenarios.find((item) => item.contractId === contractId && item.purpose === 'selected_full_matrix')
  return {
    manifestId: manifest.manifestId,
    underlyingMarketAt: selected.underlyingMarketAt,
    contract: chain?.payload.contracts.find((item) => item.contractId === contractId) || null,
    scenarioSet: scenario?.scenarioSet || null,
    score: scores.find((item) => item.contract.contractId === contractId) || null,
    comparison: (chain?.payload.contracts || []).map((item) => ({
      ...identity(item), bid: item.quote?.bid, ask: item.quote?.ask, marketAt: item.quote?.marketAt,
      score: scores.find((score) => score.contract.contractId === item.contractId)?.score ?? null,
    })),
    lineage: {
      manifestId: manifest.manifestId, scanId: manifest.scanId, availableAt: manifest.availableAt,
      records: records.filter(Boolean).map(({ recordId, recordType, availableAt, source, versions, inputHashes }) =>
        ({ recordId, recordType, availableAt, source, versions, inputHashes })),
    },
  }
}
