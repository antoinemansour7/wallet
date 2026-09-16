// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createArchive, digest } from './archive.js'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { createObjectStore } from './objectStore.js'
import { loadFoundation, syncFoundation } from './foundation.js'
import { createSecurityMaster, refreshSecurityMaster, referenceSecurity, withSecurityMaster } from './securityMaster.js'
import { createEvidence, archiveEvidence, earliestAction, replayEvidence } from './evidence.js'
import { admitCandidates } from './admission.js'
import { ingestIssuer, comparableQuarterlyFacts, parseDailyIndex } from './secDisclosures.js'
import { prepareDiscovery, primaryDocumentPassages, primaryModelCandidates, reviewPrimaryCandidates } from './review.js'
import { extractTickersFromText } from '../xSignals.js'
import { selectCandidates, extractTickers } from '../researchEngine.js'
import { sessionCheckpoints, computeLearningStats, EVALUATION_VERSION, RESEARCH_MODEL_VERSION } from '../researchPerformance.js'
import { fetchMarketQuotes } from '../marketQuotes.js'
import { HORIZON_POLICY_VERSION, STRATEGIES } from './policy.js'

vi.mock('../marketQuotes.js', async (importOriginal) => ({ ...await importOriginal(), fetchMarketQuotes: vi.fn() }))

function memoryRedis() {
  const values = new Map(), indexes = new Map(), writes = []
  return { values, writes,
    async eval(script, keys, args) {
      if (values.get(keys[0]) !== args[0]) return 0
      return Number(values.delete(keys[0]))
    },
    async zrem(key, member) { return Number(indexes.get(key)?.delete(member)) },
    async zcard(key) { return indexes.get(key)?.size || 0 },
    async del(key) { return Number(values.delete(key)) },
    async get(key) { return structuredClone(values.get(key) ?? null) },
    async set(key, value, options = {}) { writes.push({ key, options }); if (options.nx && values.has(key)) return null; values.set(key, structuredClone(value)); return 'OK' },
    async zadd(key, { score, member }) { if (!indexes.has(key)) indexes.set(key, new Map()); indexes.get(key).set(member, score) },
    async zrange(key, start, stop, options = {}) {
      const items = [...(indexes.get(key) || [])].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      if (!options.byScore) return items.slice(start, stop + 1).map(([key]) => key)
      const bound = (value) => (value === '-inf' ? -Infinity : value === '+inf' ? Infinity : Number(value))
      // REV reverses the argument order too: the first bound becomes the maximum.
      const [min, max] = options.rev ? [bound(stop), bound(start)] : [bound(start), bound(stop)]
      const matched = items.filter(([, score]) => score >= min && score <= max)
      if (options.rev) matched.reverse()
      const offset = options.offset || 0
      return matched.slice(offset, offset + (options.count ?? matched.length)).map(([key]) => key)
    },
  }
}

// Stands in for the private bucket: write-once objects keyed by content digest.
function memoryObjectStore() {
  const objects = new Map()
  return { objects,
    async putIfAbsent(key, bytes) { if (!objects.has(key)) objects.set(key, Buffer.from(bytes)) },
    async get(key) {
      const value = objects.get(key)
      if (!value) throw new Error('Archive object GET failed (404)')
      return value
    },
  }
}
const early = '2026-01-01T00:00:00.000Z', publicAt = '2026-02-01T20:00:00.000Z', seenAt = '2026-02-02T12:00:00.000Z', reviewedAt = '2026-02-02T12:01:00.000Z'
const security = (ticker = 'QUIET', id = ticker, cik = '0000000001') => ({ securityId: `figi:${id}`, issuerId: `cik:${cik}`, name: `${ticker} Corporation`, ticker, currency: 'USD', exchange: 'XNAS', type: 'common_stock', countryOfListing: 'US' })
const masterFor = (...securities) => createSecurityMaster([{ asOf: early, securities }])
async function evidenceFixture(archive, family = 'fundamentals', s = security(), overrides = {}) {
  const document = await archive.putDocument({ issuerId: s.issuerId, accession: '0000000001-26-000001', url: 'https://www.sec.gov/original.htm', publicAt, firstSeenAt: seenAt, bytes: '<p>Revenue increased to 120 from 100.</p>' })
  const evidence = createEvidence({ security: s, strategyFamily: family, source: { documentId: document.id, accession: document.accession, url: document.url, excerpt: 'Revenue increased to 120 from 100.' }, publicAt, firstSeenAt: seenAt, extractionCompletedAt: seenAt, priority: 50, ...overrides })
  return archiveEvidence(archive, evidence)
}

describe('stable common-stock identity', () => {
  it('resolves legitimate word-like symbols without extracting uppercase prose', () => {
    const master = masterFor(...['A', 'AI', 'ALL', 'AMD', 'NVDA'].map((t) => security(t)))
    expect(extractTickersFromText('AI EBITDA ALL CEO $A $AI $ALL NASDAQ:AMD NVDA Corporation', master)).toEqual(['A', 'AI', 'ALL', 'AMD', 'NVDA'])
    expect(extractTickersFromText('AI ALL CEO EBITDA')).toEqual([])
    expect(withSecurityMaster(master, () => extractTickersFromText('$NVDA'))).toEqual(['NVDA'])
    expect(extractTickersFromText('$NVDA')).toEqual([]) // no shared mutable identity context
  })
  it('keeps ticker reuse and dual listings apart, resolving a filing by issuer', () => {
    const old = security('SAME', 'old'), replacement = security('SAME', 'new', '0000000002')
    const renamed = { ...old, ticker: 'NEW' }, otherClass = { ...old, securityId: 'figi:classB', ticker: 'NEW.B' }
    const master = createSecurityMaster([{ asOf: early, securities: [old] }, { asOf: seenAt, securities: [replacement, renamed, otherClass] }])
    expect(master.resolve({ ticker: 'SAME', asOf: publicAt })[0].securityId).toBe('figi:old')
    expect(master.resolve({ ticker: 'SAME', asOf: reviewedAt })[0].securityId).toBe('figi:new')
    expect(master.resolve({ issuer: '1', asOf: reviewedAt }).map((s) => s.securityId)).toEqual(['figi:old', 'figi:classB'])
    expect(master.text('SAME Corporation', reviewedAt)).toEqual([])
    expect(masterFor(old, { ...old, securityId: 'figi:dual', exchange: 'XNYS' }).text('$SAME')).toEqual([])
  })
  it('rejects non-common or unresolved listings and publishes only complete pagination', async () => {
    expect(referenceSecurity({ ticker: 'FUND', type: 'ETF' })).toBeNull()
    vi.stubEnv('POLYGON_API_KEY', 'fixture')
    const archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() })
    const row = { market: 'stocks', locale: 'us', type: 'CS', active: true, cik: '1', composite_figi: 'ONE', primary_exchange: 'XNAS', currency_name: 'usd', ticker: 'ONE', name: 'One Corporation' }
    const failing = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ results: [row], next_url: 'https://api.massive.com/page2' }) }).mockResolvedValueOnce({ ok: false, status: 503 })
    await expect(refreshSecurityMaster(archive, { fetchImpl: failing, pause: async () => {} })).rejects.toThrow('503')
    expect(await archive.list('masters')).toEqual([])
    const passing = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ results: [row], next_url: 'https://api.massive.com/page2' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ ...row, ticker: 'TWO', composite_figi: 'TWO' }] }) })
    const snapshot = await refreshSecurityMaster(archive, { fetchImpl: passing, pause: async () => {} })
    expect(snapshot.securities).toHaveLength(2)
    vi.unstubAllEnvs()
  })
})

