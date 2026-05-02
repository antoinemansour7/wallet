/**
 * Portfolio logic tests — cover the pure utility functions directly.
 * File-upload interaction is intentionally not tested here (jsdom limitation);
 * parseSpreadsheet itself is covered in utils/parseSpreadsheet.test.js.
 */
import { describe, it, expect } from 'vitest'
import {
  parseNum,
  fmtCurrency,
  fmtPct,
  pnlColor,
  computeStats,
  groupByAccount,
} from '../utils/portfolioStats'

const ROW_GAIN = {
  'ACCOUNT NUMBER': 'ACC001',
  'SYMBOL': 'AAPL',
  'MARKET VALUE': '1500.00',
  'BOOK VALUE': '1200.00',
  'DAY CHANGE': '30.00',
  'DAY CHANGE %': '2.04%',
  'UNREALIZED GAIN/LOSS': '300.00',
  'UNREALIZED GAIN/LOSS %': '25.00%',
}

const ROW_LOSS = {
  'ACCOUNT NUMBER': 'ACC001',
  'SYMBOL': 'BMNR',
  'MARKET VALUE': '1848.49',
  'BOOK VALUE': '2435.59',
  'DAY CHANGE': '4.91',
  'DAY CHANGE %': '0.27%',
  'UNREALIZED GAIN/LOSS': '-587.10',
  'UNREALIZED GAIN/LOSS %': '-24.10%',
}

const ROW_OTHER_ACCT = {
  'ACCOUNT NUMBER': 'ACC002',
  'SYMBOL': 'NVDA',
  'MARKET VALUE': '3408.00',
  'BOOK VALUE': '3138.00',
  'DAY CHANGE': '-3.00',
  'DAY CHANGE %': '-0.09%',
  'UNREALIZED GAIN/LOSS': '270.00',
  'UNREALIZED GAIN/LOSS %': '8.60%',
}

describe('parseNum', () => {
  it('parses plain numbers', ()      => expect(parseNum('150.00')).toBe(150))
  it('strips $ signs',    ()         => expect(parseNum('$1,429.33')).toBe(1429.33))
  it('strips % signs',    ()         => expect(parseNum('25.41%')).toBe(25.41))
  it('handles negatives', ()         => expect(parseNum('-587.10')).toBe(-587.1))
  it('returns 0 for empty string', () => expect(parseNum('')).toBe(0))
  it('returns 0 for null',          () => expect(parseNum(null)).toBe(0))
})

describe('fmtCurrency', () => {
  it('formats positive values as CAD', () => {
    expect(fmtCurrency(1429.33)).toMatch(/\$1,429\.33/)
  })
  it('formats negative values', () => {
    expect(fmtCurrency(-587.10)).toMatch(/-\$587\.10|\$-587\.10/)
  })
})

describe('fmtPct', () => {
  it('prefixes positive with +', () => expect(fmtPct(25.41)).toBe('+25.41%'))
  it('keeps negative sign',       () => expect(fmtPct(-24.10)).toBe('-24.10%'))
  it('handles zero',              () => expect(fmtPct(0)).toBe('+0.00%'))
})

describe('pnlColor', () => {
  it('returns gain for positive', () => expect(pnlColor(300)).toBe('text-gain'))
  it('returns loss for negative',  () => expect(pnlColor(-587)).toBe('text-loss'))
  it('returns muted for zero',     () => expect(pnlColor(0)).toBe('text-white/40'))
})

describe('computeStats', () => {
  const rows = [ROW_GAIN, ROW_LOSS]

  it('sums market value', () => {
    const { totalMarketValue } = computeStats(rows)
    expect(totalMarketValue).toBeCloseTo(1500 + 1848.49, 1)
  })

  it('sums unrealized P&L', () => {
    const { totalUnrealized } = computeStats(rows)
    expect(totalUnrealized).toBeCloseTo(300 + (-587.10), 1)
  })

  it('computes unrealized P&L %', () => {
    const { unrealizedPct } = computeStats(rows)
    const expected = (300 - 587.10) / (1200 + 2435.59) * 100
    expect(unrealizedPct).toBeCloseTo(expected, 2)
  })

  it('sums day change', () => {
    const { totalDayChange } = computeStats(rows)
    expect(totalDayChange).toBeCloseTo(30 + 4.91, 2)
  })

  it('handles single row', () => {
    const { totalMarketValue, totalUnrealized } = computeStats([ROW_GAIN])
    expect(totalMarketValue).toBeCloseTo(1500, 1)
    expect(totalUnrealized).toBeCloseTo(300, 1)
  })

  it('includes cash and realized pnl when provided', () => {
    const stats = computeStats(rows, { cashValue: 500, realizedPnl: 125 })

    expect(stats.totalCashValue).toBe(500)
    expect(stats.totalRealized).toBe(125)
    expect(stats.totalMarketValue).toBeCloseTo(1500 + 1848.49 + 500, 2)
    expect(stats.totalPnl).toBeCloseTo(300 - 587.1 + 125, 2)
  })
})

describe('groupByAccount', () => {
  it('groups rows by account number', () => {
    const groups = groupByAccount([ROW_GAIN, ROW_LOSS, ROW_OTHER_ACCT])
    expect(groups).toHaveLength(2)
    const acc1 = groups.find(([k]) => k === 'ACC001')
    const acc2 = groups.find(([k]) => k === 'ACC002')
    expect(acc1[1]).toHaveLength(2)
    expect(acc2[1]).toHaveLength(1)
  })

  it('uses "Unknown" for missing account number', () => {
    const groups = groupByAccount([{ SYMBOL: 'X' }])
    expect(groups[0][0]).toBe('Unknown')
  })

  it('handles all rows in one account', () => {
    const groups = groupByAccount([ROW_GAIN, ROW_LOSS])
    expect(groups).toHaveLength(1)
    expect(groups[0][1]).toHaveLength(2)
  })
})
