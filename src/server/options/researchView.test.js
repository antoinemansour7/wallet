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
})
