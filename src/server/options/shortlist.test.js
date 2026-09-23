import { describe, expect, it } from 'vitest'
import { OPTIONS_SHORTLIST_POLICY_VERSION, buildOptionsShortlist, scoreOptionsDirection } from './shortlist.js'

function watchlist(tickers) {
  return { securities: tickers.map((ticker) => ({ securityId: `wallai:security:${ticker.toLowerCase()}`, issuerId: `wallai:issuer:${ticker.toLowerCase()}`, ticker })) }
}

function record({ ticker, premarketPrice = 100, relativeStrength = 5, sma20Distance = 2, return5d = 3, regimeScore = 7, nonEventState = 'unknown' }) {
  return {
    schemaVersion: 'options-security-features-v1',
    featureVersion: 'options-point-in-time-features-v1',
    recordId: `feature-record:${ticker}`,
    security: { securityId: `wallai:security:${ticker.toLowerCase()}`, issuerId: `wallai:issuer:${ticker.toLowerCase()}`, ticker },
    underlying: { premarketPrice },
    technicals: { distanceFromSma20Pct: sma20Distance },
    regime: regimeScore == null ? null : { score: regimeScore, label: 'mixed' },
    directional: {
      call: { relativeStrength20dPct: relativeStrength, return5dPct: return5d },
      put: { relativeStrength20dPct: -relativeStrength, return5dPct: -return5d },
    },
    nonEventHorizon: { state: nonEventState, reasons: nonEventState === 'excluded' ? [{ type: 'earnings', eventId: 'e1', date: '2026-09-23' }] : [] },
  }
}

function snapshot(records) {
  const base = { schemaVersion: 'options-feature-snapshot-v1', tradingDate: '2026-09-22', freezeAt: '2026-09-22T13:20:00.000Z', securities: records }
  return { ...base, snapshotId: 'snapshot-hash' }
}

