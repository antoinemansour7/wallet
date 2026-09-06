/**
 * Importing investment transactions from Plaid.
 *
 * `/investments/transactions/get` returns up to 24 months of buys, sells and
 * dividends, cross-referenced to securities, paginated with `count`/`offset`
 * against `total_investment_transactions` and refreshed daily after market
 * close.
 *
 * The fetch, the transform and the write are three separate functions on
 * purpose. The transform is where every rule lives — which security a
 * transaction belongs to, whether it can be classified at all, what the
 * account type is — and it is worth testing without a Plaid client or a
 * Firestore instance in the way.
 *
 * Idempotence is inherited rather than implemented: `normalizeTransaction`
 * derives each document id from Plaid's own `investment_transaction_id`, so
 * re-importing an overlapping window rewrites the same documents with the same
 * content. There is deliberately no "have I seen this before" bookkeeping here
 * — adding some would be a second, weaker source of truth about the same
 * question.
 */

import { normalizeTransaction } from '../utils/transactionLedger.js'

/** Plaid caps a page at 500. */
export const PAGE_SIZE = 500

/** Plaid serves at most 24 months of investment transactions. */
export const MAX_HISTORY_MONTHS = 24

/** Firestore refuses a batch larger than this. */
const BATCH_LIMIT = 500

const isoDate = (date) => date.toISOString().slice(0, 10)

export function defaultWindow(now = new Date()) {
  const end = new Date(now)
  const start = new Date(now)
  start.setMonth(start.getMonth() - MAX_HISTORY_MONTHS)
  return { startDate: isoDate(start), endDate: isoDate(end) }
}

/**
 * How far back a scheduled re-sync reaches.
 *
 * Not simply "since the last sync": a trade can appear in Plaid days after it
 * happened, and a window starting exactly where the last one ended would step
 * straight over it. The overlap re-fetches a few days that were already
 * imported, which is free — ids are derived from the transaction, so writing
 * one twice is the same write.
 *
 * Falls back to the full window when there is no recorded sync, so a
 * connection that has never run gets its whole available history.
 */
export const RESYNC_OVERLAP_DAYS = 5

export function incrementalWindow(lastSyncedAt, now = new Date(), { overlapDays = RESYNC_OVERLAP_DAYS } = {}) {
  const full = defaultWindow(now)
  const last = lastSyncedAt ? new Date(lastSyncedAt) : null
  if (!last || Number.isNaN(last.getTime())) return full

  const start = new Date(last)
  start.setDate(start.getDate() - overlapDays)
  const startDate = isoDate(start)

  // Never reach further back than the provider actually serves, and never
  // forward past the full window's start on a first run.
  return { startDate: startDate < full.startDate ? full.startDate : startDate, endDate: full.endDate }
}

/**
 * Walks every page rather than stopping at the first.
 *
 * `total_investment_transactions` is the count for the whole window, not the
 * page, so it is the loop's bound. Guarding on a page coming back empty as
 * well means a total that disagrees with reality ends the loop instead of
 * spinning against it.
 */
export async function fetchAllInvestmentTransactions({ client, accessToken, startDate, endDate, pageSize = PAGE_SIZE }) {
  const transactions = []
  const securities = new Map()
  const accounts = new Map()

  let offset = 0
  let total = Infinity
  let pages = 0

  while (offset < total) {
    const response = await client.investmentsTransactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: { count: pageSize, offset },
    })

    const data = response?.data || {}
    const page = data.investment_transactions || []

    for (const security of data.securities || []) securities.set(security.security_id, security)
    for (const account of data.accounts || []) accounts.set(account.account_id, account)

    transactions.push(...page)
    pages += 1

    total = Number.isFinite(data.total_investment_transactions) ? data.total_investment_transactions : transactions.length
    if (page.length === 0) break
    offset += page.length
  }

  return { transactions, securities, accounts, pages }
}

/**
 * Plaid's security object into the shape `resolveSecurityKey` expects.
 *
 * ISIN and CUSIP are the reason this import produces a better pooling key than
 * a statement ever can: `security_id` is internal to one Plaid item, so the
 * same ETF at two brokerages arrives with two different ids, and only a real
 * identifier joins them.
 */
export function securityContext(security) {
  if (!security) return null
  return {
    isin: security.isin || '',
    cusip: security.cusip || '',
    symbol: security.ticker_symbol || '',
    exchange: security.market_identifier_code || '',
    currency: security.iso_currency_code || security.unofficial_currency_code || '',
  }
}

/**
 * Plaid transactions into ledger records.
 *
 * Registered accounts are imported too. They are excluded from cost-base
 * pooling — there is no capital gain in a TFSA — but the superficial-loss
 * window has to see them, because buying back in an RRSP denies a loss taken
 * in a cash account.
 */
