// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { optionsResearchFixture } from '../../test/optionsResearchFixture.js'
import { buildOptionsResearchView, selectedResearchScenario } from './researchView.js'

let fixture
beforeAll(() => { fixture = optionsResearchFixture() })
const now = () => Date.parse('2026-09-22T13:32:21.000Z')
const view = (extra = {}) => buildOptionsResearchView({ ...fixture, archive: {}, now, ...extra })

describe('frozen options research projection', () => {
  it('uses the final revalidated quote and exact archived selected scenario for calls and puts', async () => {
    const result = await view()
    expect(result.candidates).toHaveLength(2)
    for (const candidate of result.candidates) {
      const set = fixture.records.find((record) => record.recordType === 'scenario').payload.scenarios.find((row) => row.contractId === candidate.contractId).scenarioSet
      expect(candidate.selectedScenario).toEqual(selectedResearchScenario(set, candidate.direction))
      expect(candidate.observed).toMatchObject({ bid: 5.45, ask: 5.55, mid: 5.5, marketAt: '2026-09-22T13:32:15.000Z' })
      expect(candidate.selectedScenario.isOutOfTheMoney).toBe(true)
      expect(candidate.selectedScenario.askEntryModeledBidReturnPct).toBeGreaterThan(0)
      expect(candidate.worstReturnPct).toBe(Math.min(...set.scenarios.map((row) => row.askEntryModeledBidReturnPct)))
      expect(candidate.worstReturnPct).toBeLessThan(0)
      expect(candidate.premiumAtRisk).toBe(set.entry.premiumAtRiskPerContract)
    }
    expect(JSON.stringify(result.candidates)).not.toMatch(/rawId|diagnostics|greeks|inputHashes/)
  })
  it('preserves stale and previous-session evidence without presenting it as a new scan', async () => {
    const before = JSON.stringify(fixture.manifest)
    expect((await view({ now: () => Date.parse('2026-09-22T14:00:00Z') })).summary.state).toBe('stale')
    const nextDay = await view({ now: () => Date.parse('2026-09-23T14:00:00Z') })
    expect(nextDay.summary.state).toBe('unavailable')
    expect(nextDay.morning.tradingDate).toBe('2026-09-22')
    expect(nextDay.candidates).toHaveLength(2)
    expect(JSON.stringify(fixture.manifest)).toBe(before)
  })
  it('uses the final chain in separate progressive detail, with full trace and lineage', async () => {
    const detail = await view({ contractId: fixture.contracts[0].contractId })
    expect(detail.contract.quote.bid).toBe(5.45)
    expect(detail.contract.openInterest).toBe(1200)
    expect(detail.scenarioSet.scenarios.length).toBeGreaterThan(21)
    expect(detail.score.components).toHaveLength(9)
    expect(detail.lineage.records.map((record) => record.recordId)).toContain(fixture.finalChain.recordId)
    expect(detail.comparison).toHaveLength(2)
  })
  it('rejects an unselected contract and does not fall back to an earlier quote if final evidence is missing', async () => {
    expect(await view({ contractId: 'unselected' })).toBeNull()
    const result = await view({ readRecord: async (archive, type, id) => id === fixture.finalChain.recordId ? null : fixture.readRecord(archive, type, id) })
    expect(result.evidenceStatus).toBe('partial')
    expect(result.candidates[0].observed.bid).toBeNull()
  })
  it('does not substitute a different scenario if the fixed selection is absent', () => {
    expect(selectedResearchScenario({ scenarios: [{ horizonId: '3_sessions', movePct: 8, ivMultiplier: 1, midReturnPct: 100 }] }, 'call')).toBeNull()
  })
  it('names why the main risk applies, so an unknown input is not shown as an observed one', async () => {
    const penalties = [{ code: 'wide_spread', points: 1, reason: 'spread_in_upper_gate_band' },
      { code: 'iv_above_90th_percentile', points: 5, reason: 'missing_input_uses_existing_worst_case_penalty' }]
    const readRecord = async (archive, type, id) => {
      const record = await fixture.readRecord(archive, type, id)
      return type === 'score' ? { ...record, payload: { ...record.payload, scores: record.payload.scores.map((score) => ({ ...score, penalties })) } } : record
    }
    const [candidate] = (await view({ readRecord })).candidates
    expect(candidate).toMatchObject({ risk: 'iv_above_90th_percentile', riskReason: 'missing_input_uses_existing_worst_case_penalty' })
    expect((await view()).candidates[0]).toMatchObject({ risk: 'full_premium_at_risk', riskReason: null })
  })
})

