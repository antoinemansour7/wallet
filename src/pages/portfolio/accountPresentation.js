import { accountSources, plaidItemIdFor, sourceLabel } from '../../utils/accountMerge'
import { analyticsScopes } from './chartAnalytics'
import { projectWithholding, measureAccountWithholding, TREATMENT, DEFAULT_ASSUMPTIONS } from '../../utils/withholdingTax'
import { toMinorUnits } from '../../utils/money'

export function accountTitle(account) {
  const type = account.positions?.find((row) => row['ACCOUNT TYPE'])?.['ACCOUNT TYPE']
  if (type) return String(type)
  if (/\s|^(TFSA|RRSP|FHSA|RESP)$/i.test(account.accountNumber)) return account.accountNumber
  return account.positions?.length ? 'Investment account' : 'Cash account'
}

export function accountCurrency(account) {
  return account.currency || account.positions?.[0]?.['ACCOUNT CURRENCY'] || ''
}

export function currencyTotals(accounts) {
  return analyticsScopes(accounts).map((scope) => ({ currency: scope.currency, value: scope.accounts.reduce((sum, account) => sum + account.value, 0) }))
}

export function brokerageConnections(accounts) {
  const connections = new Map()
  for (const account of accounts) {
    for (const source of accountSources(account).filter((feed) => feed.id.startsWith('plaid:'))) {
      const key = plaidItemIdFor(account, source.id) || source.id
      if (!connections.has(key)) connections.set(key, { key, label: sourceLabel(source.id), accounts: [] })
      connections.get(key).accounts.push(account)
    }
  }
  return [...connections.values()]
}

// ─── Foreign withholding (#17, #83) ────────────────────────────────────────────

/**
 * The withholding drag for a whole account, at the grain a person recognises.
 *
 * Per account rather than per holding row, because a figure on every row is
 * noise — most rows have nothing to say — and because the measured figure
 * arrives account-level anyway. Only the holdings that actually contribute are
 * named.
 *
 * Returns null when there is nothing to say. No "all optimal" banner: an
 * account with no US-listed holdings should render nothing at all.
 */
export function accountTypeOf(account) {
  return account?.positions?.find((row) => row['ACCOUNT TYPE'])?.['ACCOUNT TYPE'] ?? null
}

export function accountWithholding(account, { accounts = [], transactions = [], reference = {}, historyStarts = {}, now = Date.now() } = {}) {
  const accountType = accountTypeOf(account)
  if (!accountType) return null

  // Real yield and real fund composition where the lookup resolved them, the
  // hardcoded fallbacks where it did not. `yieldIsReal` travels with the
  // figure so a screen can say which of the two it is showing — a projection
  // on a measured yield is a different claim from one on an assumed 1.3%.
  const refFor = (row) => reference[String(row?.SYMBOL ?? '').trim().toUpperCase()] ?? null
  const optionsFor = (row) => {
    const ref = refFor(row)
    return {
      ...(Number.isFinite(ref?.yieldPct) ? { assumptions: { yieldPct: ref.yieldPct } } : {}),
      ...(typeof ref?.holdsForeignEquities === 'boolean' ? { fundExposureHint: { holdsForeignEquities: ref.holdsForeignEquities } } : {}),
    }
  }

  const rows = account?.positions ?? []
  const projections = rows
    .map((row) => ({ row, projection: projectWithholding({ row, accountType, ...optionsFor(row) }) }))
    .filter((entry) => entry.projection)
  if (projections.length === 0) return null

  const yieldIsReal = projections.every(({ row }) => Number.isFinite(refFor(row)?.yieldPct))

  const projectedMinor = projections.reduce((sum, { projection }) => sum + projection.annualWithheldMinor, 0)
  const contributors = projections
    .filter(({ projection }) => projection.annualWithheldMinor > 0)
    .map(({ row }) => String(row.SYMBOL ?? '').toUpperCase())

  // In-fund tax is taken before any distribution reaches the account, so no
  // record of it can exist here and the projection is the only statement of it.
  const anyInFund = projections.some(({ projection }) => projection.treatment === TREATMENT.IN_FUND)
  const measured = anyInFund
    ? null
    : measureAccountWithholding({
      transactions,
      accountId: account?.accountNumber,
      now,
      historyStartsAt: historyStarts[account?.accountNumber] ?? null,
    })

  const total = measured?.annualWithheldMinor ?? projectedMinor
  const basis = measured ? 'measured' : 'projected'

  // Only the account types the user actually holds. Offering an RRSP column to
  // someone without an RRSP is a recommendation to open one.
  const availableTypes = [...new Set(accounts.map(accountTypeOf).filter(Boolean))]
    .filter((type) => type !== accountType)
  const options = availableTypes
    .map((type) => ({
      accountType: type,
      annualWithheldMinor: projections.reduce(
        (sum, { row }) => sum + (projectWithholding({ row, accountType: type, ...optionsFor(row) })?.annualWithheldMinor ?? 0),
        0,
      ),
    }))
    .filter((option) => option.annualWithheldMinor !== projectedMinor)

  const marketValueMinor = projections.reduce((sum, { projection }) => sum + projection.workings.marketValueMinor, 0)

  return {
    accountType,
    annualWithheldMinor: total,
    basis,
    unavoidable: anyInFund,
    recoverable: projections.every(({ projection }) => projection.recoverable),
    contributors,
    yieldIsReal,
    comparison: options.length > 0 ? options : null,
    workings: measured
      ? measured.workings
      : {
        marketValueMinor,
        // The blended rate actually used, which is the assumed one only when
        // no holding resolved a real yield.
        yieldPct: yieldIsReal
          ? Number(((projections.reduce((sum, { row }) => sum + (refFor(row)?.yieldPct ?? 0) * (toMinorUnits(row['MARKET VALUE']) ?? 0), 0) / (marketValueMinor || 1))).toFixed(3))
          : DEFAULT_ASSUMPTIONS.yieldPct,
        withholdingRatePct: 15,
      },
  }
}

/**
 * One number for the whole portfolio, for the quiet Overview line. Null when
 * no account has anything to report.
 */
export function portfolioWithholding(accounts = [], options = {}) {
  const perAccount = accounts
    .map((account) => accountWithholding(account, { ...options, accounts }))
    .filter(Boolean)
  if (perAccount.length === 0) return null

  const annualWithheldMinor = perAccount.reduce((sum, entry) => sum + entry.annualWithheldMinor, 0)
  if (annualWithheldMinor <= 0) return null

  return {
    annualWithheldMinor,
    // Mixed bases across accounts are reported as projected: the weaker of the
    // two is the honest label for a total that contains one.
    basis: perAccount.every((entry) => entry.basis === 'measured') ? 'measured' : 'projected',
    accountCount: perAccount.filter((entry) => entry.annualWithheldMinor > 0).length,
  }
}
