import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { candidatesToSignals } from './technicalScreener'

// We can't easily unit-test fetchBreakoutCandidates without mocking Redis + Finviz HTML.
// Focus on the pure transformation function that's always called.

describe('candidatesToSignals', () => {
  it('converts candidates into scored signal objects', () => {
    const candidates = [
      { ticker: 'AMRC', setupType: 'squeeze', source: 'finviz-screener' },
      { ticker: 'RKLB', setupType: 'breakout', source: 'finviz-screener' },
    ]

    const signals = candidatesToSignals(candidates)

    expect(signals).toHaveLength(2)
    expect(signals[0]).toMatchObject({
      text: expect.stringContaining('AMRC'),
      tickers: ['AMRC'],
      themes: ['squeeze'],
      score: 6.5,
      sourceType: 'screener',
      sourceRole: 'conviction',
      sourceLabels: ['finviz'],
      username: 'finviz-screener',
    })
    expect(signals[1].themes).toEqual(['breakout'])
  })

  it('sets squeeze theme for combined squeeze+breakout setups', () => {
    const signals = candidatesToSignals([
      { ticker: 'MU', setupType: 'squeeze+breakout', source: 'finviz-screener' },
    ])

    expect(signals[0].themes).toEqual(['squeeze'])
    expect(signals[0].text).toContain('squeeze+breakout')
  })

  it('returns empty array for empty input', () => {
    expect(candidatesToSignals([])).toEqual([])
  })

  it('generates unique IDs for each signal', () => {
    const signals = candidatesToSignals([
      { ticker: 'A', setupType: 'squeeze', source: 'finviz-screener' },
      { ticker: 'B', setupType: 'breakout', source: 'finviz-screener' },
    ])

    expect(signals[0].id).not.toBe(signals[1].id)
    expect(signals[0].id).toMatch(/^screener-A-/)
    expect(signals[1].id).toMatch(/^screener-B-/)
  })
})
