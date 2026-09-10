import { digest } from './archive.js'
import { EVIDENCE_VERSION, DATA_VERSION, HORIZON_POLICY_VERSION, strategyPolicy, declaredHorizons } from './policy.js'

const iso = (value, field) => {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid evidence ${field}`)
  return new Date(timestamp).toISOString()
}
export function earliestAction({ publicAt, firstSeenAt, extractionCompletedAt, mode = 'live', executionLatencyMs = 60000, simulatedDelayMs }) {
  if (!Number.isFinite(executionLatencyMs) || executionLatencyMs < 0) throw new Error('Invalid execution latency')
  const publicTime = Date.parse(iso(publicAt, 'publicAt'))
  if (mode === 'historical') {
    if (!Number.isFinite(simulatedDelayMs) || simulatedDelayMs < 0) throw new Error('Historical replay requires a predeclared simulated delay')
    return new Date(publicTime + simulatedDelayMs + executionLatencyMs).toISOString()
  }
  if (mode !== 'live') throw new Error('Unknown evaluation mode')
  const seen = Date.parse(iso(firstSeenAt, 'firstSeenAt'))
  const extracted = Date.parse(iso(extractionCompletedAt, 'extractionCompletedAt'))
  if (extracted < seen) throw new Error('Extraction cannot precede ingestion')
  return new Date(Math.max(publicTime, seen, extracted) + executionLatencyMs).toISOString()
}

export function createEvidence(input) {
  const policy = strategyPolicy(input.strategyFamily)
  // A caller may name any horizon the strategy predeclared, but nothing else.
  if (input.horizon != null && !policy.horizons.includes(input.horizon)) throw new Error('Horizon must be declared by the strategy policy, not chosen per outcome')
  const s = input.security
  if (!s?.securityId?.startsWith('figi:') || !s.issuerId?.startsWith('cik:') || s.countryOfListing !== 'US'
    || s.type !== 'common_stock' || !s.ticker || !s.exchange || !s.currency) throw new Error('Evidence requires a resolved US common-stock identity')
  const source = input.source
  if (!source?.documentId || !(source.accession || source.eventId) || !/^https?:\/\//.test(source.url || '') || !source.excerpt?.trim()) throw new Error('Evidence requires an archived source and supporting excerpt')
  const timestamps = { publicAt: iso(input.publicAt, 'publicAt'), firstSeenAt: iso(input.firstSeenAt, 'firstSeenAt'), extractionCompletedAt: iso(input.extractionCompletedAt, 'extractionCompletedAt') }
  const execution = { mode: input.mode || 'live', executionLatencyMs: input.executionLatencyMs ?? 60000,
    ...(input.mode === 'historical' ? { simulatedDelayMs: input.simulatedDelayMs } : {}) }
  const eligibleAt = earliestAction({ ...timestamps, ...execution })
  const decision = input.decision || { status: 'eligible', reason: 'Resolved primary evidence available for detailed review' }
  if (!['eligible', 'rejected'].includes(decision.status) || !decision.reason?.trim()) throw new Error('Evidence requires an explicit eligibility decision')
  const observedFacts = input.observedFacts || []
  for (const fact of observedFacts) {
    if (!fact.concept || !fact.periodEnd || !fact.units || !Number.isFinite(fact.value)) throw new Error('Invalid comparable fact')
    if (fact.priorComparable != null && (!Number.isFinite(fact.priorComparable.value) || !fact.priorComparable.periodEnd)) throw new Error('Invalid prior comparable fact')
  }
  const record = {
    schemaVersion: EVIDENCE_VERSION, dataVersion: DATA_VERSION, modelVersion: input.modelVersion || 'disclosure-extraction-v1',
    horizonPolicyVersion: HORIZON_POLICY_VERSION, strategyFamily: input.strategyFamily, horizon: policy.horizon,
    // The declared set travels with the record, so a later reader can see what
    // was predeclared when it was written rather than trusting today's policy.
    horizons: declaredHorizons(input.strategyFamily),
    ...s, source: { ...source }, ...timestamps, execution, eligibleAt, availableAt: timestamps.extractionCompletedAt,
    observedFacts, interpretation: { thesis: '', adverse: false, ...input.interpretation },
    measurements: { liquidity: null, priceResponse: null, attention: null, ...input.measurements }, decision,
    priority: Number.isFinite(input.priority) ? Math.max(0, Math.min(100, input.priority)) : 0,
  }
  record.id = digest([s.securityId, record.strategyFamily, record.horizonPolicyVersion, source.documentId, record.modelVersion, observedFacts, record.interpretation, record.measurements, record.decision, record.priority])
  const freeze = (value) => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
    return value
  }
  return freeze(structuredClone(record))
}

export async function archiveEvidence(archive, evidence) {
  const source = await archive.get('document', evidence.source.documentId)
  if (!source || source.issuerId !== evidence.issuerId) throw new Error('Evidence source is not archived for this issuer')
  if (source.publicAt !== evidence.publicAt || source.firstSeenAt !== evidence.firstSeenAt) throw new Error('Evidence timestamps must match its immutable source')
  return archive.put('evidence', evidence.id, evidence, 'evidence', evidence.availableAt)
}

export async function replayDocuments(archive, decisionTime, { mode = 'live', simulatedDelayMs, executionLatencyMs = 60000 } = {}) {
  if (mode === 'historical' && (!Number.isFinite(simulatedDelayMs) || simulatedDelayMs < 0)) throw new Error('Historical replay requires a predeclared simulated delay')
  if (!['live', 'historical'].includes(mode)) throw new Error('Unknown evaluation mode')
  const records = await archive.list('documents', mode === 'live' ? decisionTime : Date.now())
  return records.filter((record) => {
    // Rolling API snapshots are observations at capture time, never original
    // disclosures that can be backdated to a fiscal period or accession.
    const available = record.form === 'company-facts-snapshot' ? Date.parse(record.firstSeenAt)
      : mode === 'historical' ? Date.parse(record.publicAt) + simulatedDelayMs + executionLatencyMs
        : Math.max(Date.parse(record.publicAt), Date.parse(record.firstSeenAt))
    return available <= Date.parse(decisionTime)
  }).map((record) => ({ ...record, replay: { mode, simulated: mode === 'historical', simulatedDelayMs, decisionTime } }))
}

export async function replayEvidence(archive, decisionTime, options = {}) {
  const mode = options.mode || 'live'
  // Validate even when the archive has no records.
  if (mode === 'historical' && (!Number.isFinite(options.simulatedDelayMs) || options.simulatedDelayMs < 0)) throw new Error('Historical replay requires a predeclared simulated delay')
  if (!['live', 'historical'].includes(mode)) throw new Error('Unknown evaluation mode')
  const documents = await archive.list('evidence', mode === 'historical' ? Date.now() : decisionTime)
  const output = []
  for (const record of documents) {
    const action = earliestAction({ ...record, ...record.execution, ...options, mode })
    if (Date.parse(record.publicAt) > Date.parse(decisionTime) || Date.parse(action) > Date.parse(decisionTime)) continue
    let facts = record.observedFacts
    const reconstructed = mode === 'historical' && Date.parse(record.availableAt) > Date.parse(decisionTime)
    if (reconstructed) {
      // A modern Company Facts response cannot reconstruct old knowledge. Keep
      // only facts whose complete snapshot lineage was observed by the cutoff.
      const supported = []
      for (const fact of facts) {
        const ids = [...new Set([...(fact.inputSnapshotIds || []), ...(fact.priorComparable?.inputSnapshotIds || []), record.source.factSnapshotId].filter(Boolean))]
        if (!ids.length) continue
        const snapshots = await Promise.all(ids.map((id) => archive.get('document', id)))
        if (snapshots.every((s) => s && Date.parse(s.firstSeenAt) <= Date.parse(decisionTime))) supported.push(fact)
      }
      facts = supported
    }
    output.push({ ...record, observedFacts: facts, eligibleAt: action,
      ...(reconstructed ? { interpretation: { thesis: '', adverse: false, needsReview: true }, measurements: { liquidity: null, priceResponse: null, attention: null }, decision: { status: 'eligible', reason: 'Simulated document availability; rerun analysis using only cutoff-time inputs' } } : {}),
      replay: { mode, simulated: mode === 'historical', simulatedDelayMs: options.simulatedDelayMs, decisionTime, analysisMustBeReplayed: reconstructed },
    })
  }
  return output
}

// Dated attention evidence is archived too, while the legacy signal counters
// remain internal to the baseline strategy's score.
export async function archiveAttentionSignals(signals, master, archive, now = new Date().toISOString()) {
  const evidence = []
  for (const signal of signals) for (const ticker of new Set(signal.tickers || [])) {
    const matches = master.resolve({ ticker, asOf: now })
    if (matches.length !== 1) continue
    const security = matches[0]
    const published = Number.isFinite(Date.parse(signal.createdAt)) ? signal.createdAt : now
    const sourceUrl = signal.url || (signal.sourceType === 'screener' ? 'https://finviz.com/screener.ashx' : 'https://x.com/')
    const document = await archive.putDocument({ issuerId: security.issuerId, eventId: signal.id || digest(signal), url: sourceUrl,
      publicAt: iso(published, 'publicAt'), firstSeenAt: now, mediaType: 'application/json',
      availabilityBasis: signal.createdAt ? 'source_timestamp' : 'first_observed', bytes: JSON.stringify(signal) })
    const item = createEvidence({ security, strategyFamily: 'attention', source: { documentId: document.id, eventId: document.eventId, url: sourceUrl,
      type: signal.sourceType || null, labels: signal.sourceLabels || [], excerpt: signal.text || 'Structured screener observation' },
      publicAt: document.publicAt, firstSeenAt: document.firstSeenAt, extractionCompletedAt: now,
      interpretation: { thesis: signal.text || '', role: signal.sourceRole || 'conviction' },
      measurements: { attention: { mentions: 1, publisher: signal.username || null, sourceLabels: signal.sourceLabels || [] } },
      priority: (signal.score || 0) * 10 })
    evidence.push(await archiveEvidence(archive, item))
  }
  return evidence
}