describe('buildOptionsShortlist', () => {
  it('does not break neutral directional ties in favor of calls', () => {
    const entry = record({ ticker: 'AAA', relativeStrength: 0, sma20Distance: 0, return5d: 0, regimeScore: 5 })
    expect(buildOptionsShortlist({ snapshot: snapshot([entry]), watchlist: watchlist(['AAA']) }).rejected[0].reason).toBe('directional_setup_tie')
  })
  it('uses the actual session exit instead of the legacy five-day exclusion flag', () => {
    const entry = record({ ticker: 'AAA', nonEventState: 'excluded' })
    entry.coverage = { earnings: { status: 'complete' }, catalysts: { status: 'complete' } }
    entry.events = { earnings: [{ eventDate: '2026-09-27' }], catalysts: [] }
    expect(buildOptionsShortlist({ snapshot: snapshot([entry]), watchlist: watchlist(['AAA']) }).candidates)
      .toEqual([expect.objectContaining({ catalystCoverage: 'eligible' })])
    entry.events.earnings = [{ eventDate: '2026-09-25', timing: 'unknown' }]
    expect(buildOptionsShortlist({ snapshot: snapshot([entry]), watchlist: watchlist(['AAA']) }).candidates).toHaveLength(0)
    entry.events.earnings[0].timing = 'after_close'
    expect(buildOptionsShortlist({ snapshot: snapshot([entry]), watchlist: watchlist(['AAA']) }).candidates).toHaveLength(1)
  })

  it('includes the holiday weekend in the exclusion window and rejects no-evidence call ties', () => {
    const entry = record({ ticker: 'AAA' })
    entry.events = { earnings: [{ eventDate: '2026-11-30', timing: 'before_open' }], catalysts: [] }
    const snap = { ...snapshot([entry]), tradingDate: '2026-11-24' }
    expect(buildOptionsShortlist({ snapshot: snap, watchlist: watchlist(['AAA']) }).candidates).toHaveLength(0)
    const neutral = record({ ticker: 'AAA', relativeStrength: null, sma20Distance: null, return5d: null, regimeScore: null })
    expect(buildOptionsShortlist({ snapshot: snapshot([neutral]), watchlist: watchlist(['AAA']) }).rejected[0].reason).toBe('no_directional_setup')
  })
  it('accounts for every watchlist security exactly once', () => {
    const list = watchlist(['AAA', 'BBB', 'CCC'])
    const snap = snapshot([record({ ticker: 'AAA' }), record({ ticker: 'BBB', premarketPrice: null })])
    const result = buildOptionsShortlist({ snapshot: snap, watchlist: list })
    const accounted = [...result.candidates.map((c) => c.ticker), ...result.rejected.map((r) => r.ticker)]
    expect(new Set(accounted)).toEqual(new Set(['AAA', 'BBB', 'CCC']))
    expect(result.rejected.find((r) => r.ticker === 'BBB')).toMatchObject({ status: 'unavailable', reason: 'no_premarket_price' })
    expect(result.rejected.find((r) => r.ticker === 'CCC')).toMatchObject({ status: 'missing', reason: 'not_in_feature_snapshot' })
    expect(result.candidates.find((c) => c.ticker === 'AAA')).toBeTruthy()
    expect(result.policyVersion).toBe(OPTIONS_SHORTLIST_POLICY_VERSION)
  })

  it('excludes a security with a known event in the holding window instead of scoring it', () => {
    const list = watchlist(['AAA'])
    const snap = snapshot([record({ ticker: 'AAA', nonEventState: 'excluded' })])
    const result = buildOptionsShortlist({ snapshot: snap, watchlist: list })
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0]).toMatchObject({ status: 'rejected', reason: 'known_event_in_holding_window' })
  })

  it('caps the shortlist and breaks ties by ticker ascending', () => {
    const tickers = ['ZZZ', 'AAA', 'MMM']
    const list = watchlist(tickers)
    const snap = snapshot(tickers.map((ticker) => record({ ticker, relativeStrength: 5, sma20Distance: 2, return5d: 3 })))
    const result = buildOptionsShortlist({ snapshot: snap, watchlist: list, maxCandidates: 2 })
    expect(result.candidates.map((c) => c.ticker)).toEqual(['AAA', 'MMM'])
    expect(result.rejected.find((r) => r.ticker === 'ZZZ')).toMatchObject({ status: 'rejected', reason: 'not_top_n' })
  })

  it('is deterministic given identical inputs', () => {
    const list = watchlist(['AAA', 'BBB'])
    const snap = snapshot([record({ ticker: 'AAA' }), record({ ticker: 'BBB', relativeStrength: 8 })])
    const first = buildOptionsShortlist({ snapshot: snap, watchlist: list })
    const second = buildOptionsShortlist({ snapshot: snap, watchlist: list })
    expect(first.shortlistId).toBe(second.shortlistId)
  })

  it('reports a max score of only what is structurally reachable, since catalyst quality can never score above zero today', () => {
    const score = scoreOptionsDirection(record({ ticker: 'AAA' }), 'call')
    expect(score.max).toBe(25) // underlyingSetup(15) + technicalConfirmation(10) + catalystQuality(0, not 10)
    const catalystComponent = score.components.find((c) => c.component === 'catalystQuality')
    expect(catalystComponent.max).toBe(0)
  })

  it('scores catalyst quality as zero for both unknown and eligible coverage, never negative or positive', () => {
    const list = watchlist(['AAA', 'BBB'])
    const snap = snapshot([record({ ticker: 'AAA', nonEventState: 'unknown' }), record({ ticker: 'BBB', nonEventState: 'eligible' })])
    const result = buildOptionsShortlist({ snapshot: snap, watchlist: list })
    for (const entry of result.scores) for (const score of entry.scores) {
      expect(score.components.find((c) => c.component === 'catalystQuality').points).toBe(0)
    }
  })
})
