// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createArchive, digest } from './archive.js'
import { evaluationTestStore } from './evaluationTestStore.js'
import { captureCandidates, neutralInputs, prepareEvaluation, selectArms, freezeEvaluation } from './evaluation.js'
import { ARMS, EVALUATION_ID, experimentDefinition, periodAt } from './evaluationPolicy.js'
import { quietCondition } from './policy.js'
import { createSecurityMaster } from './securityMaster.js'
import * as live from '../researchEngine.js'
import * as frozen from './frozen/engine.js'
import { evaluationReport, evaluationObservations } from './evaluationPerformance.js'

const at = '2026-09-09T12:00:00.000Z'
const identity = (ticker) => ({ ticker, securityId: `figi:${ticker}`, issuerId: `cik:${ticker}`, currency: 'USD', exchange: 'XNAS' })
const evidence = (ticker, family = 'fundamentals', extra = {}) => ({ id: `${ticker}-${family}`, ...identity(ticker), strategyFamily: family,
  publicAt: at, firstSeenAt: at, availableAt: at, extractionCompletedAt: at, priority: 60,
  decision: { status: 'eligible' }, source: { excerpt: 'Revenue increased against the prior comparable quarter.' },
  observedFacts: [{ concept: 'revenue', value: 100 }], interpretation: { thesis: 'Improvement' }, ...extra })
const candidate = (ticker, family = 'fundamentals', attention = 0, extra = {}) => ({ ...identity(ticker), key: `figi:${ticker}:${family}`,
  strategyFamily: family, evidence: [evidence(ticker, family)], evidenceIds: [`${ticker}-${family}`],
  attention, quiet: quietCondition({ attention, repricingPercent: 1 }), price: 100, volume: 1000000, spreadBps: 10,
  sector: 'Technology', reviewable: true, rejection: null, ...extra })
const decision = (c, score = 70) => ({ key: c.key, score, status: 'accepted', reason: 'Supported change', evidenceIds: c.evidenceIds })
const snapshot = (candidates = [candidate('QUIET'), candidate('LOUD', 'fundamentals', 4), candidate('SOCIAL', 'attention', 2)]) => ({
  id: 'input', asOf: at, availableAt: at, definition: experimentDefinition(at), candidates,
  neutralDecisions: candidates.map((c, i) => decision(c, 90 - i * 10)),
  baselinePicks: [{ ticker: 'SOCIAL', finalScore: 80, reason: 'Attention setup' }], failures: [null, null],
})
const select = (s = snapshot(), extra = {}) => selectArms(s, { runId: 'run', decisionAt: at, ...extra })

