import { describe, it, expect } from 'vitest'
import { resolveSecurityKey, KEY_BASIS } from './securityKey'

describe('resolveSecurityKey', () => {
  it('prefers ISIN, the only identifier that is the same at every institution', () => {
    expect(resolveSecurityKey({ isin: 'US9229087690', cusip: '922908769', symbol: 'VTI' })).toEqual({
      key: 'isin:US9229087690',
      basis: KEY_BASIS.ISIN,
    })
  })

  it('falls to CUSIP when there is no ISIN', () => {
    expect(resolveSecurityKey({ cusip: '922908769', symbol: 'VTI' })).toEqual({
      key: 'cusip:922908769',
      basis: KEY_BASIS.CUSIP,
    })
  })

  it('falls to symbol plus exchange and currency when there is no identifier at all', () => {
    expect(resolveSecurityKey({ symbol: 'VTI', exchange: 'NYSE', currency: 'USD' })).toEqual({
      key: 'sym:VTI:NYSE:USD',
      basis: KEY_BASIS.SYMBOL,
    })
  })

  it('pools the same ETF held at two brokerages', () => {
    const questrade = resolveSecurityKey({ isin: 'CA46436C1005', symbol: 'XEQT', exchange: 'TSX', currency: 'CAD' })
    const wealthsimple = resolveSecurityKey({ isin: 'CA46436C1005', symbol: 'XEQT.TO', exchange: 'TSE', currency: 'CAD' })

    // Different symbols, different exchange spellings, same security — this is
    // the join the whole pooling rule depends on.
    expect(questrade.key).toBe(wealthsimple.key)
  })

  describe('CDRs are not their own underlying', () => {
    it('separates a TSX CDR in CAD from the Nasdaq listing in USD', () => {
      const cdr = resolveSecurityKey({ symbol: 'NVDA', exchange: 'NEO', currency: 'CAD' })
      const underlying = resolveSecurityKey({ symbol: 'NVDA', exchange: 'NASDAQ', currency: 'USD' })

      // Same ticker, different security, different cost base. Pooling these
      // would produce an ACB that is wrong in both accounts.
      expect(cdr.key).not.toBe(underlying.key)
    })

    it('separates them on currency alone when the exchange is unknown', () => {
      const cdr = resolveSecurityKey({ symbol: 'NVDA', currency: 'CAD' })
      const underlying = resolveSecurityKey({ symbol: 'NVDA', currency: 'USD' })
      expect(cdr.key).not.toBe(underlying.key)
    })
  })

  describe('normalisation', () => {
    it('ignores case and surrounding whitespace', () => {
      expect(resolveSecurityKey({ isin: ' us9229087690 ' }).key).toBe('isin:US9229087690')
      expect(resolveSecurityKey({ symbol: ' vti ', exchange: ' nyse ', currency: ' usd ' }).key).toBe('sym:VTI:NYSE:USD')
    })

    it('marks an absent exchange or currency rather than dropping the segment', () => {
      // A blank segment would make 'sym:VTI::' collide with a real listing that
      // genuinely has no exchange recorded. Naming the gap keeps them apart.
      expect(resolveSecurityKey({ symbol: 'VTI' }).key).toBe('sym:VTI:?:?')
    })
  })

  describe('malformed identifiers fall through instead of pooling wrongly', () => {
    it('rejects an ISIN that is not 12 characters', () => {
      const result = resolveSecurityKey({ isin: 'US92290', symbol: 'VTI', exchange: 'NYSE', currency: 'USD' })
      expect(result.basis).toBe(KEY_BASIS.SYMBOL)
    })

    it('rejects a CUSIP that is not 9 characters', () => {
      const result = resolveSecurityKey({ cusip: '9229', symbol: 'VTI', exchange: 'NYSE', currency: 'USD' })
      expect(result.basis).toBe(KEY_BASIS.SYMBOL)
    })

    it('rejects identifiers carrying anything but letters and digits', () => {
      const result = resolveSecurityKey({ isin: 'US9229087-90', symbol: 'VTI', exchange: 'NYSE', currency: 'USD' })
      expect(result.basis).toBe(KEY_BASIS.SYMBOL)
    })
  })

  describe('when nothing can identify the security', () => {
    it('returns null rather than inventing a key', () => {
      // A guessed key silently pools unrelated holdings. The caller has to
      // decide what to do with an unidentifiable security; this module will
      // not decide for it.
      expect(resolveSecurityKey({ exchange: 'NYSE', currency: 'USD' })).toBeNull()
      expect(resolveSecurityKey({})).toBeNull()
      expect(resolveSecurityKey(null)).toBeNull()
    })
  })
})
