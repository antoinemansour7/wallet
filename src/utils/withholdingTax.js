/**
 * US withholding tax on dividends, as a measurement.
 *
 * Design note for [#17]. The rule: a US-listed security pays a dividend and
 * the US withholds 15% before it reaches the holder. Under the Canada–US
 * treaty an RRSP is exempt and nothing is withheld. A TFSA is not — it is not
 * recognised as a pension account — so the 15% is taken and can never be
 * recovered. In a non-registered account it is withheld but recoverable
 * through the foreign tax credit.
 *
 * Two things this module will not do.
 *
 * **It will not instruct.** Everything here answers "what is happening" and
 * "what would this look like elsewhere". Telling someone to move a specific
 * security is advice on a security, which is the part that needs
 * registration. `describeWithholding` is tested against a list of imperative
 * verbs to keep it that way when the copy is edited later.
 *
 * **It will not guess.** The wrapper matters as much as the account: a
 * Canadian-listed fund holding US equities (VFV, XEQT) loses the withholding
 * *inside the fund*, before any distribution reaches the account, and no
 * account type or tax credit reaches it. Promising an RRSP saving that never
 * arrives would discredit every other number the app shows, so an
 * unrecognised security returns UNKNOWN and the screen says nothing.
 */

import { toMinorUnits } from './money'

export const LISTING = { US: 'US', CA: 'CA', UNKNOWN: 'UNKNOWN' }

export const TREATMENT = {
  /** US-listed and held directly: 15%, and the account type decides the outcome. */
  TREATY: 'TREATY',
  /** Canadian-listed wrapper over foreign equities: lost inside the fund, unavoidable. */
  IN_FUND: 'IN_FUND',
  /** Canadian security: no US withholding at all. */
  NONE: 'NONE',
  /** Not recognised. Say nothing. */
  UNKNOWN: 'UNKNOWN',
}

const TREATY_RATE_PCT = 15

/** A yield has to come from somewhere until #19 supplies the real dividends. */
export const DEFAULT_ASSUMPTIONS = { yieldPct: 1.3 }

/**
 * Exempt under Article XXI: Canadian registered *retirement* plans.
 * A TFSA, FHSA and RESP are registered but are not pensions, which is the
 * distinction people are most often surprised by.
 */
const TREATY_EXEMPT_ACCOUNTS = new Set(['RRSP', 'RRIF', 'LIRA', 'LRIF', 'LIF', 'RRSP_SPOUSAL'])
const UNRECOVERABLE_ACCOUNTS = new Set(['TFSA', 'FHSA', 'RESP', 'RDSP'])

/**
 * Canadian-listed funds that hold foreign equities. Curated rather than
 * derived: nothing in a holdings row says what a fund owns, and there is no
 * free source for it. Anything absent from this list is UNKNOWN, not assumed
 * domestic — a wrong "no drag here" is the expensive direction of the error.
 */
const CA_LISTED_FOREIGN_FUNDS = new Set([
  'VFV', 'VSP', 'VUN', 'VUS', 'VGRO', 'VBAL', 'VEQT', 'VCNS', 'VDY', 'VIU', 'VEE', 'VXC',
  'XUU', 'XUS', 'XSP', 'XEQT', 'XGRO', 'XBAL', 'XAW', 'XEF', 'XEC', 'XIN',
  'ZSP', 'ZUE', 'ZEA', 'ZEM', 'ZGRO', 'ZBAL', 'ZQQ',
  'HXQ', 'HXS', 'TEC', 'QQC', 'ESGY',
])

/** Canadian-listed funds of Canadian equities: no US withholding to report. */
const CA_LISTED_DOMESTIC_FUNDS = new Set(['XIC', 'ZCN', 'VCN', 'XIU', 'ZDV', 'XDV', 'CDZ', 'VCE'])

const CA_SUFFIXES = ['.TO', '.V', '.NE', '.CN', '.TSX']

function symbolOf(row) {
  return String(row?.SYMBOL ?? '').trim().toUpperCase()
}

function baseSymbol(symbol) {
  const dot = symbol.indexOf('.')
  return dot === -1 ? symbol : symbol.slice(0, dot)
}