describe('immutable archive, evidence and causal time', () => {
  it('preserves original bytes, first observation and amendments without a TTL', async () => {
    const redis = memoryRedis(), archive = createArchive(redis, { objectStore: memoryObjectStore() })
    const original = await evidenceFixture(archive)
    const first = await archive.readDocument(original.source.documentId)
    const repeated = await archive.putDocument({ ...first, firstSeenAt: reviewedAt })
    expect(repeated.firstSeenAt).toBe(seenAt)
    expect(first.bytes.toString()).toContain('120 from 100')
    const amended = await archive.putDocument({ ...first, accession: '0000000001-26-000002', publicAt: reviewedAt, firstSeenAt: reviewedAt, bytes: 'Amended revenue: 90' })
    expect(amended.id).not.toBe(first.id)
    expect((await archive.readDocument(first.id)).bytes.toString()).toContain('120 from 100')
    expect(redis.writes.every((w) => w.options.nx && !w.options.ex)).toBe(true)
  })
  it('requires historical delay and keeps future disclosures and late ingestion out of live replay', async () => {
    const archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() })
    await evidenceFixture(archive)
    expect(await replayEvidence(archive, publicAt)).toEqual([])
    expect(await replayEvidence(archive, reviewedAt)).toHaveLength(1)
    await expect(replayEvidence(archive, publicAt, { mode: 'historical' })).rejects.toThrow('simulated delay')
    const replay = await replayEvidence(archive, '2026-02-01T20:02:00Z', { mode: 'historical', simulatedDelayMs: 60000 })
    expect(replay).toHaveLength(1)
    expect(replay[0].replay.simulated).toBe(true)
    expect(await replayEvidence(archive, '2026-01-30T00:00:00Z', { mode: 'historical', simulatedDelayMs: 0 })).toEqual([])
    expect(earliestAction({ publicAt, firstSeenAt: seenAt, extractionCompletedAt: reviewedAt })).toBe('2026-02-02T12:02:00.000Z')
  })
  it('never backdates a modern facts snapshot or later adverse analysis into historical replay', async () => {
    const archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() })
    const base = await evidenceFixture(archive)
    const snapshot = await archive.putDocument({ issuerId: base.issuerId, accession: base.source.accession, form: 'company-facts-snapshot', url: 'https://data.sec.gov/facts.json', publicAt: seenAt, firstSeenAt: seenAt, bytes: '{"Revenues":90}' })
    await archiveEvidence(archive, createEvidence({ ...base, security: base,
      source: { ...base.source, factSnapshotId: snapshot.id },
      observedFacts: [{ concept: 'us-gaap:Revenues', value: 90, units: 'USD', periodEnd: '2025-12-31', inputSnapshotIds: [snapshot.id] }],
      interpretation: { thesis: 'Later accounting concern', adverse: true }, decision: { status: 'rejected', reason: 'Later accounting concern' },
    }))
    const simulated = await replayEvidence(archive, '2026-02-01T21:00:00Z', { mode: 'historical', simulatedDelayMs: 60000 })
    expect(simulated.every((e) => e.observedFacts.length === 0 && e.interpretation.adverse === false && e.replay.analysisMustBeReplayed)).toBe(true)
    const amendment = await archive.putDocument({ issuerId: base.issuerId, accession: '0000000001-26-000002', url: 'https://www.sec.gov/amendment.htm', publicAt: reviewedAt, firstSeenAt: reviewedAt, bytes: 'Amended revenue 90' })
    await archiveEvidence(archive, createEvidence({ ...base, security: base, publicAt: reviewedAt, firstSeenAt: reviewedAt, extractionCompletedAt: reviewedAt,
      source: { documentId: amendment.id, accession: amendment.accession, url: amendment.url, excerpt: 'Amended revenue 90' } }))
    expect((await replayEvidence(archive, '2026-02-01T21:00:00Z', { mode: 'historical', simulatedDelayMs: 60000 })).some((e) => e.source.documentId === amendment.id)).toBe(false)
  })
  it('locks horizon at creation and makes inference corrections distinct', async () => {
    const archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() })
    const original = await evidenceFixture(archive)
    // Fundamentals predeclares 5 and 20, so naming either is allowed and both
    // still rank on 20. Naming a horizon it never declared is the retrospective
    // pick, and still throws.
    expect(createEvidence({ ...original, security: original, horizon: 5 }).horizon).toBe(20)
    expect(createEvidence({ ...original, security: original, horizon: 5 }).horizons).toEqual([5, 20])
    expect(() => createEvidence({ ...original, security: original, horizon: 60 })).toThrow('Horizon')
    const revised = createEvidence({ ...original, security: original, decision: { status: 'rejected', reason: 'Material accounting discrepancy' } })
    expect(revised.id).not.toBe(original.id)
    expect(Object.isFrozen(revised.decision)).toBe(true)
  })
})

describe('quarterly comparability', () => {
  const flow = (value, end, accession, timestamp, extra = {}) => ({ concept: 'us-gaap:Revenues', units: 'USD', value, periodStart: '2025-01-01', periodEnd: end, accession, publicAt: timestamp, ...extra })
  it('derives Q2 from YTD amounts without using a later restatement', () => {
    const facts = [flow(100, '2025-03-31', 'Q1', '2025-05-01'), flow(250, '2025-06-30', 'Q2', '2025-08-01'), flow(80, '2025-03-31', 'Q1/A', '2025-09-01')]
    const quarter = comparableQuarterlyFacts(facts, '2025-10-01').find((f) => f.accession === 'Q2')
    expect(quarter.value).toBe(150)
    expect(quarter.periodStart).toBe('2025-04-01')
    expect(quarter.inputs).toEqual(['Q2', 'Q1'])
  })
  it('does not subtract EPS or incompatible units, or manufacture absent comparables', () => {
    const base = [flow(1, '2025-03-31', 'Q1', '2025-05-01'), flow(2, '2025-06-30', 'Q2', '2025-08-01')]
    expect(comparableQuarterlyFacts(base.map((f) => ({ ...f, concept: 'us-gaap:EarningsPerShareDiluted', units: 'USD/shares' })), '2025-09-01')).toHaveLength(1)
    expect(comparableQuarterlyFacts([base[0], { ...base[1], units: 'CAD' }], '2025-09-01')).toHaveLength(1)
    expect(comparableQuarterlyFacts([base[1]], '2025-09-01')).toEqual([])
  })
})

