import { describe, it, expect } from 'vitest'
import { roomStatus, checkContribution, depositsSince, ROOM_STATUS, MONTHLY_PENALTY_RATE } from './contributionRoom'

const NOW = Date.parse('2026-09-06T00:00:00Z')

const room = (overrides = {}) => ({
  accountId: 'tfsa-1',
  accountType: 'TFSA',
  limitMinor: 700000, // $7,000
  asOf: '2026-01-15',
  ...overrides,
})

const deposit = (overrides = {}) => ({
  accountId: 'tfsa-1',
  action: 'TRANSFER',
  tradeDate: '2026-03-01',
  quantity: 0,
  amountMinor: 200000,
  ...overrides,
})

describe('depositsSince', () => {
  it('counts broker deposits without treating withdrawals and institutional transfers as contributions', () => {
    const total = depositsSince({ accountId: 'tfsa-1', asOf: '2026-01-01', transactions: [
      deposit({ source: 'plaid', providerSubtype: 'deposit', cashDirection: 'in', amountMinor: -170000 }),
      deposit({ source: 'plaid', providerSubtype: 'deposit', cashDirection: 'in', amountMinor: -50000 }),
      deposit({ source: 'plaid', providerSubtype: 'withdrawal', cashDirection: 'out', amountMinor: 50000 }),
      deposit({ source: 'plaid', providerSubtype: 'transfer', cashDirection: 'in', amountMinor: -3980000 }),
    ] })
    expect(total).toBe(220000)
  })

  it('counts contributions on or after the date the room was accurate', () => {
    const total = depositsSince({
      transactions: [
        deposit({ tradeDate: '2026-03-01', amountMinor: 200000 }),
        deposit({ tradeDate: '2025-12-01', amountMinor: 500000 }), // before the as-of date
      ],
      accountId: 'tfsa-1',
      asOf: '2026-01-15',
    })

    expect(total).toBe(200000)
  })

  it('does not count a buy inside the account as a contribution', () => {
    // A buy moves money between holdings, not into the account. Counting it
    // would exhaust the room of anyone who trades.
    const total = depositsSince({
      transactions: [deposit({ action: 'BUY', amountMinor: 500000 })],
      accountId: 'tfsa-1',
      asOf: '2026-01-15',
    })

    expect(total).toBe(0)
  })

  it('ignores other accounts', () => {
    expect(depositsSince({
      transactions: [deposit({ accountId: 'rrsp-1' })], accountId: 'tfsa-1', asOf: '2026-01-15',
    })).toBe(0)
  })
})

describe('roomStatus', () => {
  it('counts deposits against the figure the user entered', () => {
    const status = roomStatus({ room: room(), transactions: [deposit()], now: NOW })

    expect(status.limitMinor).toBe(700000)
    expect(status.depositedMinor).toBe(200000)
    expect(status.remainingMinor).toBe(500000)
    expect(status.status).toBe(ROOM_STATUS.OK)
  })

  it('reports an over-contribution with the monthly cost of staying over', () => {
    const status = roomStatus({
      room: room(), transactions: [deposit({ amountMinor: 800000 })], now: NOW,
    })

    expect(status.status).toBe(ROOM_STATUS.OVER)
    expect(status.overByMinor).toBe(100000)
    expect(status.monthlyPenaltyMinor).toBe(1000) // 1% of $1,000.00
    expect(MONTHLY_PENALTY_RATE).toBe(0.01)
  })

  it('goes stale after a new tax year rather than carrying forward', () => {
    // Room is granted annually. Last year's figure is not a smaller number
    // this year, it is an unknown one — the new grant is not derivable here.
    const status = roomStatus({ room: room({ asOf: '2025-06-01' }), transactions: [], now: NOW })

    expect(status.stale).toBe(true)
    expect(status.status).toBe(ROOM_STATUS.STALE)
  })

  it('says nothing when no room has been entered', () => {
    // An absent figure is not zero room.
    expect(roomStatus({ room: null, now: NOW })).toBeNull()
    expect(roomStatus({ room: room({ limitMinor: undefined, limit: undefined }), now: NOW })).toBeNull()
  })

  it('carries the excluded TFSA re-contribution rule with the figure', () => {
    expect(roomStatus({ room: room(), now: NOW }).excludesTfsaRecontribution).toBe(true)
  })
})

describe('checkContribution', () => {
  it('warns before a contribution that would go over, not after', () => {
    const check = checkContribution({
      room: room(), transactions: [deposit()], amountMinor: 600000, now: NOW,
    })

    expect(check.exceeds).toBe(true)
    expect(check.remainingBeforeMinor).toBe(500000)
    expect(check.excessMinor).toBe(100000)
    expect(check.monthlyPenaltyMinor).toBe(1000)
  })

  it('stays quiet when the contribution fits', () => {
    const check = checkContribution({
      room: room(), transactions: [deposit()], amountMinor: 400000, now: NOW,
    })

    expect(check.exceeds).toBe(false)
    expect(check.status).toBe(ROOM_STATUS.OK)
    expect(check.remainingAfterMinor).toBe(100000)
  })

  it('refuses to warn from a stale figure', () => {
    // Telling someone they have room when the real answer is unknown is worse
    // than telling them nothing, because they would act on it.
    const check = checkContribution({
      room: room({ asOf: '2025-06-01' }), transactions: [], amountMinor: 900000, now: NOW,
    })

    expect(check.status).toBe(ROOM_STATUS.UNKNOWN)
    expect(check.exceeds).toBe(false)
  })

  it('says nothing without a room figure or a real amount', () => {
    expect(checkContribution({ room: null, amountMinor: 100, now: NOW })).toBeNull()
    expect(checkContribution({ room: room(), amountMinor: 0, now: NOW })).toBeNull()
    expect(checkContribution({ room: room(), amountMinor: -500, now: NOW })).toBeNull()
  })
})
