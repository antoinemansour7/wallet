import { describe, it, expect } from 'vitest'
import {
  LISTING,
  TREATMENT,
  classifyHolding,
  projectWithholding,
  compareAccountTypes,
  describeWithholding,
} from './withholdingTax'

const holding = (overrides = {}) => ({
  SYMBOL: 'VTI',
  DESCRIPTION: 'VANGUARD TOTAL STOCK MARKET ETF',
  'MARKET VALUE': '50000.00',
  'ACCOUNT CURRENCY': 'USD',
  ...overrides,
})

const CA_FUND = holding({
  SYMBOL: 'VFV.TO',
  DESCRIPTION: 'VANGUARD S&P 500 INDEX ETF',
  'ACCOUNT CURRENCY': 'CAD',
})

const CDR = holding({
  SYMBOL: 'NVDA',
  DESCRIPTION: 'NVIDIA CORP CDR C$HDG',
  'ACCOUNT CURRENCY': 'CAD',
})

describe('classifyHolding', () => {
  it('reads a US-listed fund as directly held, where the treaty applies', () => {
    expect(classifyHolding(holding())).toMatchObject({
      listing: LISTING.US,
      treatment: TREATMENT.TREATY,
    })
  })

  it('reads a Canadian-listed fund of US equities as losing the tax inside the fund', () => {
    // The withholding happens before any distribution reaches the account, so
    // no account type rescues it. This is the case that makes the feature
    // non-trivial.
    expect(classifyHolding(CA_FUND)).toMatchObject({
      listing: LISTING.CA,
      treatment: TREATMENT.IN_FUND,
    })
  })

  it('reads a CDR as Canadian-listed and not rescued by any account', () => {
    // A CDR is a Canadian wrapper over a US share. Treating it as US-listed
    // would promise an RRSP saving that never arrives.
    expect(classifyHolding(CDR)).toMatchObject({
      listing: LISTING.CA,
      treatment: TREATMENT.IN_FUND,
    })
  })

  it('reads a Canadian company as having no US withholding at all', () => {
    const royalBank = holding({ SYMBOL: 'RY.TO', DESCRIPTION: 'ROYAL BANK OF CANADA', 'ACCOUNT CURRENCY': 'CAD' })
    expect(classifyHolding(royalBank)).toMatchObject({ treatment: TREATMENT.NONE })
  })

  it('says it does not know rather than guessing an unfamiliar Canadian fund', () => {
    // Guessing "domestic" hides a real cost; guessing "foreign" invents one.
    const unknown = holding({ SYMBOL: 'ZZZZ.TO', DESCRIPTION: 'SOME NEW ETF', 'ACCOUNT CURRENCY': 'CAD' })
    expect(classifyHolding(unknown).treatment).toBe(TREATMENT.UNKNOWN)
  })

  describe('fundExposureHint (#88 — real fund composition, when the caller has it)', () => {
    const unknown = holding({ SYMBOL: 'ZZZZ.TO', DESCRIPTION: 'SOME NEW ETF', 'ACCOUNT CURRENCY': 'CAD' })

    it('resolves a fund the hardcoded lists have never heard of, given real composition data', () => {
      const result = classifyHolding(unknown, { fundExposureHint: { holdsForeignEquities: true } })
      expect(result.treatment).toBe(TREATMENT.IN_FUND)
    })

    it('resolves a fund as domestic when its real holdings are all domestic', () => {
      const result = classifyHolding(unknown, { fundExposureHint: { holdsForeignEquities: false } })
      expect(result.treatment).toBe(TREATMENT.NONE)
    })

    it('takes priority over the hardcoded lists when both could answer', () => {
      // The hint is live data about this specific fund's current holdings; the
      // hardcoded set is a stale snapshot from whenever it was last edited.
      // Real data wins.
      const knownForeign = holding({ SYMBOL: 'VFV.TO', DESCRIPTION: 'VANGUARD S&P 500 INDEX ETF', 'ACCOUNT CURRENCY': 'CAD' })
      const result = classifyHolding(knownForeign, { fundExposureHint: { holdsForeignEquities: false } })
      expect(result.treatment).toBe(TREATMENT.NONE)
    })

    it('falls back to the hardcoded lists when no hint is supplied, unchanged', () => {
      // Every other test in this file calls classifyHolding with one argument.
      // This proves the sync, hint-free path — the one those tests actually
      // exercise — still behaves exactly as before.
      expect(classifyHolding(unknown).treatment).toBe(TREATMENT.UNKNOWN)
    })
  })
})

