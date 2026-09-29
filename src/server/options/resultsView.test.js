// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { SHADOW_CALL as CALL, SHADOW_PUT as PUT, optionsShadowFixture } from '../../test/optionsShadowFixture.js'
import { buildOptionsShadowView } from './shadowView.js'
import { optionsResultsView } from './resultsView.js'

let archive
beforeEach(async () => { ({ archive } = await optionsShadowFixture()) })

const results = async (at) => optionsResultsView(await buildOptionsShadowView({ archive, now: () => Date.parse(at) }))
const pick = (view, contractId) => view.days.flatMap((day) => day.picks).find((item) => item.contractId === contractId)

describe('options results from the shadow evaluation', () => {
  it('prices a pick per contract: what it cost with fees, and what it would sell for now', async () => {
    const view = await results('2026-09-23T21:00:00.000Z')
    const call = pick(view, CALL)
    // 5.55 ask × 100, plus $0.01/share slippage and the $0.70 entry fee.
    expect(call.paidUsd).toBe(556.7)
    // Latest observation: the +1 close, bid 7.00, sold less slippage and the exit fee.
    expect(call.now).toMatchObject({ at: '2026-09-23T19:59:45.000Z', valueUsd: 698.3 })
    expect(call.now.returnPct).toBeCloseTo(25.44, 2)
    expect(call.days[1]).toMatchObject({ state: 'observed', date: '2026-09-23', valueUsd: 698.3 })
    expect(call.days[3]).toEqual({ state: 'pending', date: '2026-09-25' })
    expect(call.result).toBeNull()
  })

  it('counts a day as up or down from what each pick would sell for now', async () => {
    const [day] = (await results('2026-09-23T21:00:00.000Z')).days.filter((item) => item.picks.length)
    expect(day).toMatchObject({ tradingDate: '2026-09-22', day3Date: '2026-09-25' })
    expect(day.counts).toMatchObject({ picks: 2, up: 1, down: 1, won: 0, lost: 0 })
    // The put's +1 close was omitted by the provider: say so, never a zero.
    expect(pick({ days: [day] }, PUT).days[1]).toMatchObject({ state: 'not_recorded', reason: 'provider_snapshot_absent' })
  })

  it('says a checkpoint that passed without a price was not recorded, and does not call the pick', async () => {
    const call = pick(await results('2026-09-28T15:00:00.000Z'), CALL)
    expect(call.days[3]).toMatchObject({ state: 'not_recorded', date: '2026-09-25' })
    expect(call.result).toBeNull()
  })

  it('lists every session newest first, including mornings without picks', async () => {
    const view = await results('2026-09-28T15:00:00.000Z')
    expect(view.days.map((day) => [day.tradingDate, day.status, day.picks.length])).toEqual([
      ['2026-09-28', 'pending', 0], ['2026-09-25', 'missing', 0], ['2026-09-24', 'degraded', 0],
      ['2026-09-23', 'empty', 0], ['2026-09-22', 'candidates', 2],
    ])
  })
})

describe('day-3 result', () => {
  const checkpoint = (key, returnPct, status = 'observed', scheduledAt = '2026-09-25T20:00:00.000Z') => ({ key, label: key, scheduledAt, status, returnPct })
  const row = (id, overrides = {}) => ({
    id, contractId: id, tradingDate: '2026-09-22', rank: 1, ticker: 'EX', direction: 'call', strikePrice: 200, expirationDate: '2026-10-22',
    status: 'open', frozen: { ask: 1 }, current: null,
    checkpoints: [checkpoint('1', 5, 'observed', '2026-09-23T20:00:00.000Z'), checkpoint('3', 5), checkpoint('5', null, 'unexpired_horizon', '2026-09-29T20:00:00.000Z')],
    ...overrides,
  })
  const shadow = (rows) => ({ checkedAt: '2026-09-26T15:00:00.000Z', days: [{ tradingDate: '2026-09-22', status: 'candidates', candidates: rows.length }], rows })
  const only = (rows) => optionsResultsView(shadow(rows)).days[0]

  it('is a win when the pick sells for more than it cost at the day-3 close, after costs', () => {
    const day = only([row('up'), row('down', { checkpoints: [checkpoint('3', -0.1)] }), row('flat', { checkpoints: [checkpoint('3', 0)] })])
    expect(day.picks.map((item) => [item.id, item.result])).toEqual([['up', 'won'], ['down', 'lost'], ['flat', 'lost']])
    expect(day.counts).toMatchObject({ won: 1, lost: 2 })
  })

  it('keeps a pick without an outcome plan on the page as not tracked', () => {
    const day = only([row('untracked', { status: 'missing', reason: 'outcome_plan_unavailable', checkpoints: [] })])
    expect(day.picks[0]).toMatchObject({ tracked: false, untrackedReason: 'outcome_plan_unavailable', result: null, now: null })
    expect(day.counts).toMatchObject({ picks: 1, notTracked: 1 })
  })

  it('shows a checkpoint the contract expired before as expired', () => {
    const day = only([row('short', { checkpoints: [checkpoint('3', null, 'contract_expired_before_endpoint', null)] })])
    expect(day.picks[0].days[3]).toEqual({ state: 'expired' })
  })
})
