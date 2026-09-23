// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { createArchive } from '../research/archive.js'
import { memoryObjectStore, memoryRedis } from '../../test/memoryRedis.js'
import { SHADOW_CALL as CALL, SHADOW_PUT as PUT, optionsShadowFixture } from '../../test/optionsShadowFixture.js'
import { optionsAuditRecord } from './auditStore.js'
import { OPTIONS_SHADOW_CHECKPOINTS, buildOptionsShadowView } from './shadowView.js'
import { filterShadowRows, summarizeShadowRows } from '../../pages/options/shadowSummary.js'

let archive, fixture
const view = (at, extra = {}) => buildOptionsShadowView({ archive, now: () => Date.parse(at), ...extra })
const row = (result, contractId) => result.rows.find((item) => item.contractId === contractId)
const checkpoint = (item, key) => item.checkpoints.find((point) => point.key === key)

beforeEach(async () => { ({ archive, fixture } = await optionsShadowFixture()) })

describe('shadow-test progress', () => {
  it('counts sessions from the first published morning and keeps empty, degraded, missing and pending days', async () => {
    const result = await view('2026-09-28T15:00:00.000Z')
    expect(result.window).toMatchObject({ startDate: '2026-09-22', today: '2026-09-28', session: 5, completed: false,
      latestObservationDate: '2026-09-23', publishedCandidates: 2 })
    expect(result.targetSessions).toBe(20)
    expect(result.days.map((day) => [day.tradingDate, day.status])).toEqual([
      ['2026-09-22', 'candidates'], ['2026-09-23', 'empty'], ['2026-09-24', 'degraded'], ['2026-09-25', 'missing'], ['2026-09-28', 'pending'],
    ])
    expect(result.window.dayCounts).toEqual({ candidates: 1, empty: 1, degraded: 1, missing: 1, pending: 1 })
    expect(result.limitations.join(' ')).toMatch(/cannot establish a statistical edge/)
  })

  it('reports that the test has not started instead of inventing progress', async () => {
    const empty = createArchive(memoryRedis(), { objectStore: memoryObjectStore() })
    const result = await buildOptionsShadowView({ archive: empty, now: () => Date.parse('2026-09-28T15:00:00Z') })
    expect(result).toMatchObject({ window: null, days: [], rows: [] })
  })
})

describe('frozen selection and tracked outcomes', () => {
  it('keeps selection-time values and evaluates winning, losing, unknown and not-yet-due checkpoints', async () => {
    const before = JSON.stringify(fixture.records)
    const result = await view('2026-09-28T15:00:00.000Z')
    const call = row(result, CALL), put = row(result, PUT)
    expect(call).toMatchObject({ ticker: 'EX', direction: 'call', strikePrice: 200, expirationDate: '2026-10-22', dteAtSelection: 30, status: 'open',
      frozen: { bid: 5.45, ask: 5.55, mid: 5.5, underlyingPrice: 180, quoteMarketAt: '2026-09-22T13:32:15.000Z', selectedAt: '2026-09-22T13:32:20.000Z', dataState: 'theoretical' } })
    expect(checkpoint(call, '0').returnPct).toBeGreaterThan(0)
    expect(checkpoint(put, '0').returnPct).toBeLessThan(0)
    expect(checkpoint(call, '1').returnPct).toBeGreaterThan(0)
    expect(checkpoint(put, '1')).toMatchObject({ status: 'provider_snapshot_absent', returnPct: null })
    expect(checkpoint(call, '3')).toMatchObject({ status: 'missing_exit_quote', returnPct: null })
    expect(checkpoint(call, '5')).toMatchObject({ status: 'unexpired_horizon', returnPct: null })
    expect(call.latest).toMatchObject({ key: '1', label: '+1 session' })
    expect(call.targets.filter((target) => target.state === 'observed_hit').map((target) => [target.targetPct, target.whileOtm])).toEqual([[25, true], [50, true]])
    expect(call.gainedWhileOtm).toBe(true)
    expect(put.gainedWhileOtm).toBe(false)
    expect(call.path.maximumObservedReturnPct).toBeGreaterThan(checkpoint(call, '1').returnPct)
    expect(put.path.maximumAdverseExcursionPct).toBeLessThan(0)
    expect(JSON.stringify(fixture.records)).toBe(before)
    expect(JSON.stringify(result.rows)).not.toMatch(/rawId|rawReferenceHash|diagnostics|greeks/)
  })

  it('moves rows to completed after +10 sessions and to expired after the contract expires', async () => {
    expect(row(await view('2026-10-07T15:00:00.000Z'), CALL).status).toBe('completed')
    expect(row(await view('2026-10-23T15:00:00.000Z'), CALL).status).toBe('expired')
  })

  it('shows a pick without its outcome plan as missing rather than hiding it', async () => {
    const readRecord = async (archiveRef, type, id) => (type === 'outcome' ? null : optionsAuditRecord(archiveRef, type, id))
    const result = await view('2026-09-28T15:00:00.000Z', { readRecord })
    expect(result.rows.map((item) => [item.contractId, item.status, item.reason])).toEqual([
      [CALL, 'missing', 'outcome_plan_unavailable'], [PUT, 'missing', 'outcome_plan_unavailable'],
    ])
  })

  it('reads a day whose compaction is missing from its raw batches, with identical results', async () => {
    const withRollup = await view('2026-09-28T15:00:00.000Z')
    const bare = createArchive(memoryRedis(), { objectStore: memoryObjectStore() })
    const rawOnly = { ...archive, list: (index, ...rest) => (index === 'options-observation-days' ? bare.list(index, ...rest) : archive.list(index, ...rest)) }
    const withoutRollup = await buildOptionsShadowView({ archive: rawOnly, now: () => Date.parse('2026-09-28T15:00:00.000Z') })
    expect(withoutRollup.rows).toEqual(withRollup.rows)
  })
})