/** Mirrors the detection in livePrices.js: the description is the only signal. */
function isCdr(row) {
  return /\bCDR\b/i.test(String(row?.DESCRIPTION ?? ''))
}

function hasCanadianSuffix(symbol) {
  return CA_SUFFIXES.some((suffix) => symbol.endsWith(suffix))
}

/**
 * Pooled funds name themselves. A description carrying any of these is a
 * wrapper whose contents this module cannot see; anything else on a Canadian
 * exchange is treated as a company, which pays no US dividend.
 */
const FUND_WORDS = /\b(etf|fund|index|trust|portfolio|units?|class [a-z]\b)/i

function looksLikeFund(row) {
  return FUND_WORDS.test(String(row?.DESCRIPTION ?? ''))
}

/**
 * `fundExposureHint` is the integration point for #88's real composition
 * data — `{ holdsForeignEquities }` from `classifyFundComposition` in
 * securitiesReference.js, resolved by the caller from a fund's actual
 * current holdings and handed in here. Optional and sync: this function
 * never reaches across the network itself. Every test in this file except
 * the ones for this parameter calls classifyHolding with one argument, and
 * still exercises the hardcoded-list fallback below — deliberately, so the
 * rule engine's logic stays provable without network access.
 */
export function classifyHolding(row, { fundExposureHint } = {}) {
  const symbol = symbolOf(row)
  if (!symbol) return { listing: LISTING.UNKNOWN, treatment: TREATMENT.UNKNOWN }

  const base = baseSymbol(symbol)
  const currency = String(row?.['ACCOUNT CURRENCY'] ?? '').trim().toUpperCase()

  // A CDR is a Canadian instrument wrapping a US share. The withholding still
  // happens and no registered account escapes it, so it behaves like a fund
  // for this purpose even though it holds a single company.
  if (isCdr(row)) return { listing: LISTING.CA, treatment: TREATMENT.IN_FUND, wrapper: 'CDR' }

  const canadianListed = hasCanadianSuffix(symbol) || currency === 'CAD'

  if (canadianListed) {
    // Real data about this fund's current holdings outranks a hardcoded
    // snapshot from whenever the list below was last edited.
    if (fundExposureHint) {
      return {
        listing: LISTING.CA,
        treatment: fundExposureHint.holdsForeignEquities ? TREATMENT.IN_FUND : TREATMENT.NONE,
        wrapper: 'FUND',
      }
    }

    if (CA_LISTED_FOREIGN_FUNDS.has(base)) return { listing: LISTING.CA, treatment: TREATMENT.IN_FUND, wrapper: 'FUND' }
    if (CA_LISTED_DOMESTIC_FUNDS.has(base)) return { listing: LISTING.CA, treatment: TREATMENT.NONE, wrapper: 'FUND' }

    // `RY.TO` and an unrecognised ETF are indistinguishable by symbol, so the
    // description does the separating. A fund whose holdings are unknown could
    // be full of US equities, and claiming no drag there would hide a real
    // cost — so it is UNKNOWN. A single company on a Canadian exchange pays no
    // US dividend, so it is genuinely NONE.
    //
    // Both answers currently render the same (nothing on screen); they are
    // kept apart because only one of them is safe to build on later.
    if (looksLikeFund(row)) return { listing: LISTING.CA, treatment: TREATMENT.UNKNOWN, wrapper: 'FUND' }
    return { listing: LISTING.CA, treatment: TREATMENT.NONE, wrapper: 'DIRECT' }
  }

  if (currency === 'USD' || !hasCanadianSuffix(symbol)) {
    return { listing: LISTING.US, treatment: TREATMENT.TREATY, wrapper: 'DIRECT' }
  }

  return { listing: LISTING.UNKNOWN, treatment: TREATMENT.UNKNOWN, wrapper: 'UNKNOWN' }
}

function normalizeAccountType(accountType) {
  return String(accountType ?? '').trim().toUpperCase() || 'NON_REGISTERED'
}