describe('stream admission', () => {
  const allStrategies = Object.keys(STRATEGIES)
  const candidate = (id, families, priority = 1, adverse = false) => ({ ...security(id), evidence: families.map((family) => ({ id: `${id}:${family}`, strategyFamily: family, horizon: family === 'fundamentals' ? 20 : family === 'attention' ? 5 : 60,
    source: family === 'attention' ? { url: 'https://x.com/research/status/1', type: 'account', labels: ['@research'] } : { url: 'https://www.sec.gov/filing.htm', accession: 'fixture' },
    publicAt, availableAt: seenAt, priority, decision: { status: adverse ? 'rejected' : 'eligible', reason: adverse ? 'Material adverse filing' : 'Valid evidence' }, interpretation: { adverse } })) })
  it('honors 12/10/5/3 even when zero-attention candidates have lower priority', () => {
    const board = [...Array.from({ length: 30 }, (_, i) => candidate(`A${i}`, ['attention'], 100)), ...Array.from({ length: 15 }, (_, i) => candidate(`F${i}`, ['fundamentals'])), ...Array.from({ length: 8 }, (_, i) => candidate(`D${i}`, ['filing_changes'])), ...Array.from({ length: 6 }, (_, i) => candidate(`I${i}`, ['insider']))]
    const result = selectCandidates(board, 30, { asOf: reviewedAt, structuredResult: true, enabledStrategies: allStrategies })
    expect(result.candidates).toHaveLength(30)
    expect(result.audit.reservedUsed).toEqual({ attention: 12, fundamentals: 10, filing_changes: 5, insider: 3 })
  })
  it('merges overlaps into one slot, reallocates only eligible names and records the decision', () => {
    const overlap = candidate('BOTH', ['attention', 'fundamentals'])
    const result = admitCandidates([overlap, { ...overlap, evidence: [candidate('BOTH', ['insider']).evidence[0]] }, ...Array.from({ length: 29 }, (_, i) => candidate(`A${i}`, ['attention']))], { asOf: reviewedAt, enabledStrategies: allStrategies })
    expect(result.candidates).toHaveLength(30)
    expect(new Set(result.candidates.map((c) => c.securityId)).size).toBe(30)
    expect(result.candidates.find((c) => c.ticker === 'BOTH').evidence).toHaveLength(3)
    expect(result.audit.reallocations.length).toBeGreaterThan(0)
    expect(result.audit.reallocations.every((a) => a.to === 'attention')).toBe(true)
  })
  it('rejects popular stocks on adverse evidence and ignores future events', () => {
    const popular = candidate('POPULAR', ['attention'], 100)
    const adverse = candidate('POPULAR', ['filing_changes'], 0, true)
    const future = candidate('FUTURE', ['fundamentals']); future.evidence[0].publicAt = '2030-01-01'
    const result = admitCandidates([popular, adverse, future], { asOf: reviewedAt, enabledStrategies: allStrategies })
    expect(result.candidates).toEqual([])
    expect(result.audit.rejected.find((r) => r.securityId === popular.securityId).reason).toBe('Material adverse filing')
    expect(() => admitCandidates([], { budgets: { attention: 30 } })).toThrow('exactly 30')
  })
  it('records identity, evidence, ranks, stream usage and the names immediately below each cutoff', () => {
    const board = [
      ...Array.from({ length: 12 }, (_, i) => candidate(`A${i}`, ['attention'], 100 - i)),
      ...Array.from({ length: 11 }, (_, i) => candidate(`F${i}`, ['fundamentals'], 90 - i)),
      ...Array.from({ length: 5 }, (_, i) => candidate(`D${i}`, ['filing_changes'], 70 - i)),
      ...Array.from({ length: 3 }, (_, i) => candidate(`I${i}`, ['insider'], 60 - i)),
    ]

    const result = admitCandidates(board, { asOf: reviewedAt, enabledStrategies: allStrategies })
    const excluded = result.audit.notReviewed.find((item) => item.ticker === 'F10')
    const fundamentals = result.audit.streams.find((stream) => stream.strategy === 'fundamentals')

    expect(result.candidates).toHaveLength(30)
    expect(result.audit.funnel).toEqual({ discovered: 31, eligible: 31, admitted: 30, notReviewed: 1, rejected: 0 })
    expect(excluded).toMatchObject({
      ticker: 'F10', name: 'F10 Corporation', securityId: 'figi:F10', priority: 80,
      streams: ['fundamentals'], streamRanks: { fundamentals: 11 }, reason: 'review_budget_exhausted',
      sources: ['SEC'], budgetUsage: { fundamentals: { configured: 10, reservedUsed: 10, selected: 10, reallocatedIn: 0, reallocatedOut: 0 } },
    })
    expect(excluded.evidence[0]).toMatchObject({ id: 'F10:fundamentals', strategy: 'fundamentals', horizon: 20, source: 'SEC', type: 'SEC filing' })
    expect(fundamentals).toMatchObject({ configured: 10, reservedUsed: 10, selected: 10, waiting: 1, reallocatedIn: 0, reallocatedOut: 0 })
    expect(fundamentals.lowestAdmitted).toMatchObject({ ticker: 'F9', priority: 81, streamRanks: { fundamentals: 10 } })
    expect(fundamentals.belowCutoff[0]).toMatchObject({ ticker: 'F10', priority: 80, priorityGap: 1 })
    expect(excluded).toMatchObject({ legacyPriority: 80, priorityModel: { usedForAdmission: true, score: 80, streamScores: { fundamentals: 80 } } })
    expect(excluded).toMatchObject({ legacyOverallRank: expect.any(Number), legacyStreamRanks: { fundamentals: expect.any(Number) } })
    expect(result.candidates.map((item) => item.ticker)).toContain('A0')
  })
  it('uses v2 to change attention admission while leaving the 12/10/5/3 allocation intact', () => {
    const loud = candidate('LOUD', ['attention'], 100)
    const rich = candidate('RICH', ['attention'], 50)
    rich.evidence = Array.from({ length: 4 }, (_, index) => ({ ...rich.evidence[0], id: `RICH:${index}`,
      source: { ...rich.evidence[0].source, documentId: `rich-doc-${index}`, url: `https://x.com/source${index}/status/${index}`,
        excerpt: '$RICH earnings are scheduled for September 18, 2026 with $2.4B guidance.' },
      measurements: { attention: { publisher: `source${index}` } },
    }))
    const board = [loud, rich,
      ...Array.from({ length: 11 }, (_, index) => candidate(`A${index}`, ['attention'], 90 - index)),
      ...Array.from({ length: 10 }, (_, index) => candidate(`F${index}`, ['fundamentals'], 70 - index)),
      ...Array.from({ length: 5 }, (_, index) => candidate(`D${index}`, ['filing_changes'], 60 - index)),
      ...Array.from({ length: 3 }, (_, index) => candidate(`I${index}`, ['insider'], 50 - index)),
    ]

    const result = admitCandidates(board, { asOf: reviewedAt, enabledStrategies: allStrategies })
    const selected = new Set(result.candidates.map((item) => item.ticker))
    const richAudit = result.audit.selected.find((item) => item.ticker === 'RICH')
    const displacedAudit = result.audit.notReviewed.find((item) => item.ticker === 'A10')

    expect(selected.has('LOUD')).toBe(true)
    expect(selected.has('RICH')).toBe(true)
    expect(selected.has('A10')).toBe(false)
    expect(richAudit.legacyStreamRanks.attention).toBe(13)
    expect(richAudit.streamRanks.attention).toBe(1)
    expect(richAudit.priority).toBeGreaterThan(displacedAudit.priority)
    expect(richAudit.legacyPriority).toBeLessThan(displacedAudit.legacyPriority)
    expect(result.audit.reservedUsed).toEqual({ attention: 12, fundamentals: 10, filing_changes: 5, insider: 3 })
    expect(result.audit.priorityModel).toEqual({ version: 'attention-review-priority-v2', usedForAdmission: true })
  })

  it('rejects deferred evidence and reallocates its reserved slots to active streams', () => {
    const board = [
      ...Array.from({ length: 20 }, (_, index) => candidate(`A${index}`, ['attention'], 100 - index)),
      ...Array.from({ length: 15 }, (_, index) => candidate(`F${index}`, ['fundamentals'], 80 - index)),
      candidate('DEFERRED-FILING', ['filing_changes'], 100),
      candidate('DEFERRED-INSIDER', ['insider'], 100),
    ]

    const result = admitCandidates(board, { asOf: reviewedAt })

    expect(result.candidates).toHaveLength(30)
    expect(result.candidates.every((item) => item.streams.every((stream) => ['attention', 'fundamentals'].includes(stream)))).toBe(true)
    expect(result.audit.admissionPolicy).toEqual({ version: 'strategy-admission-v1', enabledStrategies: ['attention', 'fundamentals'] })
    expect(result.audit.reservedUsed).toEqual({ attention: 12, fundamentals: 10, filing_changes: 0, insider: 0 })
    expect(result.audit.reallocations.filter((item) => ['filing_changes', 'insider'].includes(item.from))).toHaveLength(8)
    expect(result.audit.rejected.filter((item) => item.reason === 'strategy_not_enabled').map((item) => item.ticker).sort())
      .toEqual(['DEFERRED-FILING', 'DEFERRED-INSIDER'])
  })

  it('strips archived deferred evidence before a mixed candidate reaches review', () => {
    const active = candidate('MIXED', ['fundamentals'], 70)
    const deferred = candidate('MIXED', ['filing_changes'], 100, true)

    const result = admitCandidates([active, deferred], { asOf: reviewedAt })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].streams).toEqual(['fundamentals'])
    expect(result.candidates[0].evidence.map((item) => item.strategyFamily)).toEqual(['fundamentals'])
    expect(result.candidates[0].priority).toBe(70)
  })
})

