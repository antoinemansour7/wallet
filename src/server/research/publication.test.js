// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cycleBoards } from './publication.js'
import { createSecurityMaster } from './securityMaster.js'
import { sessionCheckpoints } from '../researchPerformance.js'

const generatedAt = '2026-09-09T14:00:00Z'
const earlier = '2026-09-09T12:00:00Z'
const pick = (ticker, finalScore, extra = {}) => ({ ticker, finalScore, securityId: `figi:${ticker}`, ...extra })

describe('foundation cycle boards', () => {
  it('merges scores separately and preserves the entire winning decision', () => {
    const original = pick('SAME', 80, { candidateId: 'old', report: 'original', price: 42, generatedAt: earlier, earliestActionAt: '2026-09-09T12:01:00Z' })
    const result = cycleBoards({ generatedAt: earlier, picks: [pick('FAST', 15)], picksByHorizon: { 20: [original] } },
      { 5: [pick('NEW', 20)], 20: [pick('SAME', 50, { report: 'loser' })], 60: [pick('SAME', 90)] }, { generatedAt })
    expect(result[5].map((p) => p.ticker)).toEqual(['NEW', 'FAST'])
    expect(result[20]).toEqual([original])
    expect(result[60][0].finalScore).toBe(90)
    expect(result[60][0].earliestActionAt).toBe('2026-09-09T14:01:00.000Z')
  })

  it('retains primary-only boards on empty reruns and starts fresh next cycle', () => {
    const prior = { generatedAt: earlier, picks: [], picksByHorizon: { 20: [pick('QUIET', 70)], 60: [pick('SLOW', 80)] } }
    expect(cycleBoards(prior, {}, { generatedAt })[20]).toHaveLength(1)
    expect(cycleBoards(prior, {}, { generatedAt: '2026-09-10T07:00:00Z' })).toEqual({ 5: [], 20: [], 60: [] })
  })

  it('removes adverse disclosures from carried picks across every horizon', () => {
    const prior = { generatedAt: earlier, picksByHorizon: { 5: [pick('BAD', 25)], 20: [pick('BAD', 95)], 60: [pick('GOOD', 80)] } }
    const result = cycleBoards(prior, {}, { generatedAt, vetoes: ['figi:BAD'] })
    expect(result[5]).toEqual([])
    expect(result[20]).toEqual([])
    expect(result[60][0].ticker).toBe('GOOD')
  })

  it('does not carry a reused ticker as though it were the same security', () => {
    const master = createSecurityMaster([{ asOf: earlier, securities: [{ ticker: 'REUSED', securityId: 'figi:new' }] }])
    expect(cycleBoards({ generatedAt: earlier, picks: [pick('REUSED', 99)] }, {}, { generatedAt, master })[5]).toEqual([])
  })

  it('never moves a carried decision past its original executable open', () => {
    const original = pick('EARLY', 20, { generatedAt: earlier, earliestActionAt: '2026-09-09T12:01:00Z' })
    const [carried] = cycleBoards({ generatedAt: earlier, picks: [original] }, {}, { generatedAt })[5]
    const candles = [{ date: '2026-09-09', timestamp: Date.parse('2026-09-09T13:30:00Z'), open: 100, close: 110 }]
    expect(sessionCheckpoints(candles, carried.generatedAt, Date.parse('2026-09-09T21:00:00Z'), [], undefined, carried)[0].entryDate).toBe('2026-09-09')
  })
})
