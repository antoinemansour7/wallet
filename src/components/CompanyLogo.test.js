import { describe, expect, it } from 'vitest'
import { logoCandidates, logoUrl, underlyingFromName } from './CompanyLogo'

describe('logoCandidates', () => {
  // The bug this exists for: stripping .TO produced a bare ticker that belongs
  // to a different company, so the wrong logo rendered rather than none.
  it('tries the TSX symbol before the bare one', () => {
    expect(logoCandidates('AC.TO')).toEqual(['AC.TO', 'AC'])
    expect(logoCandidates('T.TO')).toEqual(['T.TO', 'T'])
    expect(logoCandidates('HSU.TO')).toEqual(['HSU.TO', 'HSU'])
  })

  it('treats TSX Venture the same way', () => {
    expect(logoCandidates('XYZ.V')).toEqual(['XYZ.V', 'XYZ'])
  })

  // CDRs are the opposite case: .NE almost always 404s and the right logo is
  // the US underlying's, so the suffix is dropped rather than tried.
  it('maps a CDR to its US underlying and never tries .NE', () => {
    expect(logoCandidates('ORAC.NE')).toEqual(['ORCL', 'ORAC'])
    expect(logoCandidates('NOWS.NE')).toEqual(['NOW', 'NOWS'])
  })

  it('still strips .NE for a CDR with no mapping', () => {
    expect(logoCandidates('AVGO.NE')).toEqual(['AVGO'])
  })

  it('leaves a plain US ticker alone', () => {
    expect(logoCandidates('NVDA')).toEqual(['NVDA'])
  })

  it('normalises case and whitespace', () => {
    expect(logoCandidates('  ac.to  ')).toEqual(['AC.TO', 'AC'])
  })

  it('never repeats a candidate', () => {
    for (const s of ['NVDA', 'AC.TO', 'ORAC.NE', 'AVGO.NE']) {
      const c = logoCandidates(s)
      expect(new Set(c).size).toBe(c.length)
    }
  })

  it('returns nothing for an empty symbol, so the avatar shows', () => {
    expect(logoCandidates('')).toEqual([])
    expect(logoCandidates(null)).toEqual([])
    expect(logoCandidates(undefined)).toEqual([])
  })
})

describe('logoUrl', () => {
  const sizeOf = (url) => Number(new URL(url).searchParams.get('size'))

  it('requests enough pixels for the device ratio', () => {
    expect(sizeOf(logoUrl('NVDA', 40, 1))).toBeGreaterThanOrEqual(40)
    expect(sizeOf(logoUrl('NVDA', 40, 2))).toBeGreaterThanOrEqual(80)
    expect(sizeOf(logoUrl('NVDA', 40, 3))).toBeGreaterThanOrEqual(120)
  })

  // Arbitrary widths made almost every logo a separate CDN object.
  it('snaps to shared buckets rather than arbitrary widths', () => {
    const widths = [18, 24, 38, 40, 44, 64].flatMap((s) => [1, 2, 3].map((x) => sizeOf(logoUrl('X', s, x))))
    expect(new Set(widths).size).toBeLessThanOrEqual(6)
    for (const w of widths) expect([32, 64, 96, 128, 192, 256, 384, 512]).toContain(w)
  })

  it('caps at the largest bucket', () => {
    expect(sizeOf(logoUrl('NVDA', 400, 3))).toBe(512)
  })

  it('encodes symbols that contain a dot', () => {
    expect(logoUrl('AC.TO', 40, 1)).toContain('AC.TO')
  })
})

// You hold a leveraged wrapper to own one company, so the row should be
// captioned with that company. Left alone the CDN either 404s (NVDL, CONL) or
// serves the issuer's house logo (TSLL, AMDL) — so a Direxion Tesla product and
// a Direxion Apple product rendered as the same picture.
describe('leveraged single-stock products', () => {
  it('maps the known wrappers to the company they track', () => {
    expect(logoCandidates('NVDL')[0]).toBe('NVDA')
    expect(logoCandidates('TSLL')[0]).toBe('TSLA')
    expect(logoCandidates('CONL')[0]).toBe('COIN')
    expect(logoCandidates('MSTU')[0]).toBe('MSTR')
    expect(logoCandidates('PLTU')[0]).toBe('PLTR')
  })

  it('keeps the wrapper itself as a fallback', () => {
    expect(logoCandidates('NVDL')).toEqual(['NVDA', 'NVDL'])
  })

  it('covers inverse products too — it still identifies the underlying', () => {
    expect(logoCandidates('TSLS')[0]).toBe('TSLA')
    expect(logoCandidates('NVDD')[0]).toBe('NVDA')
  })
})

describe('underlyingFromName', () => {
  // Real product names, read off the exchange on 2026-08-31.
  it('reads the ticker out of a fund name', () => {
    expect(underlyingFromName('GraniteShares 2x Long NVDA Daily ETF', 'NVDL')).toBe('NVDA')
    expect(underlyingFromName('Direxion Daily TSLA Bull 2X ETF', 'TSLL')).toBe('TSLA')
    expect(underlyingFromName('T-Rex 2X Long MSTR Daily Target ETF', 'MSTU')).toBe('MSTR')
  })

  // No single company sits behind an index product; the issuer's own logo is
  // the honest answer, so this must decline rather than guess.
  it('declines on index products', () => {
    expect(underlyingFromName('BETAPRO SP500 2X DAILY BULL ETF', 'HSU.TO')).toBeNull()
    expect(underlyingFromName('BETAPRO NASDAQ 100 2X DAILY BULL', 'HQU.TO')).toBeNull()
  })

  it('ignores anything that is not a leveraged product', () => {
    expect(underlyingFromName('BROADCOM INC CDR C$HDG', 'AVGO')).toBeNull()
    expect(underlyingFromName('NVIDIA CORP', 'NVDA')).toBeNull()
    expect(underlyingFromName('', 'NVDA')).toBeNull()
  })

it('does not mistake the issuer for the underlying', () => {
    // "T-Rex" yielded REX when the parser took the first plausible token.
    expect(underlyingFromName('T-Rex 2X Long MSTR Daily Target ETF', 'MSTU')).toBe('MSTR')
    expect(underlyingFromName('Direxion Daily AAPL Bull 2X ETF', 'AAPU')).toBe('AAPL')
    expect(underlyingFromName('Defiance Daily Target 2x Long MSTR', 'MSTX')).toBe('MSTR')
  })


  it('never returns the holding’s own symbol', () => {
    expect(underlyingFromName('NVDL 2X Long NVDL Daily', 'NVDL')).not.toBe('NVDL')
  })

  it('feeds through to the candidate list for unmapped wrappers', () => {
    expect(logoCandidates('XYZL', 'Issuer 2x Long AVGO Daily ETF')[0]).toBe('AVGO')
    // and an index product falls through to the fund's own logo
    expect(logoCandidates('HSU.TO', 'BETAPRO SP500 2X DAILY BULL ETF')).toEqual(['HSU.TO', 'HSU'])
  })
})

describe('CDRs keep showing the underlying company', () => {
  it('resolves a CDR to the US company', () => {
    expect(logoCandidates('AVGO.NE', 'BROADCOM INC CDR C$HDG')[0]).toBe('AVGO')
    expect(logoCandidates('ORAC.NE', 'ORACLE CORP CDR C$HDG')[0]).toBe('ORCL')
  })

  it('never tries the .NE symbol, which does not resolve', () => {
    expect(logoCandidates('AVGO.NE')).not.toContain('AVGO.NE')
  })
})