export function projectWithholding({ row, accountType, assumptions = {}, fundExposureHint } = {}) {
  const merged = { ...DEFAULT_ASSUMPTIONS, ...assumptions }
  const classification = classifyHolding(row, { fundExposureHint })

  // Nothing to say is a valid and common answer.
  if (classification.treatment === TREATMENT.NONE) return null
  if (classification.treatment === TREATMENT.UNKNOWN) return null

  const marketValueMinor = toMinorUnits(row?.['MARKET VALUE'])
  if (!marketValueMinor || marketValueMinor <= 0) return null

  const type = normalizeAccountType(accountType)
  const inFund = classification.treatment === TREATMENT.IN_FUND
  const exempt = !inFund && TREATY_EXEMPT_ACCOUNTS.has(type)

  const annualWithheldMinor = exempt
    ? 0
    : Math.round((marketValueMinor * (merged.yieldPct / 100) * TREATY_RATE_PCT) / 100)

  // Recoverable through the foreign tax credit only in a taxable account, and
  // only when the tax was withheld at the border rather than inside a fund.
  const recoverable = !inFund && !exempt && !UNRECOVERABLE_ACCOUNTS.has(type)

  return {
    treatment: classification.treatment,
    listing: classification.listing,
    accountType: type,
    exempt,
    recoverable,
    // Whether a different account the user already has would produce a
    // different number. Unavoidable in-fund tax and recoverable tax both fail
    // this, for different reasons.
    avoidable: !inFund && !exempt && !recoverable,
    annualWithheldMinor,
    basis: 'projected',
    assumptions: merged,
    workings: {
      marketValueMinor,
      yieldPct: merged.yieldPct,
      withholdingRatePct: TREATY_RATE_PCT,
    },
  }
}

export function compareAccountTypes({ row, currentAccountType, availableAccountTypes = [], assumptions = {}, fundExposureHint } = {}) {
  const current = normalizeAccountType(currentAccountType)
  const projection = projectWithholding({ row, accountType: current, assumptions, fundExposureHint })
  if (!projection) return null

  // An unavoidable cost has nothing to compare. Showing a table of identical
  // numbers implies a choice that does not exist.
  if (!projection.avoidable) return null

  const types = [...new Set(availableAccountTypes.map(normalizeAccountType))]
  const options = types
    .map((accountType) => {
      const option = projectWithholding({ row, accountType, assumptions, fundExposureHint })
      return option && { accountType, annualWithheldMinor: option.annualWithheldMinor, exempt: option.exempt, recoverable: option.recoverable }
    })
    .filter(Boolean)

  // Only the accounts the user actually holds appear. Offering an RRSP column
  // to someone without an RRSP is a recommendation to open one.
  const differs = options.some((option) => option.annualWithheldMinor !== projection.annualWithheldMinor)
  if (!differs) return null

  return {
    current,
    options,
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...assumptions },
    basis: projection.basis,
  }
}

function dollars(minor) {
  const value = Math.abs(minor) / 100
  return `$${value.toFixed(2)}`
}

/**
 * Copy, phrased as measurement.
 *
 * Every sentence states what is true of the holding as it stands, or what a
 * figure would have been under a different account type. Neither is advice to
 * trade, and the test suite enforces the absence of imperative verbs.
 */
export function describeWithholding(projection, { comparisonAccountType } = {}) {
  if (!projection) return ''

  const amount = dollars(projection.annualWithheldMinor)
  const period = projection.basis === 'projected' ? 'a year' : 'over the last 12 months'

  if (projection.treatment === TREATMENT.IN_FUND) {
    return `About ${amount} ${period} is withheld inside this fund before any distribution reaches the account. No account type changes that, and it cannot be recovered.`
  }

  if (projection.exempt) {
    return `Nothing is withheld on this holding in a ${projection.accountType}. Under the Canada–US treaty this account is exempt.`
  }

  const base = projection.recoverable
    ? `About ${amount} ${period} is withheld, and is recoverable through the foreign tax credit.`
    : `About ${amount} ${period} is withheld and cannot be recovered.`

  if (comparisonAccountType) {
    return `${base} In a ${normalizeAccountType(comparisonAccountType)}, that would have been $0.`
  }

  return base
}

