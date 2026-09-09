// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createArchive } from './archive.js'
import { createSecurityMaster, refreshSecurityMaster, referenceSecurity, withSecurityMaster } from './securityMaster.js'
import { createEvidence, archiveEvidence, earliestAction, replayEvidence } from './evidence.js'
import { admitCandidates } from './admission.js'
import { ingestIssuer, comparableQuarterlyFacts, parseDailyIndex } from './secDisclosures.js'
import { prepareDiscovery } from './review.js'
import { extractTickersFromText } from '../xSignals.js'
import { selectCandidates, extractTickers } from '../researchEngine.js'
import { sessionCheckpoints, computeLearningStats, EVALUATION_VERSION, RESEARCH_MODEL_VERSION } from '../researchPerformance.js'
import { fetchMarketQuotes } from '../marketQuotes.js'
import { HORIZON_POLICY_VERSION } from './policy.js'

vi.mock('../marketQuotes.js', async (importOriginal) => ({ ...await importOriginal(), fetchMarketQuotes: vi.fn() }))

function memoryRedis() {
  const values = new Map(), indexes = new Map(), writes = []
  return { values, writes,
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
    expect(() => createEvidence({ ...original, security: original, horizon: 5 })).toThrow('Horizon')
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
  const candidate = (id, families, priority = 1, adverse = false) => ({ ...security(id), evidence: families.map((family) => ({ id: `${id}:${family}`, strategyFamily: family, publicAt, availableAt: seenAt, priority, decision: { status: adverse ? 'rejected' : 'eligible', reason: adverse ? 'Material adverse filing' : 'Valid evidence' }, interpretation: { adverse } })) })
  it('honors 12/10/5/3 even when zero-attention candidates have lower priority', () => {
    const board = [...Array.from({ length: 30 }, (_, i) => candidate(`A${i}`, ['attention'], 100)), ...Array.from({ length: 15 }, (_, i) => candidate(`F${i}`, ['fundamentals'])), ...Array.from({ length: 8 }, (_, i) => candidate(`D${i}`, ['filing_changes'])), ...Array.from({ length: 6 }, (_, i) => candidate(`I${i}`, ['insider']))]
    const result = selectCandidates(board, 30, { asOf: reviewedAt, structuredResult: true })
    expect(result.candidates).toHaveLength(30)
    expect(result.audit.reservedUsed).toEqual({ attention: 12, fundamentals: 10, filing_changes: 5, insider: 3 })
  })
  it('merges overlaps into one slot, reallocates only eligible names and records the decision', () => {
    const overlap = candidate('BOTH', ['attention', 'fundamentals'])
    const result = admitCandidates([overlap, { ...overlap, evidence: [candidate('BOTH', ['insider']).evidence[0]] }, ...Array.from({ length: 29 }, (_, i) => candidate(`A${i}`, ['attention']))], { asOf: reviewedAt })
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
    const result = admitCandidates([popular, adverse, future], { asOf: reviewedAt })
    expect(result.candidates).toEqual([])
    expect(result.audit.rejected.find((r) => r.securityId === popular.securityId).reason).toBe('Material adverse filing')
    expect(() => admitCandidates([], { budgets: { attention: 30 } })).toThrow('exactly 30')
  })
})

describe('zero-mention end-to-end acceptance', () => {
  it('ingests an SEC filing, archives the original, reserves a review slot, fetches one quote and publishes a longer-horizon idea', async () => {
    const archive = createArchive(memoryRedis(), { objectStore: memoryObjectStore() }), master = masterFor(security())
    const accession = '0000000001-26-000001'
    const submissions = { filings: { recent: { accessionNumber: [accession], form: ['10-Q'], acceptanceDateTime: [publicAt], filingDate: ['2026-02-01'], reportDate: ['2025-12-31'], primaryDocument: ['quarter.htm'] } } }
    const facts = { facts: { 'us-gaap': { Revenues: { units: { USD: [{ accn: accession, val: 120, start: '2025-10-01', end: '2025-12-31', fy: 2025, fp: 'Q4' }] } } } } }
    const client = { request: vi.fn(async (url) => url.includes('/submissions/') ? submissions : url.includes('/companyfacts/') ? facts : Buffer.from('<DOCUMENT><TYPE>10-Q\n<TEXT>Revenue increased to 120 from 100.</TEXT></DOCUMENT>')) }
    expect(parseDailyIndex(`1|QUIET Corporation|10-Q|2026-02-01|edgar/data/1/${accession}.txt`, master, reviewedAt)).toHaveLength(1)
    const ingested = await ingestIssuer(archive, master, '1', { client, since: early, now: () => seenAt })
    expect(ingested.evidence.map((e) => e.horizon).sort()).toEqual([20, 60])
    expect((await archive.readDocument(ingested.evidence[0].source.documentId)).bytes.toString()).toContain('Revenue increased')
    const admission = await prepareDiscovery([], [], { archive, master }, { asOf: reviewedAt, select: (candidates, options) => selectCandidates(candidates, 30, { ...options, structuredResult: true }) })
    expect(admission.candidates).toHaveLength(1)
    expect(admission.candidates[0].streams).not.toContain('attention')
    const reviewer = vi.fn(async ({ horizon, candidates }) => candidates.flatMap((c) => [...new Set(c.evidence.map((e) => e.strategyFamily))].map((strategyFamily) => ({ securityId: c.securityId, strategyFamily, horizon, status: 'accepted', score: 75, reason: 'Revenue growth merits further work', evidenceIds: c.evidence.filter((e) => e.strategyFamily === strategyFamily).map((e) => e.id) }))))
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
    expect(reviewer).toHaveBeenCalledTimes(2)
    expect(reviewer.mock.calls.every(([input]) => input.candidates[0].measurements.attention === 0)).toBe(true)
    expect(reviewed.picksByHorizon[20][0]).toMatchObject({ ticker: 'QUIET', strategyFamily: 'fundamentals', horizon: 20, signalCount: 0, earliestActionAt: '2026-02-02T12:02:00.000Z' })
    expect(reviewed.picksByHorizon[60][0].horizon).toBe(60)
    expect(reviewed.picksByHorizon[5]).toBeUndefined()
    expect(await archive.list('admissions', reviewedAt)).toHaveLength(1)
    expect(await archive.list('reviews', reviewedAt)).toHaveLength(1)
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
