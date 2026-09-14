// Presentation adapters only. Tax arithmetic lives in the shared rule engines.
import { accountTypeOf, accountWithholding } from '../accountPresentation'
import { poolCostBase } from '../../../utils/costBase'
import { saleCounterfactuals, summarizeCounterfactuals } from '../../../utils/saleCounterfactual'
import { roomStatus, checkContribution } from '../../../utils/contributionRoom'
import { toMinorUnits } from '../../../utils/money'

export const ACCOUNT_TYPES = ['TFSA', 'FHSA', 'RRSP', 'RRSP_SPOUSAL', 'RRIF', 'LIRA', 'LIF', 'LRIF', 'RESP', 'RDSP', 'NON_REGISTERED', 'UNKNOWN']
export const accountTypeLabel = (type) => ({ NON_REGISTERED: 'Non-registered', RRSP_SPOUSAL: 'Spousal RRSP', UNKNOWN: 'Unknown' })[type] || type || 'Not set'
export const taxAccountType = (account, settings = {}) => {
  const imported = String(accountTypeOf(account) || '').trim().toUpperCase().replace(/[ -]/g, '_')
  const manual = settings.accountTypes?.[account.accountNumber]
  const type = ACCOUNT_TYPES.includes(manual) ? manual : ACCOUNT_TYPES.includes(imported) ? imported : null
  // Unknown is an explicit override of an imported guess, but supplies no tax classification.
  return type === 'UNKNOWN' ? null : type
}
export const localTaxDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
export const money = (minor, currency = 'CAD') => minor == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(minor / 100)
export const validNumber = (value) => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null
export const typedAccounts = (accounts, settings) => accounts.map((account) => ({ ...account, positions: (account.positions || []).map((row) => ({ ...row, 'ACCOUNT TYPE': taxAccountType(account, settings) })) }))

export function taxOverview(accounts, settings = {}, currency = 'CAD', data = {}) {
  const typed = typedAccounts(accounts, settings)
  const rows = typed.map((account) => {
    const type = taxAccountType(account, settings)
    const result = type ? accountWithholding(account, { ...data, currency, accounts: typed, requireReference: true, assumptions: { yieldPct: settings.yieldPct ?? 1.3 } }) : null
    const holdings = result?.projections || []
    return { account, type, result, holdings,
      gaps: type ? result?.gaps || [] : (account.positions || []).filter((r) => (r['ACCOUNT CURRENCY'] || account.currency) === currency).map((row) => ({ row, reason: 'Account type needed' })),
      annualMinor: result?.annualWithheldMinor ?? 0,
      creditMinor: result?.recoverable ? result.annualWithheldMinor : holdings.filter((h) => h.projection.recoverable).reduce((sum, h) => sum + h.projection.annualWithheldMinor, 0),
      coveredValueMinor: holdings.reduce((sum, h) => sum + h.projection.workings.marketValueMinor, 0),
    }
  })
  const withFigures = rows.filter((row) => row.result && (row.holdings.length || row.result.basis === 'measured'))
  return { rows, currency, annualMinor: rows.reduce((sum, r) => sum + r.annualMinor, 0), creditMinor: rows.reduce((sum, r) => sum + r.creditMinor, 0),
    coveredValueMinor: rows.reduce((sum, r) => sum + r.coveredValueMinor, 0), covered: rows.reduce((sum, r) => sum + r.holdings.length, 0), gaps: rows.flatMap((r) => r.gaps),
    basis: withFigures.length && withFigures.every((r) => r.result.basis === 'measured') ? 'measured' : 'projected',
    assumedYield: rows.some((r) => r.result && !r.result.yieldIsReal),
  }
}

export function contributionInputs(type, record, accounts, transactions, settings = {}) {
  // Room belongs to the registration, across accounts. Adapt the IDs once so
  // the shared engine can count those ledger deposits as one registration.
  const accountTypes = new Map(accounts.flatMap((account) => [account.accountNumber, ...(account.positions || []).map((row) => row.__plaidAccountId).filter(Boolean)]
    .map((id) => [id, taxAccountType(account, settings)])))
  const accountId = `registration:${type}`
  const relevant = transactions.filter((t) => t.tradeDate <= localTaxDate() && (accountTypes.has(t.accountId) ? accountTypes.get(t.accountId) === type : t.accountType === type))
  let missingFx = false
  const unreviewedTransfers = relevant.filter((t) => t.source === 'plaid' && t.action === 'TRANSFER' && t.tradeDate >= (record?.asOf || '') && t.cashDirection !== 'out' && !['deposit', 'contribution'].includes(t.providerSubtype))
  const converted = relevant.map((t) => {
    if (!['TRANSFER', 'CONTRIBUTION'].includes(t.action) || Number(t.quantity ?? 0) < 0 || t.tradeDate < record?.asOf) return { ...t, accountId }
    if (!['CAD', 'USD'].includes(t.currency) || (t.currency === 'USD' && !(Number(t.fxRate) > 0))) { missingFx = true; return t }
    return { ...t, accountId, amountMinor: t.currency === 'USD' ? Math.round(t.amountMinor * t.fxRate) : t.amountMinor }
  })
  const needsMigration = !!record && !Number.isFinite(record.limitMinor)
  const validDate = record?.asOf && Number.isFinite(Date.parse(record.asOf)) && new Date(record.asOf).toISOString().slice(0, 10) === record.asOf && record.asOf <= localTaxDate()
  const room = record && !needsMigration && validDate && !missingFx && !unreviewedTransfers.length ? { ...record, accountId, accountType: type } : null
  return { room, transactions: converted, needsMigration, missingFx, unreviewedTransfers }
}
export function contributionView(type, record, accounts, transactions, settings, planned) {
  const input = contributionInputs(type, record, accounts, transactions, settings)
  return { ...input, result: roomStatus(input), check: checkContribution({ ...input, amountMinor: toMinorUnits(planned) }) }
}

export function saleReview(transactions, historyStarts, quotes, usdCadRate) {
  const pools = poolCostBase(transactions, { historyStartsAt: historyStarts })
  // The shared engine converts USD quotes to CAD. Other currencies and stale
  // quotes are not inputs to that conversion; incomplete pools stay excluded.
  const usableQuotes = Object.fromEntries(Object.entries(quotes || {}).filter(([, q]) => ['USD', 'CAD'].includes(q.currency) && q.cacheStatus !== 'stale'))
  const comparisons = saleCounterfactuals({ disposals: pools.disposals, quotes: usableQuotes, usdCadRate }).map((comparison) => {
    const disposal = pools.disposals.find((d) => d.transactionId === comparison.transactionId)
    const pool = pools.bySecurity.find((p) => p.securityKey === disposal.securityKey)
    return { ...comparison, provenance: pool.provenance, securityKeyBasis: pool.securityKeyBasis, quote: usableQuotes[comparison.symbol] }
  })
  return { pools, comparisons, summary: summarizeCounterfactuals(comparisons), unpriced: pools.disposals.length - comparisons.length }
}