describe('zero-mention end-to-end acceptance', () => {
  it('ingests an SEC filing, archives the original, and publishes only the active fundamentals idea', async () => {
    const archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() }), master = masterFor(security())
    const accession = '0000000001-26-000001'
    const submissions = { filings: { recent: { accessionNumber: [accession], form: ['10-Q'], acceptanceDateTime: [publicAt], filingDate: ['2026-02-01'], reportDate: ['2025-12-31'], primaryDocument: ['quarter.htm'] } } }
    const facts = { facts: { 'us-gaap': { Revenues: { units: { USD: [{ accn: accession, val: 120, start: '2025-10-01', end: '2025-12-31', fy: 2025, fp: 'Q4' }] } } } } }
    const client = { request: vi.fn(async (url) => url.includes('/submissions/') ? submissions : url.includes('/companyfacts/') ? facts : Buffer.from('<DOCUMENT><TYPE>10-Q\n<TEXT>Revenue increased to 120 from 100.</TEXT></DOCUMENT>')) }
    expect(parseDailyIndex(`1|QUIET Corporation|10-Q|2026-02-01|edgar/data/1/${accession}.txt`, master, reviewedAt)).toHaveLength(1)
    const ingested = await ingestIssuer(archive, master, '1', { client, since: early, now: () => seenAt })
    expect(ingested.evidence.map((e) => e.horizon)).toEqual([20])
    expect((await archive.readDocument(ingested.evidence[0].source.documentId)).bytes.toString()).toContain('Revenue increased')
    const admission = await prepareDiscovery([], [], { archive, master }, { asOf: reviewedAt, select: (candidates, options) => selectCandidates(candidates, 30, { ...options, structuredResult: true }) })
    expect(admission.candidates).toHaveLength(1)
    expect(admission.candidates[0].streams).not.toContain('attention')
    const reviewer = vi.fn(async ({ horizon, candidates }) => candidates.flatMap((c) => [...new Set(c.evidence.map((e) => e.strategyFamily))].map((strategyFamily) => {
      const evidenceIds = c.evidence.filter((e) => e.strategyFamily === strategyFamily).map((e) => e.id)
      return { securityId: c.securityId, strategyFamily, horizon, status: 'accepted', score: 75,
        reason: 'Revenue growth merits further work', evidenceIds, reasonSourceIds: evidenceIds,
        bearCase: null, bearCaseSourceIds: [], materialAdverse: false }
    })))
    vi.useFakeTimers()
    vi.setSystemTime(new Date(reviewedAt))
    vi.stubEnv('ANTHROPIC_API_KEY', 'offline-fixture')
    fetchMarketQuotes.mockResolvedValue({ quotes: [{ requestedSymbol: 'QUIET', symbol: 'QUIET', price: 12, currency: 'USD', volume: 100000 }] })
    let reviewed
    try {
      const baseline = await withSecurityMaster(master, () => extractTickers([], [], {
        foundation: { archive, master, reviewer, now: () => reviewedAt },
        onPrimaryReview: (result) => { reviewed = result },
      }))
      expect(baseline).toEqual([])
      expect(fetchMarketQuotes).toHaveBeenCalledTimes(1)
      expect(fetchMarketQuotes.mock.calls[0][0].filter((ticker) => ticker === 'QUIET')).toHaveLength(1)
    } finally { vi.useRealTimers(); vi.unstubAllEnvs() }
    expect(reviewer).toHaveBeenCalledTimes(1)
    expect(reviewer.mock.calls.every(([input]) => input.candidates[0].measurements.attention === 0)).toBe(true)
    expect(reviewed.picksByHorizon[20][0]).toMatchObject({ ticker: 'QUIET', strategyFamily: 'fundamentals', horizon: 20, signalCount: 0, earliestActionAt: '2026-02-02T12:02:00.000Z' })
    // #107: the pick carries both predeclared horizons and the experiment arm it
    // was assigned at decision time. Neither can be reconstructed later, so if
    // they are not stamped here the comparison can never be run.
    expect(reviewed.picksByHorizon[20][0].horizons).toEqual([5, 20])
    expect(reviewed.picksByHorizon[20][0].experiment).toMatchObject({ version: 'fundamentals-quiet-v1', attention: 0 })
    // Zero mentions and no measured day change is the quiet arm.
    expect(reviewed.picksByHorizon[20][0].experiment.quiet).toBe(null)
    expect(reviewed.picksByHorizon[60]).toEqual([])
    expect(reviewed.picksByHorizon[5]).toBeUndefined()
    expect(await archive.list('admissions', reviewedAt)).toHaveLength(1)
    expect(await archive.list('reviews', reviewedAt)).toHaveLength(1)
  })

  it('archives a Form 4 without emitting placeholder insider evidence', async () => {
    const archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() }), master = masterFor(security())
    const accession = '0000000001-26-000004'
    const submissions = { filings: { recent: { accessionNumber: [accession], form: ['4'], acceptanceDateTime: [publicAt], filingDate: ['2026-02-01'], reportDate: ['2026-02-01'], primaryDocument: ['form4.xml'] } } }
    const client = { request: vi.fn(async (url) => url.includes('/submissions/') ? submissions : Buffer.from('<ownershipDocument><issuerTradingSymbol>QUIET</issuerTradingSymbol></ownershipDocument>')) }

    const ingested = await ingestIssuer(archive, master, '1', { client, since: early, now: () => seenAt })

    expect(ingested.documents.length).toBeGreaterThan(0)
    expect(ingested.evidence).toEqual([])
    expect((await archive.readDocument(ingested.documents[0].id)).bytes.toString()).toContain('ownershipDocument')
  })
})