describe('projectWithholding', () => {
  it('reports the drag on a US-listed fund in a TFSA, with the arithmetic', () => {
    const result = projectWithholding({ row: holding(), accountType: 'TFSA', assumptions: { yieldPct: 1.3 } })

    // 50,000 × 1.3% × 15% = 97.50
    expect(result.annualWithheldMinor).toBe(9750)
    expect(result.recoverable).toBe(false)
    expect(result.avoidable).toBe(true)
    expect(result.basis).toBe('projected')
    // The workings travel with the number so the screen can show them.
    expect(result.workings).toMatchObject({
      marketValueMinor: 5000000,
      yieldPct: 1.3,
      withholdingRatePct: 15,
    })
  })

  it('reports nothing withheld on the same fund in an RRSP', () => {
    const result = projectWithholding({ row: holding(), accountType: 'RRSP', assumptions: { yieldPct: 1.3 } })
    expect(result.annualWithheldMinor).toBe(0)
    expect(result.exempt).toBe(true)
  })

  it('treats a RRIF and a LIRA like an RRSP', () => {
    for (const accountType of ['RRIF', 'LIRA']) {
      expect(projectWithholding({ row: holding(), accountType, assumptions: { yieldPct: 1.3 } }).exempt).toBe(true)
    }
  })

  it('treats an FHSA and an RESP like a TFSA — not exempt', () => {
    // Neither is recognised as a pension under the treaty, which surprises
    // people who assume "registered" means "sheltered".
    for (const accountType of ['FHSA', 'RESP']) {
      const result = projectWithholding({ row: holding(), accountType, assumptions: { yieldPct: 1.3 } })
      expect(result.exempt).toBe(false)
      expect(result.recoverable).toBe(false)
    }
  })

  it('marks a non-registered account as withheld but recoverable', () => {
    const result = projectWithholding({ row: holding(), accountType: 'NON_REGISTERED', assumptions: { yieldPct: 1.3 } })
    expect(result.annualWithheldMinor).toBe(9750)
    expect(result.recoverable).toBe(true)
    // Recoverable through the foreign tax credit, so no account change avoids it.
    expect(result.avoidable).toBe(false)
  })

  it('reports the drag on a Canadian-listed fund of US equities as unavoidable', () => {
    const result = projectWithholding({ row: CA_FUND, accountType: 'RRSP', assumptions: { yieldPct: 1.3 } })
    expect(result.annualWithheldMinor).toBeGreaterThan(0)
    expect(result.avoidable).toBe(false)
    expect(result.recoverable).toBe(false)
    expect(result.treatment).toBe(TREATMENT.IN_FUND)
  })

  describe('says nothing when there is nothing to say', () => {
    it('returns null for a Canadian company', () => {
      const royalBank = holding({ SYMBOL: 'RY.TO', DESCRIPTION: 'ROYAL BANK OF CANADA', 'ACCOUNT CURRENCY': 'CAD' })
      expect(projectWithholding({ row: royalBank, accountType: 'TFSA' })).toBeNull()
    })

    it('returns null when the security cannot be classified', () => {
      const unknown = holding({ SYMBOL: 'ZZZZ.TO', DESCRIPTION: 'SOME NEW ETF', 'ACCOUNT CURRENCY': 'CAD' })
      expect(projectWithholding({ row: unknown, accountType: 'TFSA' })).toBeNull()
    })

    it('returns null for a holding with no market value to project from', () => {
      expect(projectWithholding({ row: holding({ 'MARKET VALUE': '0' }), accountType: 'TFSA' })).toBeNull()
    })
  })
})

