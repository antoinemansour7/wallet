import { describe, it, expect } from 'vitest'
import {
  LISTING,
  TREATMENT,
  classifyHolding,
  projectWithholding,
  compareAccountTypes,
  describeWithholding,
  measureAccountWithholding,
  resolveWithholding,
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

// ─── Stage 2: measured ─────────────────────────────────────────────────────────

const NOW = Date.parse('2026-09-06T00:00:00Z')

/** A withholding record as the ledger stores it. */
const tax = (overrides = {}) => ({
  id: `tax-${Math.random().toString(36).slice(2)}`,
  accountId: 'tfsa-1',
  accountType: 'TFSA',
  action: 'TAX',
  tradeDate: '2026-06-01',
  amountMinor: 1500,
  currency: 'USD',
  ...overrides,
})

describe('measureAccountWithholding', () => {
  it('sums what was actually withheld over the last twelve months', () => {
    const measured = measureAccountWithholding({
      transactions: [
        tax({ tradeDate: '2026-03-02', amountMinor: 4321 }),
        tax({ tradeDate: '2026-06-02', amountMinor: 4322 }),
        tax({ tradeDate: '2025-12-02', amountMinor: 100 }),
      ],
      accountId: 'tfsa-1',
      now: NOW,
    })

    expect(measured.annualWithheldMinor).toBe(8743)
    expect(measured.basis).toBe('measured')
    expect(measured.workings.recordCount).toBe(3)
  })

  it('ignores records outside the window, and other accounts', () => {
    const measured = measureAccountWithholding({
      transactions: [
        tax({ tradeDate: '2026-06-01', amountMinor: 1000 }),
        tax({ tradeDate: '2025-01-01', amountMinor: 9999 }),   // too old
        tax({ tradeDate: '2027-01-01', amountMinor: 8888 }),   // in the future
        tax({ accountId: 'rrsp-1', amountMinor: 7777 }),       // another account
      ],
      accountId: 'tfsa-1',
      now: NOW,
    })

    expect(measured.annualWithheldMinor).toBe(1000)
  })

  it('counts a withholding record however the institution spells the sign', () => {
    const measured = measureAccountWithholding({
      transactions: [tax({ amountMinor: -2500 })],
      accountId: 'tfsa-1',
      now: NOW,
    })

    expect(measured.annualWithheldMinor).toBe(2500)
  })

  it('says nothing rather than reporting a partial year as an annual figure', () => {
    // A ledger that only reaches back four months cannot state twelve months of
    // drag. Reporting the partial sum understates it, and does so invisibly.
    expect(measureAccountWithholding({
      transactions: [tax({ tradeDate: '2026-06-01' })],
      accountId: 'tfsa-1',
      now: NOW,
      historyStartsAt: '2026-05-01',
    })).toBeNull()
  })

  it('returns nothing when there is nothing withheld to measure', () => {
    expect(measureAccountWithholding({ transactions: [], accountId: 'tfsa-1', now: NOW })).toBeNull()
    expect(measureAccountWithholding({ transactions: [tax()], now: NOW })).toBeNull()
  })

  it('flags a mixed-currency total rather than summing it as one currency', () => {
    const measured = measureAccountWithholding({
      transactions: [tax({ currency: 'USD' }), tax({ currency: 'CAD' })],
      accountId: 'tfsa-1',
      now: NOW,
    })

    expect(measured.workings.mixedCurrency).toBe(true)
    expect(measured.workings.currencies.sort()).toEqual(['CAD', 'USD'])
  })

  it('marks the tax unrecoverable in a TFSA and recoverable in a cash account', () => {
    const inTfsa = measureAccountWithholding({ transactions: [tax()], accountId: 'tfsa-1', now: NOW })
    const inCash = measureAccountWithholding({
      transactions: [tax({ accountId: 'cash-1', accountType: 'NON_REGISTERED' })],
      accountId: 'cash-1',
      now: NOW,
    })

    expect(inTfsa.recoverable).toBe(false)
    expect(inTfsa.avoidable).toBe(true)
    expect(inCash.recoverable).toBe(true)
    expect(inCash.avoidable).toBe(false)
  })
})

describe('resolveWithholding', () => {
  it('prefers the measured figure and says which basis it is', () => {
    const resolved = resolveWithholding({
      row: holding(),
      accountType: 'TFSA',
      accountId: 'tfsa-1',
      transactions: [tax({ amountMinor: 8743 })],
      now: NOW,
    })

    expect(resolved.basis).toBe('measured')
    expect(resolved.annualWithheldMinor).toBe(8743)
    // The projection on $50,000 at the assumed 1.3% would have been 9750.
    expect(resolved.annualWithheldMinor).not.toBe(9750)
  })

  it('falls back to the projection, still saying which basis it is', () => {
    const resolved = resolveWithholding({
      row: holding(),
      accountType: 'TFSA',
      accountId: 'tfsa-1',
      transactions: [],
      now: NOW,
    })

    expect(resolved.basis).toBe('projected')
    expect(resolved.annualWithheldMinor).toBe(9750)
  })

  it('keeps the projection for tax lost inside a fund, which no record can measure', () => {
    // In-fund withholding is taken before the distribution is paid, so it never
    // appears against the account. A measured zero here would be a lie.
    const resolved = resolveWithholding({
      row: CA_FUND,
      accountType: 'TFSA',
      accountId: 'tfsa-1',
      transactions: [tax({ amountMinor: 500 })],
      now: NOW,
    })

    expect(resolved.treatment).toBe(TREATMENT.IN_FUND)
    expect(resolved.basis).toBe('projected')
  })

  it('describes a measured figure as the past, not as a forecast', () => {
    const resolved = resolveWithholding({
      row: holding(),
      accountType: 'TFSA',
      accountId: 'tfsa-1',
      transactions: [tax({ amountMinor: 8743 })],
      now: NOW,
    })

    expect(describeWithholding(resolved)).toContain('over the last 12 months')
    expect(describeWithholding(resolved)).toContain('$87.43')
  })

  it('still issues no instruction on the measured path', () => {
    const resolved = resolveWithholding({
      row: holding(),
      accountType: 'TFSA',
      accountId: 'tfsa-1',
      transactions: [tax()],
      now: NOW,
    })

    expect(describeWithholding(resolved, { comparisonAccountType: 'RRSP' }))
      .not.toMatch(/\b(move|switch|transfer|should|consider|recommend|buy|sell)\b/i)
  })
})