describe('aggregate denominators', () => {
  it('discloses matured, observed and unknown counts per horizon, with no unknown counted as zero', async () => {
    const { rows } = await view('2026-09-28T15:00:00.000Z')
    const summary = summarizeShadowRows(rows, OPTIONS_SHADOW_CHECKPOINTS)
    const horizon = (key) => summary.horizons.find((item) => item.key === key)
    expect(horizon('0')).toMatchObject({ matured: 2, observed: 2, unknown: 0, positive: 1, negative: 1, best: { contractId: CALL }, worst: { contractId: PUT } })
    expect(horizon('0').medianReturnPct).toBeCloseTo((checkpoint(row({ rows }, CALL), '0').returnPct + checkpoint(row({ rows }, PUT), '0').returnPct) / 2, 8)
    expect(horizon('1')).toMatchObject({ matured: 2, observed: 1, unknown: 1, positive: 1, negative: 0 })
    expect(horizon('3')).toMatchObject({ matured: 2, observed: 0, unknown: 2, medianReturnPct: null, meanReturnPct: null, best: null })
    expect(horizon('5')).toMatchObject({ matured: 0, observed: 0 })
    expect(summary.targets.find((target) => target.targetPct === 25)).toEqual({ targetPct: 25, covered: 2, hits: 1, hitsWhileOtm: 1 })
    expect(summary.gainedWhileOtm).toEqual({ count: 1, determinable: 2 })
    expect(summary.statusCounts).toEqual({ open: 2, completed: 0, expired: 0, missing: 0 })
  })

  it('filters by date, ticker, direction, score band, DTE cohort, horizon and status without dropping losers', async () => {
    const { rows } = await view('2026-09-28T15:00:00.000Z')
    expect(filterShadowRows(rows, { direction: 'put' }).map((item) => item.contractId)).toEqual([PUT])
    expect(filterShadowRows(rows, { date: '2026-09-23' })).toEqual([])
    expect(filterShadowRows(rows, { ticker: 'EX', dte: '30', status: 'open' })).toHaveLength(2)
    expect(filterShadowRows(rows, { dte: '14' })).toEqual([])
    expect(filterShadowRows(rows, { horizon: '10' })).toHaveLength(2)
    const band = filterShadowRows(rows, { score: rows[0].score >= 80 ? '80' : rows[0].score >= 60 ? '60' : rows[0].score >= 40 ? '40' : '0' })
    expect(band.map((item) => item.contractId)).toContain(rows[0].contractId)
  })
})
