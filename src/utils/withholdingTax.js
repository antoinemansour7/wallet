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

export function classifyHolding(row) {
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

export function projectWithholding({ row, accountType, assumptions = {} } = {}) {
  const merged = { ...DEFAULT_ASSUMPTIONS, ...assumptions }
  const classification = classifyHolding(row)

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

export function compareAccountTypes({ row, currentAccountType, availableAccountTypes = [], assumptions = {} } = {}) {
  const current = normalizeAccountType(currentAccountType)
  const projection = projectWithholding({ row, accountType: current, assumptions })
  if (!projection) return null

  // An unavoidable cost has nothing to compare. Showing a table of identical
  // numbers implies a choice that does not exist.
  if (!projection.avoidable) return null

  const types = [...new Set(availableAccountTypes.map(normalizeAccountType))]
  const options = types
    .map((accountType) => {
      const option = projectWithholding({ row, accountType, assumptions })
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