describe('primary review prompt budget', () => {
  it('starts a new forward cohort for the materially different evidence packet', () => {
    expect(RESEARCH_MODEL_VERSION).toBe('evidence-v5-gpt-5.4-mini')
  })

  it('keeps core comparable facts while bounding documents and excerpts', () => {
    const incidental = Array.from({ length: 59 }, (_, index) => ({ concept: `OtherFact${index}`, value: index }))
    const revenue = { concept: 'us-gaap:Revenues', value: 120, priorComparable: { value: 100 } }
    const [candidate] = primaryModelCandidates([{
      securityId: 'figi:QUIET', ticker: 'QUIET', horizon: 20,
      evidence: [{
        id: 'evidence-1', strategyFamily: 'fundamentals', decision: { status: 'eligible' },
        observedFacts: [...incidental, revenue], interpretation: { thesis: 'Revenue improved' }, publicAt,
        source: { documentId: 'document-1', url: 'https://www.sec.gov/filing', excerpt: 'e'.repeat(2000) },
      }],
      documents: [
        { id: 'document-1', text: 'a'.repeat(5000), truncated: false },
        { id: 'document-2', text: 'b'.repeat(5000), truncated: false },
      ],
      omittedDocuments: 0, measurements: {},
    }])
    expect(candidate.evidence[0].observedFacts).toHaveLength(16)
    expect(candidate.evidence[0].observedFacts).toContainEqual(revenue)
    expect(candidate.evidence[0].source.excerpt).toHaveLength(1200)
    expect(candidate.documents).toHaveLength(2)
    expect(candidate.documents.flatMap((document) => document.passages).reduce((sum, item) => sum + item.text.length, 0)).toBe(5000)
    expect(candidate.documents.every((document) => document.passages[0].id && document.truncated)).toBe(true)
  })

  it('finds relevant filing content after an irrelevant cover page', () => {
    const document = { id: 'late-content', bytes: Buffer.from(`${'Cover page boilerplate. '.repeat(250)} Management expects revenue growth next quarter. ${'More boilerplate. '.repeat(250)} The company disclosed a material weakness and liquidity risk.`) }
    const passages = primaryDocumentPassages(document)
    const supplied = passages.map((item) => item.text).join(' ')

    expect(supplied).toContain('Management expects revenue growth next quarter')
    expect(supplied).toContain('material weakness')
    expect(supplied.length).toBeLessThanOrEqual(2500)
    expect(passages.every((item) => item.id && Number.isInteger(item.start))).toBe(true)
  })

  it('puts an EX-99 earnings release ahead of its 8-K shell and preserves claim citations', async () => {
    const archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() })
    const primary = await archive.putDocument({ issuerId: security().issuerId, accession: '0000000001-26-000008', form: '8-K',
      url: 'https://www.sec.gov/8k.htm', publicAt, firstSeenAt: seenAt, bytes: '<p>Item 2.02. Results of Operations. See exhibit.</p>' })
    const release = await archive.putDocument({ issuerId: security().issuerId, accession: primary.accession, form: 'EX-99.1',
      url: 'https://www.sec.gov/release.htm', publicAt, firstSeenAt: seenAt,
      bytes: `<h1>Quarterly results</h1><p>Revenue increased 20 percent and operating cash flow improved.</p><p>Debt remains a material downside risk.</p>${'<p>Appendix</p>'.repeat(300)}` })
    const evidence = await archiveEvidence(archive, createEvidence({ security: security(), strategyFamily: 'fundamentals',
      source: { documentId: primary.id, accession: primary.accession, url: primary.url, excerpt: 'Results were furnished in Exhibit 99.1.', exhibitIds: [release.id] },
      publicAt, firstSeenAt: seenAt, extractionCompletedAt: seenAt, interpretation: { thesis: 'Measured improvement requires review.' }, priority: 70 }))
    const admission = { id: 'admission-exhibit', asOf: reviewedAt, candidates: [{ ...security(), evidence: [evidence], streams: ['fundamentals'] }] }
    const reviewer = vi.fn(async ({ horizon, candidates }) => {
      const candidate = candidates[0]
      const sourceId = candidate.documents[0].passages[0].id
      return [{ securityId: candidate.securityId, strategyFamily: 'fundamentals', horizon, status: 'accepted', score: 80,
        reason: 'The release reports improved revenue and cash flow.', materialAdverse: false, evidenceIds: [evidence.id],
        reasonSourceIds: [sourceId], bearCase: 'Debt remains a downside risk.', bearCaseSourceIds: [sourceId] }]
    })

    const reviewed = await reviewPrimaryCandidates(admission, new Map([['QUIET', { price: 12, currency: 'USD', volume: 100000 }]]),
      { archive, reviewer, now: () => reviewedAt })
    const input = reviewer.mock.calls[0][0].candidates[0]

    expect(input.documents.map((document) => document.role)).toEqual(['earnings_release', 'primary_filing'])
    expect(input.documents[0]).toMatchObject({ id: release.id, form: 'EX-99.1' })
    expect(input.documents[0].passages.map((item) => item.text).join(' ')).toContain('Revenue increased 20 percent')
    expect(reviewed.picksByHorizon[20][0].citations).toMatchObject({
      reason: [input.documents[0].passages[0].id], bearCase: [input.documents[0].passages[0].id],
      sources: [{ id: input.documents[0].passages[0].id, type: 'passage', documentId: release.id, url: release.url }],
    })
    expect(reviewed.picksByHorizon[20][0].sources).toContain(release.url)
  })

  it('rejects reviewer prose that cites a source outside the supplied packet', async () => {
    const archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() })
    const document = await archive.putDocument({ issuerId: security().issuerId, accession: '0000000001-26-000009', form: '10-Q',
      url: 'https://www.sec.gov/10q.htm', publicAt, firstSeenAt: seenAt, bytes: '<p>Revenue increased from the prior comparable period.</p>' })
    const evidence = await archiveEvidence(archive, createEvidence({ security: security(), strategyFamily: 'fundamentals',
      source: { documentId: document.id, accession: document.accession, url: document.url, excerpt: 'Revenue increased.' },
      publicAt, firstSeenAt: seenAt, extractionCompletedAt: seenAt, priority: 70 }))
    const admission = { id: 'admission-invalid-citation', asOf: reviewedAt, candidates: [{ ...security(), evidence: [evidence], streams: ['fundamentals'] }] }
    const reviewer = async ({ horizon, candidates }) => [{ securityId: candidates[0].securityId, strategyFamily: 'fundamentals', horizon,
      status: 'accepted', score: 99, reason: 'Unsupported claim.', materialAdverse: false, evidenceIds: [evidence.id],
      reasonSourceIds: ['invented-source'], bearCase: null, bearCaseSourceIds: [] }]

    const reviewed = await reviewPrimaryCandidates(admission, new Map([['QUIET', { price: 12, currency: 'USD' }]]),
      { archive, reviewer, now: () => reviewedAt })

    expect(reviewed.picksByHorizon[20]).toEqual([])
    expect(reviewed.decisions).toContainEqual(expect.objectContaining({ status: 'rejected', reason: 'Reviewer returned an invalid or unsupported decision' }))
  })

  it('rejects an acceptance supported only by a filing header', async () => {
    const archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() })
    const document = await archive.putDocument({ issuerId: security().issuerId, accession: '0000000001-26-000010', form: '8-K',
      url: 'https://www.sec.gov/header-only.htm', publicAt, firstSeenAt: seenAt, bytes: '<p>Item 2.02. Results of Operations. See furnished exhibit.</p>' })
    const evidence = await archiveEvidence(archive, createEvidence({ security: security(), strategyFamily: 'fundamentals',
      source: { documentId: document.id, accession: document.accession, url: document.url, excerpt: 'Item 2.02. See furnished exhibit.' },
      publicAt, firstSeenAt: seenAt, extractionCompletedAt: seenAt, priority: 30 }))
    const admission = { id: 'admission-header-only', asOf: reviewedAt, candidates: [{ ...security(), evidence: [evidence], streams: ['fundamentals'] }] }
    const reviewer = async ({ horizon, candidates }) => [{ securityId: candidates[0].securityId, strategyFamily: 'fundamentals', horizon,
      status: 'accepted', score: 90, reason: 'A filing exists.', materialAdverse: false, evidenceIds: [evidence.id],
      reasonSourceIds: [evidence.id], bearCase: null, bearCaseSourceIds: [] }]

    const reviewed = await reviewPrimaryCandidates(admission, new Map([['QUIET', { price: 12, currency: 'USD' }]]),
      { archive, reviewer, now: () => reviewedAt })

    expect(reviewed.picksByHorizon[20]).toEqual([])
    expect(reviewed.decisions).toContainEqual(expect.objectContaining({ status: 'rejected', reason: 'Reviewer returned an invalid or unsupported decision' }))
  })
})

describe('predeclared evaluation cohorts', () => {
  it('waits for the first open after analysis and records the twentieth and sixtieth session', () => {
    const candles = Array.from({ length: 65 }, (_, i) => ({ timestamp: Date.parse('2026-02-02T14:30:00Z') + i * 86400000, date: `session-${i}`, open: 100, close: 101 + i, high: 110 + i }))
    const policy = { strategyFamily: 'filing_changes', horizon: 60, horizonPolicyVersion: HORIZON_POLICY_VERSION, earliestActionAt: '2026-02-02T14:31:00Z' }
    const result = sessionCheckpoints(candles, publicAt, Date.parse('2026-06-01'), candles, 20, policy)
    expect(result.map((r) => r.horizon)).toEqual([1, 3, 5, 10, 20, 60])
    expect(result[0].entryDate).toBe('session-1')
    expect(result.at(-1).exitDate).toBe('session-60')
    expect(() => sessionCheckpoints(candles, publicAt, Date.now(), [], 20, { ...policy, horizon: 5 })).toThrow('cohort')
  })
  it('does not train the baseline on twenty-session or legacy results', () => {
    const record = { ticker: 'QUIET', pickDate: '2026-01-01', modelVersion: RESEARCH_MODEL_VERSION, evaluationVersion: EVALUATION_VERSION, horizon: 20, horizonPolicyVersion: HORIZON_POLICY_VERSION, strategyFamily: 'fundamentals', net_return_day5: -2, excess_return_day5: -3, exit_date_day5: '2026-01-08', net_return_day20: 10, excess_return_day20: 8, exit_date_day20: '2026-02-01' }
    expect(computeLearningStats([record], Date.parse(seenAt)).total).toBe(0)
    expect(computeLearningStats([record, { ...record, ticker: 'OLD', evaluationVersion: 'old' }], Date.parse(seenAt), { horizon: 20 })).toMatchObject({ total: 1, horizon: 20, avgNetReturn: 10 })
  })
})

