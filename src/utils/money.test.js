import { describe, it, expect } from 'vitest'
import { toMinorUnits, fromMinorUnits, formatMinor } from './money'

describe('toMinorUnits', () => {
  it('converts a decimal amount to an integer count of cents', () => {
    expect(toMinorUnits(143.29)).toBe(14329)
    expect(toMinorUnits(0.01)).toBe(1)
    expect(toMinorUnits(1000)).toBe(100000)
  })

  it('survives the binary-fraction amounts that break naive multiplication', () => {
    // 1.005 * 100 is 100.49999999999999 in IEEE 754, and 8.115 * 100 is
    // 811.4999999999999. Rounding those the obvious way loses a cent, and a
    // lost cent inside an ACB carried across years compounds into a figure
    // that disagrees with the brokerage statement.
    expect(toMinorUnits(1.005)).toBe(101)
    expect(toMinorUnits(8.115)).toBe(812)
    expect(toMinorUnits(0.615)).toBe(62)
    expect(toMinorUnits(1.115)).toBe(112)
  })

  it('handles negatives symmetrically', () => {
    expect(toMinorUnits(-143.29)).toBe(-14329)
    expect(toMinorUnits(-1.005)).toBe(-101)
  })

  it('accepts a numeric string, because imports arrive as text', () => {
    expect(toMinorUnits('143.29')).toBe(14329)
    expect(toMinorUnits('  1,143.29  ')).toBe(114329)
    expect(toMinorUnits('$143.29')).toBe(14329)
    expect(toMinorUnits('(143.29)')).toBe(-14329)
  })

  it('returns null for what is not an amount, rather than zero', () => {
    // Zero is a real amount. An unparseable field is not, and collapsing the
    // two would silently book a free trade.
    expect(toMinorUnits('')).toBeNull()
    expect(toMinorUnits(null)).toBeNull()
    expect(toMinorUnits(undefined)).toBeNull()
    expect(toMinorUnits('n/a')).toBeNull()
    expect(toMinorUnits(NaN)).toBeNull()
    expect(toMinorUnits(Infinity)).toBeNull()
    expect(toMinorUnits(0)).toBe(0)
  })

  it('supports currencies that are not two-decimal', () => {
    expect(toMinorUnits(143.29, 0)).toBe(143)
    expect(toMinorUnits(1.2345, 4)).toBe(12345)
  })
})

describe('fromMinorUnits', () => {
  it('round-trips', () => {
    expect(fromMinorUnits(14329)).toBe(143.29)
    expect(fromMinorUnits(-101)).toBe(-1.01)
    expect(fromMinorUnits(0)).toBe(0)
  })

  it('passes null through instead of inventing zero', () => {
    expect(fromMinorUnits(null)).toBeNull()
  })
})

describe('formatMinor', () => {
  it('renders an amount with its currency', () => {
    expect(formatMinor(14329, 'CAD')).toBe('$143.29')
    expect(formatMinor(-14329, 'CAD')).toBe('-$143.29')
  })

  it('marks an unknown amount rather than printing $0.00', () => {
    expect(formatMinor(null, 'CAD')).toBe('—')
  })
})