describe('compareAccountTypes', () => {
  it('shows each account type the user actually has, side by side', () => {
    const comparison = compareAccountTypes({
      row: holding(),
      currentAccountType: 'TFSA',
      availableAccountTypes: ['TFSA', 'RRSP', 'NON_REGISTERED'],
      assumptions: { yieldPct: 1.3 },
    })

    expect(comparison.options.map((o) => o.accountType)).toEqual(['TFSA', 'RRSP', 'NON_REGISTERED'])
    expect(comparison.options.find((o) => o.accountType === 'RRSP').annualWithheldMinor).toBe(0)
    expect(comparison.options.find((o) => o.accountType === 'TFSA').annualWithheldMinor).toBe(9750)
    expect(comparison.current).toBe('TFSA')
  })

  it('offers no comparison when the user holds no account that would differ', () => {
    // Nothing to compare against is not a finding. Showing an RRSP column to
    // someone with no RRSP is a recommendation to open one.
    const comparison = compareAccountTypes({
      row: holding(),
      currentAccountType: 'TFSA',
      availableAccountTypes: ['TFSA'],
      assumptions: { yieldPct: 1.3 },
    })
    expect(comparison).toBeNull()
  })

  it('offers no comparison when the drag is unavoidable anyway', () => {
    const comparison = compareAccountTypes({
      row: CA_FUND,
      currentAccountType: 'TFSA',
      availableAccountTypes: ['TFSA', 'RRSP'],
      assumptions: { yieldPct: 1.3 },
    })
    expect(comparison).toBeNull()
  })

  it('carries the assumptions so the screen can make them editable', () => {
    const comparison = compareAccountTypes({
      row: holding(),
      currentAccountType: 'TFSA',
      availableAccountTypes: ['TFSA', 'RRSP'],
      assumptions: { yieldPct: 2.5 },
    })
    expect(comparison.assumptions.yieldPct).toBe(2.5)
  })
})

describe('describeWithholding', () => {
  it('states the fact without telling anyone what to do', () => {
    const result = projectWithholding({ row: holding(), accountType: 'TFSA', assumptions: { yieldPct: 1.3 } })
    const text = describeWithholding(result)

    expect(text).toContain('$97.50')
    expect(text).toMatch(/withheld/i)
  })

  it('never issues an instruction, in any state it can produce', () => {
    // Advising on a specific security is the thing that needs registration.
    // The whole feature is framed as measurement, and this is the test that
    // keeps it there when someone edits the copy later.
    const forbidden = /\b(move|should|consider|recommend|transfer it|switch|you ought|we suggest|better to)\b/i

    const states = [
      projectWithholding({ row: holding(), accountType: 'TFSA', assumptions: { yieldPct: 1.3 } }),
      projectWithholding({ row: holding(), accountType: 'RRSP', assumptions: { yieldPct: 1.3 } }),
      projectWithholding({ row: holding(), accountType: 'NON_REGISTERED', assumptions: { yieldPct: 1.3 } }),
      projectWithholding({ row: CA_FUND, accountType: 'TFSA', assumptions: { yieldPct: 1.3 } }),
    ]

    for (const state of states) {
      expect(describeWithholding(state)).not.toMatch(forbidden)
    }
  })

  it('says what a different account type would have been, as a fact not a suggestion', () => {
    const result = projectWithholding({ row: holding(), accountType: 'TFSA', assumptions: { yieldPct: 1.3 } })
    const text = describeWithholding(result, { comparisonAccountType: 'RRSP' })

    expect(text).toMatch(/RRSP/)
    expect(text).toMatch(/would have been \$0/i)
    expect(text).not.toMatch(/\bmove\b/i)
  })
})
