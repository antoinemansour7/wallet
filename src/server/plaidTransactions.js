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

import { normalizeTransaction, normalizationFailure } from '../utils/transactionLedger.js'

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
 * page, so it is the loop's bound. Inconsistent counts or overlapping pages
 * fail the import before any records or coverage claims are written.
 */
export async function fetchAllInvestmentTransactions({ client, accessToken, startDate, endDate, pageSize = PAGE_SIZE }) {
  const transactions = []
  const securities = new Map()
  const accounts = new Map()

  let offset = 0
  let total = Infinity
  let pages = 0
  const seen = new Set()

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

    const reportedTotal = data.total_investment_transactions
    if (!Number.isInteger(reportedTotal) || reportedTotal < 0 || (pages > 0 && reportedTotal !== total)) {
      throw new Error('Plaid transaction count changed or is missing; retry the complete sync')
    }
    for (const row of page) {
      if (!row.investment_transaction_id || seen.has(row.investment_transaction_id)) throw new Error('Plaid returned overlapping transaction pages; retry the complete sync')
      seen.add(row.investment_transaction_id)
    }
    if (transactions.length + page.length > reportedTotal || (!page.length && transactions.length < reportedTotal)) {
      throw new Error('Plaid returned incomplete transaction history; retry the complete sync')
    }
    transactions.push(...page)
    pages += 1

    total = reportedTotal
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
export function buildLedgerRecords({ transactions, securities, accounts, enabledAccountIds, accountTypeFor, fxFor, institution = null }) {
  const isEnabled = (accountId) => !enabledAccountIds || enabledAccountIds.includes(accountId)

  const records = []
  const skipped = []
  // Counted rather than dropped in silence. A run reporting "54 fetched, 6
  // written, 6 skipped" leaves 42 unaccounted for and reads like data loss,
  // when in fact those rows belong to Plaid accounts that were never enabled
  // here. Naming the reason is the difference between a reconcilable number
  // and an alarming one.
  let notEnabled = 0
  const notEnabledAccounts = {}

  for (const raw of transactions || []) {
    if (!isEnabled(raw.account_id)) {
      notEnabled += 1
      // Named, not merely counted. "75 held back" does not say which account to
      // re-enable; the id does, and it is the difference between a number to
      // read and a thing to fix.
      notEnabledAccounts[raw.account_id] = (notEnabledAccounts[raw.account_id] || 0) + 1
      continue
    }

    const security = securityContext(securities?.get?.(raw.security_id) ?? securities?.[raw.security_id])
    const account = accounts?.get?.(raw.account_id) ?? accounts?.[raw.account_id]

    const record = normalizeTransaction(raw, {
      source: 'plaid',
      security,
      accountId: raw.account_id,
      accountType: account && accountTypeFor ? accountTypeFor(account) : null,
      accountBalanceCurrency: account?.balances?.iso_currency_code ?? null,
      institution,
      fx: fxFor ? fxFor(raw) : null,
    })

    // Dropped rather than guessed: no identifiable security, no usable trade
    // date, or an action that cannot be classified. Each is recorded so an
    // import reports what it could not take instead of quietly taking less.
    if (!record) {
      const context = { security, accountId: raw.account_id }
      skipped.push({
        id: raw.investment_transaction_id,
        accountId: raw.account_id,
        reason: normalizationFailure(raw, context) ?? 'unclassifiable',
        // The wording the institution used, so an unmapped action can be
        // mapped rather than guessed at.
        subtype: raw.subtype ?? raw.type ?? null,
      })
      continue
    }

    records.push(record)
  }

  return { records, skipped, notEnabled, notEnabledAccounts }
}

/**
 * Claim each real account for a single Plaid item.
 *
 * Two items linked to the same brokerage login report the same real accounts
 * under different Plaid account ids (the mask is identical). Left alone, each
 * item syncs its own copy and every transaction is written once per item — the
 * duplication that put three trades into the ledger as six. An account is
 * identified by (institution, mask, subtype); the oldest connection wins (account id breaks ties), so
 * the choice is deterministic and a re-sync always keeps the same side.
 *
 * `items`: [{ itemId, institution, accounts: [{ id, mask, subtype }],
 * enabledAccountIds }]. Returns Map<itemId, enabledAccountIds[]> — the enabled
 * ids with cross-item duplicates removed.
 */
export function dedupeEnabledAccounts(items = []) {
  const identify = (institution, acct) => {
    if (acct.persistentAccountId) return `persistent:${institution}:${acct.persistentAccountId}`
    if (!institution || !acct.mask || !acct.subtype) return `account:${acct.id}`
    return [String(institution).trim().toLowerCase(), String(acct.mask).trim().toLowerCase(), String(acct.subtype).trim().toLowerCase()].join('|')
  }
  // Plaid explicitly allows non-unique masks. A collision within one item
  // cannot identify an account, so retain all accounts with that identity.
  const ambiguous = new Set()
  for (const item of items) {
    const seen = new Set()
    for (const acct of item.accounts || []) {
      const key = identify(item.institution, acct)
      if (seen.has(key)) ambiguous.add(key)
      seen.add(key)
    }
  }

  const enabledIds = (item) => new Set(item.enabledAccountIds || (item.accounts || []).map((a) => a.id))

  // Deterministic owner per real account across every item.
  const winner = new Map()
  for (const item of items) {
    const enabled = enabledIds(item)
    for (const acct of item.accounts || []) {
      if (!enabled.has(acct.id)) continue
      const key = identify(item.institution, acct)
      const current = winner.get(key)
      // Keep the established connection when a fresh Link returns smaller IDs.
      // Otherwise ownership flips and imports a new copy beside the old one.
      const order = `${item.connectedAt || '0000'}|${acct.id}`
      if (!current || order < current.order) winner.set(key, { id: acct.id, order })
    }
  }

  // Ids to drop: identified and enabled, but not the winner for their identity.
  const drop = new Set()
  for (const item of items) {
    const enabled = enabledIds(item)
    for (const acct of item.accounts || []) {
      if (!enabled.has(acct.id)) continue
      if (!ambiguous.has(identify(item.institution, acct)) && winner.get(identify(item.institution, acct))?.id !== acct.id) drop.add(acct.id)
    }
  }

  // Only rewrite an item that actually owns a dropped duplicate; everything
  // else keeps its original selection, so `null` ("all accounts") and untouched
  // items pass through unchanged.
  const result = new Map()
  for (const item of items) {
    const original = item.enabledAccountIds ?? null
    const enabled = [...enabledIds(item)]
    const droppedHere = enabled.some((id) => drop.has(id))
    result.set(item.itemId, droppedHere ? enabled.filter((id) => !drop.has(id)) : original)
  }
  return result
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

export async function writeLedgerRecords({ db, uid, records, historyStartsAt = {}, coverage = {}, connection = null }) {
  if (!uid) throw new Error('writeLedgerRecords requires a uid')

  const userDoc = db.collection('users').doc(uid)
  const transactions = userDoc.collection('transactions')

  // A disconnect/selection change must invalidate an already-running import.
  // Read and write in one transaction so a concurrent connection edit retries
  // this check before any ledger batch can land.
  const commit = async (write) => {
    if (!connection) { const batch = db.batch(); write(batch); await batch.commit(); return }
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userDoc.collection('plaid').doc(connection.itemId))
      if (!snap.exists || JSON.stringify(snap.data().enabledAccountIds ?? null) !== JSON.stringify(connection.selection ?? null)) {
        throw new Error('Connection changed during sync; retry with the current accounts')
      }
      write(tx)
    })
  }
  let written = 0
  for (const group of chunk(records || [], BATCH_LIMIT)) {
    await commit((batch) => {
      for (const record of group) batch.set(transactions.doc(record.id), record)
    })
    written += group.length
  }

  const accountIds = [...new Set([...Object.keys(historyStartsAt), ...Object.keys(coverage)])]
  for (const group of chunk(accountIds, BATCH_LIMIT)) {
    await commit((batch) => {
      for (const accountId of group) {
        batch.set(
          userDoc.collection('accounts').doc(accountId),
          { ...(historyStartsAt[accountId] ? { historyStartsAt: historyStartsAt[accountId] } : {}),
            ...(coverage[accountId] ? { latestImport: coverage[accountId],
              ...(!coverage[accountId].complete || historyStartsAt[accountId] ? { importComplete: coverage[accountId].complete } : {}) } : {}) },
          { merge: true },
        )
      }
    })
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
  client, accessToken, db, uid, enabledAccountIds, accountTypeFor, fxFor, resolveFxRates, now, since = null, institution = null, connection = null,
}) {
  if (Array.isArray(enabledAccountIds) && enabledAccountIds.length === 0) return { written: 0, fetched: 0, skipped: 0, notEnabled: 0, pages: 0 }
  const { startDate, endDate } = since ? incrementalWindow(since, now) : defaultWindow(now)

  const { transactions, securities, accounts, pages } = await fetchAllInvestmentTransactions({
    client, accessToken, startDate, endDate,
  })

  const resolvedFxFor = fxFor || (resolveFxRates ? await resolveFxForTransactions(transactions, resolveFxRates) : undefined)

  const { records, skipped, notEnabled, notEnabledAccounts } = buildLedgerRecords({
    transactions, securities, accounts, enabledAccountIds, accountTypeFor, fxFor: resolvedFxFor, institution,
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

  const coverage = Object.fromEntries(accountIds.map((accountId) => [accountId, {
    startDate, endDate, fetched: transactions.filter((t) => t.account_id === accountId).length,
    imported: records.filter((t) => t.accountId === accountId).length,
    skipped: skipped.filter((t) => t.accountId === accountId).length,
    complete: !skipped.some((t) => t.accountId === accountId),
    basis: 'provider-window', // Not proof of the account's opening date or opening cash.
  }]))
  const { written } = await writeLedgerRecords({ db, uid, records, historyStartsAt, coverage, connection })

  return {
    written,
    fetched: transactions.length,
    skipped: skipped.length,
    // Counted by reason: three dropped rows that are all one unmapped action
    // is a different problem from three unrelated gaps.
    skippedReasons: skipped.reduce((tally, entry) => {
      const key = entry.subtype ? `${entry.reason} (${entry.subtype})` : entry.reason
      tally[key] = (tally[key] || 0) + 1
      return tally
    }, {}),
    notEnabled,
    notEnabledAccounts,
    pages,
    startDate,
    endDate,
  }
}

// ─── Removing what a connection left behind ───────────────────────────────────

/**
 * Transactions outlive the connection that imported them.
 *
 * Disconnecting a brokerage deleted its Plaid document and its access token and
 * left every transaction it had written in place. Nothing ever removed them, so
 * a reconnected brokerage imported the same trades again under fresh ids and
 * the ledger accumulated a copy per connection — three, in the account that
 * exposed this.
 *
 * Deletion is by account rather than by item because that is the field a
 * transaction actually carries. An item knows which accounts it enabled; a
 * transaction only knows the account it belongs to.
 */
async function deleteInChunks(db, refs) {
  let deleted = 0
  for (const group of chunk(refs, BATCH_LIMIT)) {
    const batch = db.batch()
    for (const ref of group) batch.delete(ref)
    await batch.commit()
    deleted += group.length
  }
  return deleted
}

export async function deleteTransactionsForAccounts({ db, uid, accountIds = [] }) {
  if (!uid || accountIds.length === 0) return { deleted: 0 }

  const wanted = new Set(accountIds.filter(Boolean))
  const userDoc = db.collection('users').doc(uid)
  const snapshot = await userDoc.collection('transactions').get()
  const doomed = snapshot.docs.filter((entry) => entry.data()?.source === 'plaid' && wanted.has(entry.data()?.accountId)).map((entry) => entry.ref)

  // The per-account metadata goes with them. `historyStartsAt` describing an
  // account with no transactions would tell the next import that history
  // begins somewhere it does not.
  const accountRefs = [...wanted].map((accountId) => userDoc.collection('accounts').doc(accountId))

  const deleted = await deleteInChunks(db, doomed)
  await deleteInChunks(db, accountRefs)
  return { deleted }
}

/**
 * Transactions belonging to no account this user still has connected.
 *
 * Self-healing, so a ledger already carrying orphans from earlier disconnects
 * clears itself on the next sync rather than needing anyone to know it is
 * there.
 *
 * `keepAccountIds` must be the accounts of every *current* connection. Passing
 * a partial list would delete live data, so the caller only prunes when it has
 * successfully enumerated them all — a sync where every connection failed
 * prunes nothing, because an empty keep-list is indistinguishable from an
 * account that owns everything.
 */
export async function pruneOrphanedTransactions({ db, uid, keepAccountIds = [], verifyConnections = false }) {
  if (!uid || keepAccountIds.length === 0) return { deleted: 0 }

  const keep = new Set(keepAccountIds.filter(Boolean))
  const userDoc = db.collection('users').doc(uid)
  const snapshot = await userDoc.collection('transactions').get()
  const orphans = snapshot.docs.filter((entry) => {
    const accountId = entry.data()?.accountId
    // A transaction with no account cannot be attributed and cannot be kept
    // meaningfully, but it also cannot be proven stale — left alone.
    return entry.data()?.source === 'plaid' && accountId && !keep.has(accountId)
  })

  let deleted = 0
  if (verifyConnections) {
    for (const group of chunk(orphans, BATCH_LIMIT)) {
      deleted += await db.runTransaction(async (tx) => {
        // The initial list can become stale while another connection syncs.
        // Protect both current connection membership and each row being removed.
        const connections = await tx.get(userDoc.collection('plaid'))
        const items = connections.docs.map((d) => d.data())
        if (items.some((d) => d.enabledAccountIds == null && !d.accounts?.length)) return 0
        const active = new Set(items.flatMap((d) => d.enabledAccountIds ?? d.accounts.map((a) => a.id)))
        if (!active.size) return 0
        const current = await Promise.all(group.map((d) => tx.get(d.ref)))
        let count = 0
        current.forEach((snap, i) => {
          const row = snap.data()
          if (snap.exists && row?.source === 'plaid' && row.accountId && !active.has(row.accountId)) {
            tx.delete(group[i].ref)
            count += 1
          }
        })
        return count
      })
    }
  } else deleted = await deleteInChunks(db, orphans.map((entry) => entry.ref))
  if (deleted > 0) console.log(`[plaidTransactions] pruned ${deleted} transactions from disconnected accounts`)
  return { deleted }
}