export function buildLedgerRecords({ transactions, securities, accounts, enabledAccountIds, accountTypeFor, fxFor }) {
  const isEnabled = (accountId) => !enabledAccountIds || enabledAccountIds.includes(accountId)

  const records = []
  const skipped = []
  // Counted rather than dropped in silence. A run reporting "54 fetched, 6
  // written, 6 skipped" leaves 42 unaccounted for and reads like data loss,
  // when in fact those rows belong to Plaid accounts that were never enabled
  // here. Naming the reason is the difference between a reconcilable number
  // and an alarming one.
  let notEnabled = 0

  for (const raw of transactions || []) {
    if (!isEnabled(raw.account_id)) { notEnabled += 1; continue }

    const security = securityContext(securities?.get?.(raw.security_id) ?? securities?.[raw.security_id])
    const account = accounts?.get?.(raw.account_id) ?? accounts?.[raw.account_id]

    const record = normalizeTransaction(raw, {
      source: 'plaid',
      security,
      accountId: raw.account_id,
      accountType: account && accountTypeFor ? accountTypeFor(account) : null,
      fx: fxFor ? fxFor(raw) : null,
    })

    // Dropped rather than guessed: no identifiable security, no usable trade
    // date, or an action that cannot be classified. Each is recorded so an
    // import reports what it could not take instead of quietly taking less.
    if (!record) {
      skipped.push({ id: raw.investment_transaction_id, reason: 'unclassifiable' })
      continue
    }

    records.push(record)
  }

  return { records, skipped, notEnabled }
}

/**
 * The earliest date each account has history for.
 *
 * Anything a user held before this has no cost base the ledger can derive, and
 * figures that depend on one resolve to `incomplete` rather than to a number.
 * Derived from the requested window rather than from the earliest transaction
 * seen: an account whose first trade was six months ago still has no history
 * before the window, and dating it from that trade would claim more coverage
 * than the import actually has.
 */
export function historyStartsAtFor({ accountIds, startDate }) {
  const map = {}
  for (const accountId of accountIds || []) map[accountId] = startDate
  return map
}

/** Firestore caps a batch at 500 writes, and an import routinely exceeds it. */
function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function writeLedgerRecords({ db, uid, records, historyStartsAt = {} }) {
  if (!uid) throw new Error('writeLedgerRecords requires a uid')

  const userDoc = db.collection('users').doc(uid)
  const transactions = userDoc.collection('transactions')

  let written = 0
  for (const group of chunk(records || [], BATCH_LIMIT)) {
    const batch = db.batch()
    for (const record of group) batch.set(transactions.doc(record.id), record)
    await batch.commit()
    written += group.length
  }

  const accountIds = Object.keys(historyStartsAt)
  for (const group of chunk(accountIds, BATCH_LIMIT)) {
    const batch = db.batch()
    for (const accountId of group) {
      batch.set(
        userDoc.collection('accounts').doc(accountId),
        { historyStartsAt: historyStartsAt[accountId] },
        { merge: true },
      )
    }
    await batch.commit()
  }

  return { written }
}

/**
 * Turns a batch resolver (`dates => Map<date, {rate, source, asOf} | null>`)
 * into the synchronous per-transaction `fxFor` that `buildLedgerRecords`
 * expects.
 *
 * The resolution has to happen before `buildLedgerRecords` runs, and as one
 * batched call over every date in the import — one call, not one per
 * transaction, is the entire reason `getRatesForDates` exists. Exported so
 * the batching itself is independently testable.
 */
export async function resolveFxForTransactions(transactions, resolveFxRates) {
  const dates = [...new Set((transactions || []).map((t) => t.date).filter(Boolean))]
  const rates = dates.length ? await resolveFxRates(dates) : new Map()
  return (raw) => rates.get(raw?.date) ?? null
}

/**
 * The whole import for one Plaid item.
 *
 * A failure part-way leaves whatever was written in place, which is safe
 * precisely because the ids are derived: re-running writes the same documents
 * again rather than duplicating them.
 *
 * `resolveFxRates` is optional and separate from `fxFor`: passing `fxFor`
 * directly (as the tests do) skips FX resolution entirely and is how a
 * caller states "I already know the rates" or "I don't need them yet".
 * `resolveFxRates` is for the real path — a batch resolver like
 * `(dates) => getRatesForDates(dates, { cache: historicalFxCache() })` — and
 * only runs when `fxFor` was not already supplied.
 */
export async function syncInvestmentTransactions({
  client, accessToken, db, uid, enabledAccountIds, accountTypeFor, fxFor, resolveFxRates, now, since = null,
}) {
  const { startDate, endDate } = since ? incrementalWindow(since, now) : defaultWindow(now)

  const { transactions, securities, accounts, pages } = await fetchAllInvestmentTransactions({
    client, accessToken, startDate, endDate,
  })

  const resolvedFxFor = fxFor || (resolveFxRates ? await resolveFxForTransactions(transactions, resolveFxRates) : undefined)

  const { records, skipped, notEnabled } = buildLedgerRecords({
    transactions, securities, accounts, enabledAccountIds, accountTypeFor, fxFor: resolvedFxFor,
  })

  const accountIds = [...accounts.keys()].filter((id) => !enabledAccountIds || enabledAccountIds.includes(id))
  // `historyStartsAt` is the date before which no transactions exist, and it is
  // what makes a cost base resolve to "incomplete" rather than to a wrong
  // number. Only a full sync knows it. An incremental re-sync starts a few
  // days ago, so recording its start date would move that line *forward* —
  // claiming a two-year history began last week, which turns a complete cost
  // base into an incomplete one and a full year of withholding into a partial
  // one. A re-sync therefore leaves the recorded start alone.
  const historyStartsAt = since ? {} : historyStartsAtFor({ accountIds, startDate })

  const { written } = await writeLedgerRecords({ db, uid, records, historyStartsAt })

  return {
    written,
    fetched: transactions.length,
    skipped: skipped.length,
    notEnabled,
    pages,
    startDate,
    endDate,
  }
}
