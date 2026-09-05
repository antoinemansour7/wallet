/**
 * What converting CAD to USD costs, and what the cheaper route costs.
 *
 * Buying US-listed securities requires US dollars, and a broker's conversion
 * spread is roughly 1.5–2.5%. Norbert's Gambit — buy DLR on the TSX in CAD,
 * journal the position to its US-dollar twin, sell DLR.U in USD — costs the
 * bid-ask spread plus two commissions, which on a large amount is a fraction
 * of a percent.
 *
 * The saving is not the hard part. People know it exists. They avoid the
 * technique because the steps differ at every broker — some journal
 * automatically, some need a phone call, some settle before the second leg can
 * be sold — and getting it wrong feels expensive. So the steps matter more
 * than the number, and an unknown broker has to admit its steps are unverified
 * rather than inventing them.
 *
 * Note the difference from withholdingTax.js, which must never instruct.
 * This is a well-known market mechanic, not advice on a security, so the
 * wording here is deliberately instructional. The line it must not cross is
 * pitching DLR as something worth owning: it is plumbing used for a few days,
 * and a test guards the copy against reading like a recommendation.
 */

import { classifyHolding, LISTING } from './withholdingTax'
import { toMinorUnits } from './money'

/** Below this the saving stops being worth the steps and the settlement wait. */
export const GAMBIT_MINIMUM_CAD = 5000

/**
 * Per-broker conversion facts.
 *
 * `spreadPct` is the conversion cost the broker charges; `commission` is per
 * leg, and the gambit needs two. Journalling notes are the part people get
 * stuck on, so they are recorded per broker rather than generalised.
 *
 * These change. Anything here should be treated as needing confirmation
 * against the broker before someone acts on it, which is why the copy says so
 * for unknown brokers and why `stepsAreGeneric` exists at all.
 */
const BROKERS = {
  questrade: {
    name: 'Questrade',
    spreadPct: 1.5,
    commissionMinor: 495,
    journalling: 'Buy DLR on the TSX, then ask support to journal it to DLR.U before selling.',
    settlement: 'The journal request is usually same-day, but the sale settles the next business day.',
  },
  'td-direct-investing': {
    name: 'TD Direct Investing',
    spreadPct: 1.5,
    commissionMinor: 999,
    journalling: 'Buy DLR, then call the trading desk to journal the shares to DLR.U — it is not available online.',
    settlement: 'Allow a business day between the journal and the sale.',
  },
  'rbc-direct-investing': {
    name: 'RBC Direct Investing',
    spreadPct: 1.5,
    commissionMinor: 995,
    journalling: 'Buy DLR and sell DLR.U — RBC journals automatically when the sell order needs the shares.',
    settlement: 'Selling before settlement can show a temporary negative balance; it clears.',
  },
  wealthsimple: {
    name: 'Wealthsimple',
    spreadPct: 1.5,
    commissionMinor: 0,
    journalling: 'Wealthsimple converts in-app rather than supporting a journal, so the gambit is not available on every account type.',
    settlement: 'Check whether your account supports holding US dollars before starting.',
    gambitWorthwhile: false,
  },
  'interactive-brokers': {
    name: 'Interactive Brokers',
    spreadPct: 0.02,
    commissionMinor: 200,
    journalling: 'IBKR converts close to the interbank rate directly, so the technique saves nothing here.',
    settlement: '',
    // A multi-day workaround that saves nothing would discredit every other
    // figure the app shows.
    gambitWorthwhile: false,
  },
  'bmo-investorline': {
    name: 'BMO InvestorLine',
    spreadPct: 1.75,
    commissionMinor: 999,
    journalling: 'Buy DLR, then request the journal to DLR.U by phone or secure message.',
    settlement: 'Allow a business day between the journal and the sale.',
  },
  'cibc-investors-edge': {
    name: 'CIBC Investor’s Edge',
    spreadPct: 1.75,
    commissionMinor: 695,
    journalling: 'Buy DLR, then call to journal the shares to DLR.U.',
    settlement: 'Allow a business day between the journal and the sale.',
  },
}

const GENERIC = {
  key: 'generic',
  name: 'your broker',
  spreadPct: 1.5,
  commissionMinor: 995,
  journalling: 'Buy DLR on the TSX, have the shares journalled to DLR.U, then sell in US dollars.',
  settlement: 'Journalling and settlement timing vary — confirm both with your broker before starting.',
  stepsAreGeneric: true,
}

/**
 * The bid-ask spread paid across the two legs of the gambit.
 *
 * The technique costs 0.05–0.20% in practice, and this sits mid-range rather
 * than at the optimistic end. DLR's quoted spread really is tight, but the
 * figure someone acts on has to survive a wider spread on the day, a partial
 * fill, and the rate drifting while the shares are journalled. Quoting the
 * best case would overstate the saving, and a saving that fails to appear is
 * the one thing that would stop anyone trusting this page again.
 */