describe('forward discovery ablation matrix', () => {
  it('keeps six stable versions distinct, with every alternative shadow', () => {
    const rows = select()
    expect(new Set(rows.map((r) => r.arm)).size).toBe(6)
    expect(new Set(rows.map((r) => r.armVersion)).size).toBe(6)
    expect(rows.every((r) => r.cohort === 'shadow' && r.variantsTried === 6)).toBe(true)
    expect(ARMS.every((a) => Object.isFrozen(a.horizons))).toBe(true)
  })

  it('never feeds fundamentals into the frozen baseline pool', () => {
    expect(select().filter((r) => r.arm === 'frozen-existing').map((r) => r.ticker)).toEqual(['SOCIAL'])
    const source = readFileSync(new URL('./frozen/engine.js', import.meta.url), 'utf8')
    expect(source).not.toMatch(/prepareDiscovery|reviewPrimaryCandidates|admitCandidates|stampPick/)
  })

  it('accepts a fundamentals-only candidate with zero social mentions', () => {
    expect(select().find((r) => r.arm === 'fundamentals-only' && r.ticker === 'QUIET')).toMatchObject({ status: 'accepted', attention: 0, horizons: [5, 20] })
  })

  it('disables only the quiet gate in the no-quiet comparison', () => {
    const rows = select()
    expect(rows.find((r) => r.arm === 'fundamentals-only' && r.ticker === 'LOUD').rejectionReason).toBe('quiet_condition_not_met')
    expect(rows.find((r) => r.arm === 'no-quiet' && r.ticker === 'LOUD').status).toBe('accepted')
  })

  it('uses the exact same combined pool and strips attention before the shared review', () => {
    const s = snapshot(), rows = select(s)
    const keys = (arm) => rows.filter((r) => r.arm === arm).map((r) => r.key).sort()
    expect(keys('combined')).toEqual(keys('no-attention'))
    const input = neutralInputs(s.candidates)
    expect(input[2].evidence).toEqual([]) // social interpretations cannot conceal attention
    expect(JSON.stringify(input)).not.toMatch(/"attention":|"quiet":|archetypeScore|finalScore|signalCount/)
    expect(rows.find((r) => r.arm === 'combined' && r.ticker === 'SOCIAL').score).toBe(80)
    expect(rows.find((r) => r.arm === 'no-attention' && r.ticker === 'SOCIAL').score).toBe(42)
  })

  it('preserves baseline selections and scores when the added stream is empty', () => {
    const rows = select(snapshot([candidate('SOCIAL', 'attention', 2), candidate('REJECTED', 'attention', 3)]))
    const accepted = (arm) => rows.filter((r) => r.arm === arm && r.status === 'accepted').map((r) => [r.ticker, r.score])
    expect(accepted('combined')).toEqual(accepted('frozen-existing'))
  })

  it('retains rejected candidates and reasons, including budget exhaustion', () => {
    const s = snapshot([candidate('NO', 'fundamentals', 0, { rejection: 'review_budget_exhausted', reviewable: false })])
    const rows = select(s)
    expect(rows).toHaveLength(5)
    expect(rows.every((r) => r.status === 'rejected' && r.rejectionReason === 'review_budget_exhausted')).toBe(true)
    expect(rows.every((r) => r.evidenceIds.includes('NO-fundamentals'))).toBe(true)
  })

  it('freezes horizons and decision features instead of referencing mutable inputs', () => {
    const s = snapshot(), rows = select(s)
    s.candidates[0].price = 999
    expect(rows.find((r) => r.ticker === 'QUIET').price).toBe(100)
    expect(() => rows[0].horizons.push(60)).toThrow()
    expect(() => { rows[0].decisionAt = '2030-01-01' }).toThrow()
  })

  it('fails closed for unknown quietness without treating it as loud or zero', () => {
    const c = candidate('UNKNOWN', 'fundamentals', null, { quiet: quietCondition({ repricingPercent: 1 }) })
    const rows = select(snapshot([c]))
    expect(rows.find((r) => r.arm === 'fundamentals-only')).toMatchObject({ status: 'rejected', rejectionReason: 'quiet_condition_unknown' })
    expect(rows.find((r) => r.arm === 'no-quiet').status).toBe('accepted')
  })

  it('keeps failure separate from a legitimate empty baseline or neutral decision', () => {
    const s = snapshot(); s.failures = ['model failed', 'model failed']
    expect(select(s).every((r) => r.status === 'rejected')).toBe(true)
    expect(select(s).find((r) => r.arm === 'frozen-existing').rejectionReason).toBe('baseline_unavailable')
  })

  it('rejects invented, duplicate or uncited model decisions', () => {
    const s = snapshot(); s.neutralDecisions[0].evidenceIds = ['invented']
    s.neutralDecisions.push(s.neutralDecisions[1])
    expect(select(s).filter((r) => ['QUIET', 'LOUD'].includes(r.ticker)).every((r) => r.status === 'rejected')).toBe(true)
  })

  it('reserves portfolio exposure across runs and gates missing execution data', () => {
    const active = Array.from({ length: 5 }, (_, i) => ({ ...candidate(`OLD${i}`), portfolio: { weight: 0.1 } }))
    expect(select(snapshot(), { active }).find((r) => r.arm === 'constrained' && r.ticker === 'QUIET').rejectionReason).toBe('concurrent_exposure_limit')
    const s = snapshot([candidate('MISSING', 'fundamentals', 0, { sector: null })])
    expect(select(s).find((r) => r.arm === 'constrained').rejectionReason).toBe('execution_or_sector_data_unavailable')
    expect(select(snapshot(), { active: active.slice(0, 2) }).find((r) => r.arm === 'constrained' && r.ticker === 'QUIET').rejectionReason).toBe('sector_concentration_limit')
  })

  it('does not reconstruct old decisions using future evidence, revisions or prices', () => {
    const s = identity('ABC'), master = createSecurityMaster([{ asOf: '2026-01-01', securities: [s] }])
    const future = '2026-09-10T12:00:00Z'
    const inputs = { baselineBoard: [], technicals: new Map(), quotesByTicker: new Map([['ABC', { price: 99, marketTime: Date.parse(future) / 1000 }]]),
      admission: { candidates: [{ ...s, streams: ['fundamentals'] }], allCandidates: [{ ...s, evidence: [evidence('ABC'), evidence('ABC', 'fundamentals', { id: 'future-revision', availableAt: future })] }] } }
    const rows = captureCandidates(inputs, master, at)
    expect(rows[0].evidenceIds).toEqual(['ABC-fundamentals'])
    expect(rows[0].price).toBeNull()
    expect(JSON.stringify(rows)).not.toContain('future-revision')
  })

  it('does not silently rewrite an archived run or its horizon declarations', async () => {
    const archive = createArchive(evaluationTestStore()), s = snapshot()
    const publication = { generatedAt: at, picksByHorizon: { 5: [], 20: [], 60: [] }, publicationId: 'publication' }
    const first = await freezeEvaluation(archive, s, publication)
    const changed = structuredClone(s); changed.candidates[0].price = 200
    const second = await freezeEvaluation(archive, changed, publication)
    expect(second).toEqual(first)
    expect(second.observations.every((o) => o.horizons.join() === '5,20')).toBe(true)
  })

  it('requires a delivery receipt and never counts carried publications twice', async () => {
    const archive = createArchive(evaluationTestStore()), s = snapshot()
    const p = { ...identity('LIVE'), candidateId: 'candidate', generatedAt: at, horizon: 20, horizons: [5, 20], strategyFamily: 'fundamentals',
      price: 100, evidenceIds: ['e'], modelVersion: 'live-v1', earliestActionAt: at }
    const publication = { generatedAt: at, picksByHorizon: { 5: [], 20: [p], 60: [] }, publicationId: 'p' }
    const run = await freezeEvaluation(archive, s, publication)
    expect((await evaluationObservations(archive, Date.parse(at))).observations.every((o) => o.cohort === 'shadow')).toBe(true)
    await archive.put('evaluation-delivery', run.id, { runId: run.id, availableAt: at }, 'evaluation-deliveries', at)
    expect((await evaluationObservations(archive, Date.parse(at))).observations.filter((o) => o.cohort === 'delivered')).toHaveLength(1)
    const later = await freezeEvaluation(archive, s, { ...publication, generatedAt: '2026-09-09T13:00:00Z' })
    expect(later.observations.every((o) => o.cohort === 'shadow')).toBe(true)
    const report = await evaluationReport(archive, Date.parse(at))
    expect(report.arms.find((a) => a.id === 'delivered').accepted).toBe(1)
    expect(report.arms.filter((a) => a.id !== 'delivered').every((a) => a.cohort === 'shadow')).toBe(true)
  })

  it('does not backdate deferred shadow decisions to the earlier publication', async () => {
    const archive = createArchive(evaluationTestStore())
    const reviewedAt = '2026-09-09T16:00:00.000Z'
    const s = { ...snapshot(), availableAt: reviewedAt }
    const p = { ...identity('LIVE'), candidateId: 'causal-candidate', generatedAt: at, horizon: 20,
      horizons: [5, 20], strategyFamily: 'fundamentals', price: 100, evidenceIds: ['e'],
      modelVersion: 'live-v1', earliestActionAt: '2026-09-09T12:01:00.000Z' }
    const publication = { generatedAt: at, picksByHorizon: { 5: [], 20: [p], 60: [] }, publicationId: 'causal-publication' }

    const run = await freezeEvaluation(archive, s, publication)
    const shadow = run.observations.filter((o) => o.cohort === 'shadow')
    const delivered = run.observations.find((o) => o.cohort === 'delivered')

    expect(run.availableAt).toBe(reviewedAt)
    expect(shadow.every((o) => o.decisionAt === reviewedAt && o.earliestActionAt === '2026-09-09T16:01:00.000Z')).toBe(true)
    expect(delivered).toMatchObject({ decisionAt: at, availableAt: at, earliestActionAt: '2026-09-09T12:01:00.000Z',
      quote: { capturedAt: at } })
  })

  it('predeclares disjoint periods and embargoes instead of moving a sample after seeing results', () => {
    const d = experimentDefinition(at)
    expect(periodAt(d, at)).toBe('development')
    expect(periodAt(d, d.periods[2].start)).toBe('validation')
    expect(periodAt(d, d.periods[4].start)).toBe('final-untouched')
    expect(Date.parse(d.periods[2].start) - Date.parse(d.periods[0].end)).toBe(42 * 86400000)
  })

  it('freezes feedback once and reuses supplied quotes and technicals', async () => {
    const archive = createArchive(evaluationTestStore()), master = createSecurityMaster([])
    const baselineReviewer = vi.fn(async () => []), reviewer = vi.fn(async () => [])
    const inputs = { baselineBoard: [], signals: [], articles: [], quotesByTicker: new Map(), sectorTrends: new Map(),
      coverageHistory: new Map(), technicals: new Map(), performanceStats: { total: 1 }, performanceBlock: 'first' }
    const deps = { archive, master, baselineReviewer, reviewer, contrarian: async (v) => v, catalyst: async (v) => v }
    await prepareEvaluation(inputs, deps)
    await prepareEvaluation({ ...inputs, performanceBlock: 'later outcome', performanceStats: { total: 999 } }, deps)
    expect(baselineReviewer.mock.calls[1][2].inputs.performanceBlock).toBe('first')
    expect((await archive.get('evaluation-learning', EVALUATION_ID)).performanceStats.total).toBe(1)
  })
})

