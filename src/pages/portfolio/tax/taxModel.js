import { classifyHolding, projectWithholding, TREATMENT } from '../../../utils/withholdingTax'
import { toMinorUnits } from '../../../utils/money'

export const ACCOUNT_TYPES = ['TFSA', 'RRSP', 'RRIF', 'LIRA', 'FHSA', 'RESP', 'RDSP', 'NON_REGISTERED']
export const accountTypeLabel = (type) => type === 'NON_REGISTERED' ? 'Non-registered' : type || 'Not set'
export const taxAccountType = (account, settings = {}) => {
  const configured = settings.accountTypes?.[account.accountNumber]
  if (ACCOUNT_TYPES.includes(configured)) return configured
  const types = [...new Set((account.positions || []).map((row) => String(row['ACCOUNT TYPE'] || '').trim().toUpperCase()).filter(Boolean))]
  return types.length === 1 && ACCOUNT_TYPES.includes(types[0]) ? types[0] : null
}
export const localTaxDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
export const money = (minor, currency = 'CAD') => minor == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(minor / 100)
export function taxProjectionRow(row) {
  const symbol = String(row.SYMBOL || '').toUpperCase()
  const isCdr = row.__isCdr || /\bCDR\b/i.test(row.DESCRIPTION || '')
  const listedCurrency = String(row.CURRENCY || '').toUpperCase()
  const knownCanadian = /\.(TO|V|NE|CN|TSX)$/.test(symbol) || isCdr
  // A CAD valuation alone does not prove a Canadian listing.
  if (!knownCanadian && !['USD', 'CAD'].includes(listedCurrency) && row['ACCOUNT CURRENCY'] !== 'USD') return null
  return { ...row, 'ACCOUNT CURRENCY': knownCanadian ? 'CAD' : listedCurrency || row['ACCOUNT CURRENCY'],
    DESCRIPTION: isCdr ? `${row.DESCRIPTION || ''} CDR` : row.DESCRIPTION }
}
export const validNumber = (value) => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null

// Keep currencies separate and never infer an account's registration from its
// balance, account number or source filename. Fund-level tax needs underlying
// distributions and is left unpriced, rather than assuming a 100% US allocation.
export function taxOverview(accounts, settings = {}, currency = 'CAD') {
  const yieldPct = Math.min(100, validNumber(settings.yieldPct) ?? 1.3)
  const rows = accounts.map((account) => {
    const type = taxAccountType(account, settings)
    const holdings = [], gaps = []
    let annualMinor = 0, creditMinor = 0, exemptValueMinor = 0, coveredValueMinor = 0
    for (const row of account.positions || []) {
      const rowCurrency = String(row['ACCOUNT CURRENCY'] || account.currency || '').toUpperCase()
      if (rowCurrency !== currency) continue
      const value = toMinorUnits(row['MARKET VALUE'])
      if (value == null || value <= 0) continue
      const projectionRow = taxProjectionRow(row)
      if (!projectionRow) { gaps.push({ row, reason: 'Listing currency needed' }); continue }
      const classification = classifyHolding(projectionRow)
      if (!type) { gaps.push({ row, reason: 'Account type needed' }); continue }
      if ([TREATMENT.UNKNOWN, TREATMENT.IN_FUND].includes(classification.treatment)) { gaps.push({ row, reason: classification.treatment === TREATMENT.IN_FUND ? 'Fund-level distributions needed' : 'Security classification needed' }); continue }
      if (classification.treatment === TREATMENT.NONE) continue
      const projection = projectWithholding({ row: projectionRow, accountType: type, assumptions: { yieldPct } })
      if (!projection) continue
      holdings.push({ row, projection })
      annualMinor += projection.annualWithheldMinor
      if (projection.recoverable) creditMinor += projection.annualWithheldMinor
      if (projection.exempt) exemptValueMinor += value
      coveredValueMinor += value
    }
    return { account, type, holdings, gaps, annualMinor, creditMinor, exemptValueMinor, coveredValueMinor }
  })
  return { rows, currency, yieldPct, annualMinor: rows.reduce((sum, row) => sum + row.annualMinor, 0),
    creditMinor: rows.reduce((sum, row) => sum + row.creditMinor, 0), coveredValueMinor: rows.reduce((sum, row) => sum + row.coveredValueMinor, 0),
    covered: rows.reduce((sum, row) => sum + row.holdings.length, 0), gaps: rows.flatMap((row) => row.gaps) }
}

export function recordedFees(transactions, year) {
  const totals = new Map(), seen = new Set()
  let missing = 0
  for (const transaction of transactions) {
    if (transaction.id && seen.has(transaction.id)) continue
    if (transaction.id) seen.add(transaction.id)
    if (!transaction.tradeDate?.startsWith(`${year}-`)) continue
    const currency = transaction.currency
    const commission = transaction.action !== 'FEE' ? transaction.feesMinor : 0
    const accountFee = transaction.action === 'FEE' ? Math.abs(transaction.amountMinor ?? NaN) : 0
    if (!/^[A-Z]{3}$/.test(currency || '') || !Number.isFinite(commission) || !Number.isFinite(accountFee)) { missing++; continue }
    if (!totals.has(currency)) totals.set(currency, { currency, commissionsMinor: 0, accountFeesMinor: 0, count: 0 })
    const total = totals.get(currency)
    total.commissionsMinor += Math.abs(commission)
    total.accountFeesMinor += accountFee
    if (commission || accountFee) total.count++
  }
  return { totals: [...totals.values()], missing }
}

export function contributionRoom(record, today = localTaxDate(), plannedAmount = '') {
  if (!record || !/^\d{4}-\d{2}-\d{2}$/.test(record.asOf || '') || !Number.isFinite(Date.parse(record.asOf)) || new Date(record.asOf).toISOString().slice(0, 10) !== record.asOf || record.asOf > today) return { status: 'unknown' }
  if (record.asOf.slice(0, 4) !== today.slice(0, 4)) return { status: 'stale', asOf: record.asOf }
  const baseMinor = toMinorUnits(record.room), contributedMinor = toMinorUnits(record.contributed)
  if (baseMinor == null || contributedMinor == null || contributedMinor < 0) return { status: 'unknown' }
  const remainingMinor = baseMinor - contributedMinor
  const plannedMinor = toMinorUnits(plannedAmount)
  return { status: 'current', asOf: record.asOf, remainingMinor, contributedMinor, baseMinor,
    plannedMinor, afterMinor: plannedMinor != null && plannedMinor >= 0 ? remainingMinor - plannedMinor : null }
}

// Price-only scenario for an actual SELL record. The caller supplies the
// comparison price explicitly; holdings disappearing never create sale records.
export function saleScenario(sale, comparisonPrice) {
  const price = validNumber(comparisonPrice)
  const quantity = Math.abs(sale?.quantity)
  if (sale?.action !== 'SELL' || !(quantity > 0) || price == null || !sale.currency || !Number.isFinite(sale.priceMinor) || sale.priceMinor < 0) return null
  const grossProceedsMinor = Math.round(quantity * sale.priceMinor)
  const heldValueMinor = Math.round(quantity * price * 100)
  return { quantity, grossProceedsMinor, heldValueMinor, differenceMinor: heldValueMinor - grossProceedsMinor, currency: sale.currency }
}
