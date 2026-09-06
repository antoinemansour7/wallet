import { accountSources, plaidItemIdFor, sourceLabel } from '../../utils/accountMerge'
import { analyticsScopes } from './chartAnalytics'
import { projectWithholding, measureAccountWithholding, classifyHolding, TREATMENT, DEFAULT_ASSUMPTIONS } from '../../utils/withholdingTax'
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

export function accountWithholding(account, { accounts = [], transactions = [], reference = {}, historyStarts = {}, currency, requireReference = false, assumptions = {}, now = Date.now() } = {}) {
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
      securityReference: ref,
      assumptions,
      ...(Number.isFinite(ref?.yieldPct) ? { assumptions: { yieldPct: ref.yieldPct } } : {}),
      ...(typeof ref?.holdsForeignEquities === 'boolean' ? { fundExposureHint: { holdsForeignEquities: ref.holdsForeignEquities } } : {}),
    }
  }

  const rows = (account?.positions ?? []).filter((row) => !currency || (row['ACCOUNT CURRENCY'] || account.currency) === currency)
  const gaps = [], projections = []
  for (const row of rows) {
    const ref = refFor(row)
    if (requireReference && !ref?.exchange) { gaps.push({ row, reason: 'Listing reference unavailable' }); continue }
    const options = optionsFor(row)
    const classification = classifyHolding(row, options)
    if (classification.treatment === TREATMENT.UNKNOWN) { gaps.push({ row, reason: ref?.isFund ? 'Fund composition unavailable' : 'Listing could not be classified' }); continue }
    const projection = projectWithholding({ row, accountType, ...options })
    if (projection) projections.push({ row, projection })
  }
  if (!projections.length && !gaps.length) return null

  const yieldIsReal = projections.every(({ row }) => Number.isFinite(refFor(row)?.yieldPct))

  const projectedMinor = projections.reduce((sum, { projection }) => sum + projection.annualWithheldMinor, 0)
  const contributors = projections
    .filter(({ projection }) => projection.annualWithheldMinor > 0)
    .map(({ row }) => String(row.SYMBOL ?? '').toUpperCase())

  // In-fund tax is taken before any distribution reaches the account, so no
  // record of it can exist here and the projection is the only statement of it.
  const anyInFund = projections.some(({ projection }) => projection.treatment === TREATMENT.IN_FUND)
  // Join ledger IDs, not the human account label. A combined account can
  // include several feeds; sum only complete, same-currency measured records.
  const feedIds = [...new Set(rows.map((row) => row.__plaidAccountId).filter(Boolean))]
  const ids = feedIds.length ? feedIds : [account.accountNumber]
  const completeHistory = !requireReference || ids.every((id) => historyStarts[id])
  const measuredParts = anyInFund || !completeHistory ? [] : ids.map((accountId) => measureAccountWithholding({
    transactions: transactions.filter((t) => !currency || t.currency === currency), accountId, now,
    historyStartsAt: historyStarts[accountId] ?? null,
  })).filter(Boolean)
  const measured = measuredParts.length && measuredParts.length === ids.length ? {
    annualWithheldMinor: measuredParts.reduce((sum, part) => sum + part.annualWithheldMinor, 0),
    workings: { recordCount: measuredParts.reduce((sum, part) => sum + part.workings.recordCount, 0),
      from: measuredParts[0].workings.from, to: measuredParts[0].workings.to, currencies: [...new Set(measuredParts.flatMap((p) => p.workings.currencies))] },
  } : null

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
    accountType, projections, gaps,
    annualWithheldMinor: total,
    basis,
    unavoidable: anyInFund,
    recoverable: projections.length > 0 && projections.every(({ projection }) => projection.recoverable),
    contributors,
    yieldIsReal,
    provenance: { source: measured ? 'transaction-ledger' : 'security-reference', accountIds: ids, references: projections.map(({ row, projection }) => ({ symbol: row.SYMBOL, ...projection.provenance })) },
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