describe("today's opening scan status", () => {
  const at = (time) => () => Date.parse(`2026-09-23T${time}Z`)
  const attempt = (status, endedAt) => ({ payload: { stage: 'opening', tradingDate: '2026-09-23', status, endedAt: `2026-09-23T${endedAt}Z` } })
  const archive = (records) => ({ calls: 0, async list(index, asOf, options) { this.calls += 1; this.args = { index, asOf, options }; return records } })

  it('says a published morning is published without reading attempts', async () => {
    const store = archive([])
    const result = await view({ archive: store })
    expect(result.opening).toMatchObject({ tradingDate: '2026-09-22', status: 'published', deadlineAt: '2026-09-22T13:35:00.000Z' })
    expect(store.calls).toBe(0)
  })
  it('reports a scan that is not due, due, failed, late or missed from archived attempts', async () => {
    const early = archive([])
    expect((await view({ archive: early, now: at('12:00:00') })).opening.status).toBe('scheduled')
    expect(early.calls).toBe(0)
    expect((await view({ archive: archive([]), now: at('13:32:00') })).opening.status).toBe('due')
    const failed = archive([attempt('incomplete', '13:33:10')])
    const result = await view({ archive: failed, now: at('13:40:00') })
    expect(result.opening).toMatchObject({ status: 'failed', at: '2026-09-23T13:33:10Z' })
    expect(failed.args).toEqual({ index: 'options-records:scan', asOf: Date.parse('2026-09-23T13:40:00Z'), options: { since: '2026-09-23T13:31:00.000Z', count: Infinity } })
    expect((await view({ archive: archive([attempt('late', '13:36:00')]), now: at('13:40:00') })).opening.status).toBe('late')
    expect((await view({ archive: archive([attempt('missed', '13:36:00')]), now: at('13:40:00') })).opening.status).toBe('missed')
    expect((await view({ archive: archive([]), now: at('13:40:00') })).opening.status).toBe('missed')
  })
  it('lets a later successful attempt win, and ignores other stages and days', async () => {
    const records = [attempt('incomplete', '13:32:00'), attempt('complete', '13:34:00'),
      { payload: { stage: 'premarket', tradingDate: '2026-09-23', status: 'incomplete', endedAt: '2026-09-23T13:40:00Z' } }]
    expect((await view({ archive: archive(records), now: at('13:40:00') })).opening.status).toBe('published')
    const other = [{ payload: { stage: 'opening', tradingDate: '2026-09-22', status: 'incomplete', endedAt: '2026-09-23T13:33:00Z' } }]
    expect((await view({ archive: archive(other), now: at('13:40:00') })).opening.status).toBe('missed')
  })
  it('degrades to unknown when attempts cannot be read, and is absent on closed days and detail reads', async () => {
    const broken = { list: async () => { throw new Error('quota') } }
    expect((await view({ archive: broken, now: at('13:40:00') })).opening.status).toBe('unknown')
    expect((await view({ archive: {}, now: at('13:40:00') })).opening.status).toBe('unknown')
    expect((await view({ now: () => Date.parse('2026-09-26T14:00:00Z') })).opening).toBeNull()
    expect((await view({ contractId: fixture.contracts[0].contractId })).opening).toBeUndefined()
  })
})