// ─── Stage 2: measured ─────────────────────────────────────────────────────────

/**
 * What was actually withheld, from the ledger.
 *
 * The projection above is arithmetic over a yield assumption. This is the same
 * quantity counted from real records, and it is better for one reason that
 * matters more than accuracy: the user can check it against their own
 * statement. A number someone can verify persuades where a number they have to
 * trust does not, which is the same reason this app shows its arithmetic
 * everywhere else.
 *
 * Account-level rather than per-holding, because that is the grain the data
 * arrives at: a withholding record names the security it came from, but the
 * figure a person recognises from their statement is the account total.
 *
 * Returns null when there is nothing to measure — no records at all, or a
 * ledger that does not reach back far enough to be worth stating. Silence is
 * the correct output; falling back to the projection is the caller's decision,
 * made explicit in resolveWithholding.
 */
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000

export function measureAccountWithholding({ transactions = [], accountId, now = Date.now(), historyStartsAt = null } = {}) {
  if (!accountId) return null

  const cutoff = new Date(now - TWELVE_MONTHS_MS).toISOString().slice(0, 10)
  const today = new Date(now).toISOString().slice(0, 10)

  // A ledger that begins inside the window cannot state a twelve-month figure.
  // Reporting a partial year as an annual number understates the drag, and it
  // does so invisibly — the sort of plausible wrong number this module refuses
  // everywhere else.
  if (historyStartsAt && historyStartsAt > cutoff) return null

  const withheld = transactions.filter((t) => (
    t?.action === 'TAX'
    && t.accountId === accountId
    && typeof t.tradeDate === 'string'
    && t.tradeDate >= cutoff
    && t.tradeDate <= today
  ))
  if (withheld.length === 0) return null

  const annualWithheldMinor = withheld.reduce((sum, t) => sum + Math.abs(Number(t.amountMinor) || 0), 0)
  const accountType = normalizeAccountType(withheld[0].accountType)
  const currencies = [...new Set(withheld.map((t) => String(t.currency ?? '').trim().toUpperCase()).filter(Boolean))]
  // Tax was actually taken, so this is withholding at the border by definition.
  // Whether it comes back is the only open question, and that is the account.
  const recoverable = !UNRECOVERABLE_ACCOUNTS.has(accountType)

  return {
    treatment: TREATMENT.TREATY,
    accountType,
    exempt: false,
    recoverable,
    // Avoidable means a different account the user already has would produce a
    // smaller number: true exactly when this one keeps the tax for good.
    avoidable: !recoverable,
    annualWithheldMinor,
    basis: 'measured',
    workings: {
      recordCount: withheld.length,
      from: cutoff,
      to: today,
      // Stated rather than converted. A mixed-currency total silently summed as
      // though it were one currency is wrong, and saying so lets the caller
      // decide instead of hiding it.
      currencies,
      mixedCurrency: currencies.length > 1,
    },
  }
}

/**
 * The measured figure where the ledger supports one, the projection otherwise,
 * and always which of the two this is.
 *
 * The `basis` field is not decoration. A projected number rests on an assumed
 * yield the user may disagree with; a measured one is a fact about their
 * account. A screen that renders them identically invites someone to file the
 * first as though it were the second.
 */
export function resolveWithholding({ row, accountType, transactions = [], accountId, assumptions = {}, fundExposureHint, now = Date.now(), historyStartsAt = null } = {}) {
  const projected = projectWithholding({ row, accountType, assumptions, fundExposureHint })

  // Tax withheld inside a fund never appears as a record against the account —
  // it is taken before the distribution is paid — so the ledger cannot measure
  // it and the projection is the only available statement of it.
  if (projected?.treatment === TREATMENT.IN_FUND) return projected

  const measured = measureAccountWithholding({ transactions, accountId, now, historyStartsAt })
  if (!measured) return projected

  // A measured zero in an exempt account agrees with the projection; keep the
  // projection's richer explanation of why it is zero.
  if (projected?.exempt && measured.annualWithheldMinor === 0) return projected

  return { ...projected, ...measured, listing: projected?.listing ?? measured.treatment }
}