describe('low-cost reference ingestion', () => {
  const row = { market: 'stocks', locale: 'us', type: 'CS', active: true, cik: '1', composite_figi: 'QUIET', primary_exchange: 'XNAS', currency_name: 'usd', ticker: 'QUIET', name: 'Quiet Corporation' }
  const page = (results, next_url) => ({ ok: true, json: async () => ({ results, next_url }) })
  function clock() {
    let timestamp = Date.parse(seenAt)
    return { now: () => new Date(timestamp).toISOString(), pause: vi.fn(async (ms) => { timestamp += ms }), advance: (ms) => { timestamp += ms } }
  }
  it('paces Basic pagination, honors Retry-After, and keeps credentials out of cursors', async () => {
    vi.stubEnv('MASSIVE_API_KEY', 'basic-fixture')
    const time = clock(), redis = memoryRedis(), archive = createArchive(redis)
    const starts = []
    const responses = [page([row], 'https://api.massive.com/page2?apiKey=do-not-cache'),
      { ok: false, status: 429, headers: new Headers({ 'Retry-After': '60' }) }, page([{ ...row, ticker: 'TWO', composite_figi: 'TWO' }])]
    const fetchImpl = vi.fn(async () => { starts.push(Date.parse(time.now())); return responses.shift() })
    try {
      const result = await refreshSecurityMaster(archive, { redis, ...time, fetchImpl, date: seenAt.slice(0, 10) })
      expect(result.complete).toBe(true)
      expect(result.securities).toHaveLength(2)
      expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(13000)
      expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(60000)
      expect(fetchImpl.mock.calls.every(([url]) => !url.includes('apiKey'))).toBe(true)
      expect(JSON.stringify([...redis.values])).not.toContain('basic-fixture')
    } finally { vi.unstubAllEnvs() }
  })
  it('resumes an unfinished dated master next day without publishing a partial universe', async () => {
    vi.stubEnv('MASSIVE_API_KEY', 'basic-fixture')
    const redis = memoryRedis(), archive = createArchive(redis), time = clock()
    const fetchImpl = vi.fn().mockResolvedValueOnce(page([row], 'https://api.massive.com/page2')).mockResolvedValueOnce(page([{ ...row, ticker: 'TWO', composite_figi: 'TWO' }]))
    try {
      const first = await refreshSecurityMaster(archive, { redis, ...time, fetchImpl, date: '2026-02-02', deadline: Date.parse(time.now()) + 25000 })
      expect(first).toMatchObject({ complete: false, pages: 1 })
      expect(await archive.list('masters')).toEqual([])
      time.advance(86400000)
      const second = await refreshSecurityMaster(archive, { redis, ...time, fetchImpl, date: '2026-02-03' })
      expect(second).toMatchObject({ complete: true, asOf: '2026-02-02T23:59:59.999Z' })
      expect(second.securities).toHaveLength(2)
      expect(fetchImpl.mock.calls[1][0]).toBe('https://api.massive.com/page2')
      expect(await archive.list('masters')).toHaveLength(1)
    } finally { vi.unstubAllEnvs() }
  })
  it('defers a long provider cooldown and respects it on another invocation', async () => {
    vi.stubEnv('MASSIVE_API_KEY', 'basic-fixture')
    const redis = memoryRedis(), archive = createArchive(redis), time = clock()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429, headers: new Headers({ 'Retry-After': new Date(Date.parse(seenAt) + 3600000).toUTCString() }) })
    try {
      expect(await refreshSecurityMaster(archive, { redis, ...time, fetchImpl })).toMatchObject({ complete: false })
      expect(await refreshSecurityMaster(archive, { redis, ...time, fetchImpl })).toMatchObject({ complete: false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(await archive.list('masters')).toEqual([])
    } finally { vi.unstubAllEnvs() }
  })
  it('rejects cursor loops and foreign hosts without publishing a partial master', async () => {
    vi.stubEnv('MASSIVE_API_KEY', 'basic-fixture')
    try {
      for (const foreign of [true, false]) {
        const archive = createArchive(memoryRedis()), time = clock()
        const fetchImpl = vi.fn(async (url) => page([row], foreign ? 'https://example.com/steal-key' : url))
        await expect(refreshSecurityMaster(archive, { ...time, fetchImpl })).rejects.toThrow(foreign ? 'Untrusted' : 'pagination')
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(await archive.list('masters')).toEqual([])
      }
    } finally { vi.unstubAllEnvs() }
  })
  it('keeps a 36-hour-old master cached and lets nightly discovery use stale identity during an outage', async () => {
    const redis = memoryRedis(), archive = createArchive(redis)
    await archive.put('master', 'cached', { asOf: early, availableAt: early, securities: [security()] }, 'masters', early)
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    vi.stubEnv('MASSIVE_API_KEY', 'basic-fixture')
    try {
      const cached = await loadFoundation({ redis, archive, refresh: true, now: '2026-01-03T00:00:00Z', masterOptions: { fetchImpl } })
      expect(cached.masterRefresh.status).toBe('cached')
      expect(fetchImpl).not.toHaveBeenCalled()
      const stale = await loadFoundation({ redis, archive, refresh: true, now: seenAt, masterOptions: { fetchImpl } })
      expect(stale.masterRefresh).toMatchObject({ status: 'stale', error: expect.stringContaining('503') })
      expect(stale.master.securities()[0].ticker).toBe('QUIET')
      fetchImpl.mockClear()
      const nightly = await loadFoundation({ redis, archive, now: seenAt, masterOptions: { fetchImpl } })
      expect(nightly.master.securities()).toHaveLength(1)
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally { vi.unstubAllEnvs() }
  })
  it('drains the backlog with several staggered daily ingestion runs, still Hobby-compatible', () => {
    const config = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'))
    const fields = (entry) => entry.schedule.split(' ')
    const ingestion = config.crons.filter((entry) => entry.path === '/api/research-foundation')
    const research = fields(config.crons.find((entry) => entry.path === '/api/nightly-research'))
    // More than one run a day is the whole point — the pilot's single 04:00 run
    // could not keep pace with SEC arrivals.
    expect(ingestion.length).toBeGreaterThanOrEqual(4)
    // Each entry must itself be a once-per-day expression or Hobby rejects the
    // deployment; minute and hour are fixed, day/month/weekday are wildcards.
    const hours = ingestion.map((entry) => {
      const [minute, hour, dom, month, dow] = fields(entry)
      expect(minute).toBe('0')
      expect([dom, month, dow]).toEqual(['*', '*', '*'])
      return Number(hour)
    }).sort((a, b) => a - b)
    // At least one run lands well before the 07:00 ranking, and no two runs are
    // close enough for Hobby's within-the-hour jitter to make them collide.
    expect(Math.min(...hours)).toBeLessThanOrEqual(Number(research[1]) - 2)
    for (let i = 1; i < hours.length; i++) expect(hours[i] - hours[i - 1]).toBeGreaterThanOrEqual(2)
    expect(config.functions['api/research-foundation.js'].maxDuration).toBe(300)
  })
})

describe('private object archive and migration', () => {
  const metadata = { issuerId: security().issuerId, accession: '0000000001-26-000001', url: 'https://www.sec.gov/original.htm', publicAt, firstSeenAt: seenAt }
  it('stores document bytes only in the object bucket and fails without publishing on a PUT error', async () => {
    const redis = memoryRedis(), objectStore = memoryObjectStore(), archive = createArchive(redis, { objectStore })
    const bytes = Buffer.from('large original SEC document\n'.repeat(100000))
    const document = await archive.putDocument({ ...metadata, bytes })
    expect((await archive.readDocument(document.id)).bytes.equals(bytes)).toBe(true)
    expect(objectStore.objects.size).toBe(1)
    expect([...redis.values.keys()].filter((key) => /:blob:.*:\d+$/.test(key))).toEqual([])
    expect(JSON.stringify([...redis.values]).length).toBeLessThan(2000)
    objectStore.putIfAbsent = vi.fn().mockRejectedValue(new Error('Object PUT failed'))
    await expect(archive.putDocument({ ...metadata, bytes: 'a new revision' })).rejects.toThrow('PUT failed')
    expect(await archive.list('documents')).toHaveLength(1)
  })
  it('reads legacy chunks, verifies migration before pruning, and preserves document identity/timestamps', async () => {
    const redis = memoryRedis(), objectStore = memoryObjectStore(), archive = createArchive(redis, { objectStore })
    const bytes = Buffer.from('original legacy filing'), sha256 = digest(bytes), id = 'legacy-document'
    const blobKey = `research:archive:v1:blob:${sha256}`
    const document = { ...metadata, id, sha256, byteLength: bytes.length, availableAt: seenAt }
    await archive.put('document', id, document, 'documents', seenAt)
    await redis.set(blobKey, { chunks: 1, sha256, byteLength: bytes.length })
    await redis.set(`${blobKey}:0`, gzipSync(bytes).toString('base64'))
    expect((await archive.readDocument(id)).bytes.equals(bytes)).toBe(true)
    const get = objectStore.get
    objectStore.get = vi.fn(async () => gzipSync('corrupt object'))
    await expect(archive.migrateDocumentBlob(id, { deleteRedisChunks: true })).rejects.toThrow('checksum mismatch')
    expect(await redis.get(blobKey)).toHaveProperty('chunks', 1)
    expect(await redis.get(`${blobKey}:0`)).not.toBeNull()
    objectStore.get = get
    expect(await archive.migrateDocumentBlob(id)).toMatchObject({ migrated: true, deletedChunks: 0 })
    expect(await redis.get(`${blobKey}:0`)).not.toBeNull()
    expect(await archive.migrateDocumentBlob(id, { deleteRedisChunks: true })).toMatchObject({ migrated: false, deletedChunks: 1 })
    expect(await redis.get(`${blobKey}:0`)).toBeNull()
    expect(await archive.get('document', id)).toEqual(document)
    expect((await archive.readDocument(id)).bytes.equals(bytes)).toBe(true)
  })
  it('stores large research records in R2 and safely migrates legacy Redis records', async () => {
    const redis = memoryRedis(), objectStore = memoryObjectStore(), archive = createArchive(redis, { objectStore })
    const fact = { issuerId: 'cik:0000000001', availableAt: seenAt, facts: [{ concept: 'Revenue', detail: 'x'.repeat(10000) }] }
    expect(await archive.put('facts', 'new-fact', fact, 'facts:cik:0000000001', seenAt)).toEqual(fact)
    expect(redis.values.get('research:archive:v1:facts:new-fact')).toMatchObject({ storage: 'r2-json-gzip-v1', byteLength: expect.any(Number) })
    expect(await archive.get('facts', 'new-fact')).toEqual(fact)
    expect(await archive.list('facts:cik:0000000001')).toEqual([fact])

    const evidence = { id: 'legacy-evidence', availableAt: seenAt, observedFacts: [{ detail: 'y'.repeat(10000) }] }
    await redis.set('research:archive:v1:evidence:legacy-evidence', evidence)
    await redis.zadd('research:archive:v1:index:evidence', { score: Date.parse(seenAt), member: 'research:archive:v1:evidence:legacy-evidence' })
    expect(await archive.migrateRecord('evidence', 'legacy-evidence')).toMatchObject({ migrated: true, byteLength: expect.any(Number) })
    expect(redis.values.get('research:archive:v1:evidence:legacy-evidence')).toMatchObject({ storage: 'r2-json-gzip-v1' })
    expect(await archive.get('evidence', 'legacy-evidence')).toEqual(evidence)
    expect(await archive.latest('evidence')).toEqual(evidence)
    expect(await archive.migrateRecord('evidence', 'legacy-evidence')).toMatchObject({ migrated: false })

    for (const kind of ['admission', 'evaluation-job-input', 'evaluation-input', 'evaluation-run']) {
      const record = { id: `${kind}-1`, availableAt: seenAt, payload: 'z'.repeat(10000) }
      expect(await archive.put(kind, record.id, record, kind, seenAt)).toEqual(record)
      expect(redis.values.get(`research:archive:v1:${kind}:${record.id}`)).toMatchObject({ storage: 'r2-json-gzip-v1' })
      expect(await archive.get(kind, record.id)).toEqual(record)
    }
  })
  it('signs private R2 requests, uses conditional writes, and reports missing objects', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 412 })).mockResolvedValueOnce(new Response(Buffer.from('compressed bytes'))).mockResolvedValueOnce(new Response(null, { status: 404 }))
    const objectStore = createObjectStore({ endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'research-fixture', accessKeyId: 'fixture-id', secretAccessKey: 'fixture-secret', fetchImpl })
    const key = `research/documents/v1/${'a'.repeat(64)}.gz`
    await objectStore.putIfAbsent(key, Buffer.from('compressed bytes'))
    expect((await objectStore.get(key)).toString()).toBe('compressed bytes')
    const request = fetchImpl.mock.calls[0][0]
    expect(request.headers.get('authorization')).toContain('AWS4-HMAC-SHA256')
    expect(request.headers.get('if-none-match')).toBe('*')
    expect(request.headers.get('content-encoding')).toBeNull()
    expect(request.redirect).toBe('error')
    await expect(objectStore.get(key)).rejects.toThrow('404')
  })
  it('retries transient object-store transport failures', async () => {
    const bytes = Buffer.from('compressed bytes')
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(bytes))
    const objectStore = createObjectStore({ endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'research-fixture', accessKeyId: 'fixture-id', secretAccessKey: 'fixture-secret', fetchImpl })
    const key = `research/records/v1/evidence/${'b'.repeat(64)}.json.gz`
    expect((await objectStore.get(key)).equals(bytes)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})