const BID_ASK_PCT = 0.1

function brokerKeyFrom(sourceId) {
  const id = String(sourceId ?? '')
  if (!id.startsWith('plaid:')) return null
  return id.slice('plaid:'.length)
}

export function brokerProfile(sourceId) {
  const key = brokerKeyFrom(sourceId)
  const known = key && BROKERS[key]
  if (!known) return { ...GENERIC }
  return { key, gambitWorthwhile: true, stepsAreGeneric: false, ...known }
}

export function conversionComparison({ amountCad, sourceId } = {}) {
  const amountMinor = toMinorUnits(amountCad)
  if (!amountMinor || amountMinor <= 0) return null
  if (amountMinor < GAMBIT_MINIMUM_CAD * 100) return null

  const profile = brokerProfile(sourceId)
  if (profile.gambitWorthwhile === false) return null

  const brokerCostMinor = Math.round((amountMinor * profile.spreadPct) / 100)
  // Two legs: a buy on the TSX and a sale in US dollars, plus the spread
  // crossed once. Modelling commissions explicitly rather than folding them
  // into a percentage is what makes the small-amount case fall out naturally.
  const gambitCostMinor = Math.round((amountMinor * BID_ASK_PCT) / 100) + profile.commissionMinor * 2

  const savingMinor = brokerCostMinor - gambitCostMinor
  if (savingMinor <= 0) return null

  return {
    profile,
    brokerCostMinor,
    gambitCostMinor,
    savingMinor,
    workings: {
      amountMinor,
      brokerSpreadPct: profile.spreadPct,
      bidAskPct: BID_ASK_PCT,
      commissionMinor: profile.commissionMinor,
      legs: 2,
    },
  }
}

/**
 * A CAD account holding US-listed securities has converted currency, and will
 * again. A Canadian-listed fund of US equities does not count: it trades in
 * CAD, so buying it converts nothing, and flagging it would send someone
 * through a conversion they never make.
 */
export function accountConversionExposure(account, { usdCadRate } = {}) {
  if (!account) return null
  const accountCurrency = String(account.currency ?? '').trim().toUpperCase()
  if (accountCurrency && accountCurrency !== 'CAD') return null

  const holdings = (account.positions || []).filter((row) => classifyHolding(row).listing === LISTING.US)
  if (!holdings.length) return null

  // Market values are stored in the row's own currency, not normalised — see
  // inferRowCurrency in livePrices.js, where assuming otherwise once reported a
  // 37% profit on a position bought at a loss. A USD row therefore has to be
  // converted before it can be added to a CAD one.
  const rate = Number(usdCadRate)
  let amountMinor = 0

  for (const row of holdings) {
    const value = toMinorUnits(row['MARKET VALUE']) || 0
    if (value <= 0) continue
    const rowCurrency = String(row['ACCOUNT CURRENCY'] ?? '').trim().toUpperCase()

    if (rowCurrency === 'USD') {
      // Without a rate this cannot be sized honestly. Reporting the USD figure
      // as though it were Canadian dollars would understate the conversion by
      // roughly a third — and the whole point of this feature is a dollar
      // amount someone can check.
      if (!Number.isFinite(rate) || rate <= 0) return null
      amountMinor += Math.round(value * rate)
    } else {
      amountMinor += value
    }
  }

  if (amountMinor <= 0) return null

  return { amountCad: amountMinor / 100, amountMinor, holdings, usdCadRate: Number.isFinite(rate) ? rate : null }
}

function dollars(minor) {
  return `$${(Math.abs(minor) / 100).toFixed(2)}`
}

export function describeConversion(comparison, { includeSteps = false } = {}) {
  if (!comparison) return ''

  const { profile, brokerCostMinor, gambitCostMinor, savingMinor } = comparison

  const headline = `Converting this amount through ${profile.name} costs about ${dollars(brokerCostMinor)} in spread. `
    + `Buying DLR on the TSX, journalling it to DLR.U and selling in US dollars costs about ${dollars(gambitCostMinor)} — `
    + `a difference of about ${dollars(savingMinor)}. `
    // The saving is on the spread. The rate itself moves while the position is
    // journalled, and a figure presented as certain is the one people remember
    // when it lands differently.
    + 'The saving is on the conversion spread, not the exchange rate — that can move between the two trades.'

  if (!includeSteps) return headline

  const steps = profile.stepsAreGeneric
    ? `${profile.journalling} ${profile.settlement}`
    : `${profile.journalling}${profile.settlement ? ` ${profile.settlement}` : ''}`

  return `${headline} ${steps}`
}
