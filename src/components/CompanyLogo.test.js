import { describe, expect, it } from 'vitest'
import { logoCandidates, logoUrl } from './CompanyLogo'

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