describe('daily ingestion work budget', () => {
  it('does not overlap runs or refetch completed daily indexes', async () => {
    const redis = memoryRedis(), archive = createArchive(redis, { objectStore: memoryObjectStore() })
    await archive.put('master', 'cached', { asOf: early, availableAt: early, securities: [security()] }, 'masters', early)
    const client = { request: vi.fn(async () => Buffer.from('CIK|Company Name|Form Type|Date Filed|Filename')) }
    await redis.set('research:foundation:lock:v1', 'other-run')
    expect(await syncFoundation({ redis, archive, client, refresh: false })).toMatchObject({ skipped: 'already_running' })
    expect(client.request).not.toHaveBeenCalled()
    await redis.del('research:foundation:lock:v1')
    const result = await syncFoundation({ redis, archive, client, refresh: false, now: seenAt })
    expect(result).toMatchObject({ universe: 1, pending: 0, errors: [] })
    expect(client.request).toHaveBeenCalledTimes(5)
    expect(await redis.get('research:foundation:lock:v1')).toBeNull()
    client.request.mockClear()
    await syncFoundation({ redis, archive, client, refresh: false, now: seenAt })
    expect(client.request).not.toHaveBeenCalled()
  })
  it('keeps unfinished index work resumable when the runtime budget is nearly spent', async () => {
    const redis = memoryRedis(), archive = createArchive(redis, { objectStore: memoryObjectStore() })
    await archive.put('master', 'cached', { asOf: early, availableAt: early, securities: [security()] }, 'masters', early)
    const client = { request: vi.fn(async () => Buffer.from('1|QUIET Corporation|10-Q|2026-01-30|edgar/data/1/0000000001-26-000001.txt')) }
    const result = await syncFoundation({ redis, archive, client, refresh: false, now: seenAt, deadline: Date.now() + 60000 })
    expect(result.pending).toBe(0)
    expect(await redis.get('research:disclosures:index:2026-01-30')).toMatchObject({ cursor: 0, complete: false })
    expect(await redis.get('research:foundation:lock:v1')).toBeNull()
  })
})