describe('frozen baseline parity', () => {
  it('retains main scoring, gates and post-agent ranking on identical attention inputs', () => {
    const board = [{ ticker: 'ABC', signalCount: 3, sources: ['a', 'b'], convictionMentions: 2, mediaMentions: 2, breakoutSignals: 2, maxScore: 10 }]
    const quotes = new Map([['ABC', { price: 100, changePercent: 1 }]])
    const old = frozen.rankHighUpsideBoard(board, quotes), current = live.rankHighUpsideBoard(board, quotes)
    expect(old).toEqual(current)
    const parsed = [{ ticker: 'ABC', conviction: 8, reason: 'Current signal' }]
    expect(frozen.postProcessCandidates(parsed, old)).toEqual(live.postProcessCandidates(parsed, current))
    const picks = [{ ticker: 'ABC', compositeScore: 40, riskScore: 3, catalystVerified: true, catalystInWindow: true, catalystConfidence: 6 }]
    expect(frozen.finalizePicks(picks)).toEqual(live.finalizePicks(picks))
  })

  it('locks the executable snapshot to its manifest checksums', () => {
    const manifest = JSON.parse(readFileSync(new URL('./frozen/manifest.json', import.meta.url), 'utf8'))
    for (const [file, checksum] of Object.entries(manifest.files)) {
      expect(digest(readFileSync(new URL(`./frozen/${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n'))).toBe(checksum)
    }
  })
})
