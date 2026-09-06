import { describe, expect, it } from 'vitest'
import {
  candidatesToSignals,
  withSectorFilter,
  FOCUS_SECTOR_FILTERS,
  parseFinvizTickers,
} from './technicalScreener'

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

  // The board classifies screener signals from these themes rather than from
  // the synthetic text, so a ticker that cleared both screens has to say so —
  // collapsing to 'squeeze' would silently discard the breakout evidence.
  it('declares both themes for combined squeeze+breakout setups', () => {
    const signals = candidatesToSignals([
      { ticker: 'MU', setupType: 'squeeze+breakout', source: 'finviz-screener' },
    ])

    expect(signals[0].themes).toEqual(['squeeze', 'breakout'])
    expect(signals[0].text).toContain('squeeze+breakout')
  })

  it('declares a single theme when only one screen matched', () => {
    expect(candidatesToSignals([{ ticker: 'MU', setupType: 'squeeze' }])[0].themes).toEqual(['squeeze'])
    expect(candidatesToSignals([{ ticker: 'MU', setupType: 'breakout' }])[0].themes).toEqual(['breakout'])
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

  // Sector-scoped discovery must never tag a candidate with its sector — the
  // setup type stays squeeze/breakout, so nothing sector-shaped reaches scoring.
  it('never emits a sector theme, only the setup themes', () => {
    const themes = candidatesToSignals([
      { ticker: 'NVDA', setupType: 'squeeze+breakout', source: 'finviz-screener' },
    ])[0].themes
    expect(themes).toEqual(['squeeze', 'breakout'])
  })
})

// Sector depth by default (issue #96).
describe('sector-scoped screens', () => {
  const SQUEEZE_URL = 'https://finviz.com/screener.ashx?v=111&f=cap_smallover,sh_avgvol_o300&ft=4&o=-relativevolume'

  it('inserts the sector code at the front of the filter list', () => {
    const url = withSectorFilter(SQUEEZE_URL, 'ind_semiconductors')
    expect(url).toContain('&f=ind_semiconductors,cap_smallover,sh_avgvol_o300')
    // the rest of the query string is untouched
    expect(url).toContain('&ft=4&o=-relativevolume')
  })

  it('keeps every focus filter a valid Finviz sector/industry code', () => {
    expect(FOCUS_SECTOR_FILTERS.length).toBeGreaterThan(0)
    for (const code of FOCUS_SECTOR_FILTERS) {
      expect(code).toMatch(/^(sec|ind)_[a-z]+$/)
    }
    // the drifted code from the original spec must not be used
    expect(FOCUS_SECTOR_FILTERS).not.toContain('ind_semiconductorsbroadline')
    expect(FOCUS_SECTOR_FILTERS).toContain('ind_semiconductors')
  })

  it('parses tickers from a sector screen the same way, and degrades to none on a failed/empty page', () => {
    const html = '<a href="quote.ashx?t=NVDA">x</a><a href="stock?t=AVGO&ty=c">y</a>'
    expect(parseFinvizTickers(html)).toContain('AVGO')
    // a failed channel (empty or error HTML) yields no candidates, never a throw
    expect(parseFinvizTickers('')).toEqual([])
    expect(parseFinvizTickers('<html>rate limited</html>')).toEqual([])
  })
})