it('uses a newly bootstrapped master for ingestion in the same invocation', async () => {
  const redis = memoryRedis(), archive = createArchive(redis, { objectStore: memoryObjectStore() })
  const client = { request: vi.fn(async (url) => url.includes('/daily-index/')
    ? Buffer.from('1|QUIET Corporation|10-Q|2026-01-30|edgar/data/1/0000000001-26-000001.txt')
    : { filings: { recent: { accessionNumber: [] } } }) }
  vi.stubEnv('MASSIVE_API_KEY', 'basic-fixture')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ results: [{ market: 'stocks', locale: 'us', type: 'CS', active: true, cik: '1', composite_figi: 'QUIET', primary_exchange: 'XNAS', currency_name: 'usd', ticker: 'QUIET', name: 'Quiet Corporation' }] }) })))
  try {
    const result = await syncFoundation({ redis, archive, client, now: new Date(Date.now() - 10000).toISOString() })
    expect(result.masterRefresh.status).toBe('refreshed')
    expect(result.completed.length).toBeGreaterThan(0)
    expect(result.completed[0].issuerId).toBe(security().issuerId)
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
})

// An ingestion credential must not decide whether any research runs. Identity
// comes from the reference provider; SEC_USER_AGENT only buys filings. When it
// was built in syncUnlocked's parameter list, its absence threw before the
// master could publish, and nightly research then had no way to resolve a
// ticker from any source — attention included — so it returned 503 nightly.
describe('disclosure ingestion is optional, identity is not', () => {
  it('publishes the security master and reports the gap when SEC_USER_AGENT is unset', async () => {
    vi.stubEnv('SEC_USER_AGENT', '')
    try {
      const redis = memoryRedis(), archive = createArchive(redis, { objectStore: memoryObjectStore() })
      await archive.put('master', 'cached', { asOf: early, availableAt: early, securities: [security()] }, 'masters', early)

      // No client passed: the real one cannot be built without the variable.
      const result = await syncFoundation({ redis, archive, refresh: false, now: seenAt })

      expect(result.universe).toBe(1)
      expect(result.completed).toEqual([])
      expect(result.errors).toContainEqual(expect.objectContaining({ stage: 'sec-client' }))
      // The run is still auditable rather than a thrown 500.
      expect(result.errors[0].message).toMatch(/SEC_USER_AGENT/)
    } finally { vi.unstubAllEnvs() }
  })

  it('leaves nightly research able to load identity, so discovery still runs', async () => {
    vi.stubEnv('SEC_USER_AGENT', '')
    try {
      const redis = memoryRedis(), archive = createArchive(redis, { objectStore: memoryObjectStore() })
      await archive.put('master', 'cached', { asOf: early, availableAt: early, securities: [security()] }, 'masters', early)
      await syncFoundation({ redis, archive, refresh: false, now: seenAt })

      const foundation = await loadFoundation({ redis, archive, now: seenAt })
      expect(foundation.master.securities().length).toBe(1)
      // The whole point: a ticker still resolves, so signals still yield names.
      expect(withSecurityMaster(foundation.master, () => extractTickersFromText('watching $QUIET here'))).toEqual(['QUIET'])
    } finally { vi.unstubAllEnvs() }
  })
})

// #107: a filing carrying its own prior-year comparative should reach review as
// a measured improvement, not as "a new filing exists". The XBRL of a real 10-Q
// tags both the current quarter and the year-ago comparative to the same
// accession, which is what makes this computable from one filing.
describe('fundamentals discovery emits measured improvement', () => {
  const accession = '0000000001-26-000001'
  const submissions = { filings: { recent: { accessionNumber: [accession], form: ['10-Q'], acceptanceDateTime: [publicAt], filingDate: ['2026-02-01'], reportDate: ['2025-12-31'], primaryDocument: ['quarter.htm'] } } }
  const usd = (values) => ({ units: { USD: values.map((v) => ({ ...v, accn: accession })) } })
  const quarter = (val, year) => ({ val, start: `${year}-10-01`, end: `${year}-12-31`, fy: year, fp: 'Q4' })

  const clientFor = (facts) => ({
    request: vi.fn(async (url) => url.includes('/submissions/') ? submissions
      : url.includes('/companyfacts/') ? facts
        : Buffer.from('<DOCUMENT><TYPE>10-Q\n<TEXT>Revenue increased to 120 from 100.</TEXT></DOCUMENT>')),
  })

  const ingest = async (facts) => {
    const archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() })
    const result = await ingestIssuer(archive, masterFor(security()), '1', { client: clientFor(facts), since: early, now: () => seenAt })
    return result.evidence.find((e) => e.strategyFamily === 'fundamentals')
  }

  it('attaches inspectable features, both period ends and the filing behind them', async () => {
    const evidence = await ingest({ facts: { 'us-gaap': {
      Revenues: usd([quarter(120, 2025), quarter(100, 2024)]),
      OperatingIncomeLoss: usd([quarter(24, 2025), quarter(10, 2024)]),
    } } })

    const growth = evidence.interpretation.features.find((f) => f.name === 'revenueGrowth')
    expect(growth.value).toBeCloseTo(0.2, 6)
    expect(growth.prior.periodEnd).toBe('2024-12-31')
    expect(growth.current.accession).toBe(accession)
    expect(evidence.interpretation.periodEnd).toBe('2025-12-31')
    expect(evidence.interpretation.features.some((f) => f.name === 'operatingMarginChange')).toBe(true)
    // Derived features live in interpretation; observedFacts stays the filing's
    // own reported facts, so inference is never mistaken for evidence.
    expect(evidence.observedFacts.every((f) => f.accession === accession)).toBe(true)
    expect(evidence.observedFacts.some((f) => f.name)).toBe(false)
  })

  it('writes a thesis that compares to the prior period and never claims a beat', async () => {
    const evidence = await ingest({ facts: { 'us-gaap': { Revenues: usd([quarter(120, 2025), quarter(100, 2024)]) } } })
    expect(evidence.interpretation.thesis).toMatch(/previous comparable period/)
    expect(evidence.interpretation.thesis).toMatch(/not an analyst expectation/)
    expect(evidence.interpretation.thesis).not.toMatch(/\b(beat|surprise|consensus)\b/i)
  })

  it('ranks a measured improvement above a filing with nothing to compare', async () => {
    const measured = await ingest({ facts: { 'us-gaap': {
      Revenues: usd([quarter(120, 2025), quarter(100, 2024)]),
      OperatingIncomeLoss: usd([quarter(24, 2025), quarter(10, 2024)]),
    } } })
    const bare = await ingest({ facts: { 'us-gaap': { Revenues: usd([quarter(120, 2025)]) } } })

    expect(measured.priority).toBeGreaterThan(bare.priority)
    // The bare filing keeps the neutral placeholder rather than inventing one.
    expect(bare.interpretation.thesis).toMatch(/have not been determined/)
    expect(bare.interpretation.features).toBeUndefined()
  })

  it('separates an acquisition instead of scoring it as operating growth', async () => {
    const evidence = await ingest({ facts: { 'us-gaap': {
      Revenues: usd([quarter(200, 2025), quarter(100, 2024)]),
      PaymentsToAcquireBusinessesNetOfCashAcquired: usd([quarter(5000, 2025)]),
    } } })

    const flag = evidence.interpretation.contamination.find((f) => f.kind === 'acquisition')
    expect(flag.fact.accession).toBe(accession)
    expect(evidence.interpretation.thesis).toMatch(/Separated from operating improvement/)
    // The growth itself is still reported; the flag sits beside it.
    expect(evidence.interpretation.features.find((f) => f.name === 'revenueGrowth').value).toBeCloseTo(1, 6)
  })
})
