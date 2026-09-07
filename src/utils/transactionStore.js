/**
 * Reading the transaction ledger from the browser.
 *
 * Read-only by design, and enforced that way in firestore.rules: "a ledger the
 * browser can edit is a cost base the browser can edit, and these figures are
 * the ones that end up on a tax return." Everything here is a getter; there is
 * deliberately no write path to add later by accident.
 *
 * `historyStartsAt` is loaded alongside, from the per-account documents. It is
 * what lets a figure resolve to "incomplete" rather than to a wrong number, so
 * a consumer that reads transactions without it can silently report a partial
 * year as a whole one.
 */

import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase/config.js'
import { IS_PREVIEW } from '../preview/mockMode.js'
import { dedupeTransactions } from './dedupeTransactions.js'

/**
 * Enough to cover the twelve-month withholding window and a cost-base pool
 * across Plaid's 24-month history, without pulling an unbounded collection into
 * the browser on every page load.
 */
const DEFAULT_LIMIT = 2000

function transactionsCollection(uid) {
  return collection(db, 'users', uid, 'transactions')
}

/**
 * The ledger, newest first.
 *
 * Returns [] rather than throwing on any failure. Every consumer treats an
 * absent ledger as "no measured figure available" and falls back to a
 * projection that says it is one, so a read failure degrades to the behaviour
 * that existed before the ledger did.
 */
export async function loadTransactions(uid, { since = null, max = DEFAULT_LIMIT, strict = false } = {}) {
  if (!uid || IS_PREVIEW) return []

  try {
    const constraints = [
      ...(since ? [where('tradeDate', '>=', since)] : []),
      orderBy('tradeDate', 'desc'),
      limit(max),
    ]
    const snapshot = await getDocs(query(transactionsCollection(uid), ...constraints))
    // Deduped here rather than in each consumer: a brokerage connected more
    // than once reports the same trade under a different id per connection, and
    // a dedupe some readers apply and others do not is a disagreement waiting
    // to surface in a tax figure.
    return dedupeTransactions(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })))
  } catch (error) {
    if (strict) throw error
    console.error('[transactionStore] ledger read failed:', error?.message ?? error)
    return []
  }
}

/**
 * Where each account's history begins, keyed by accountId.
 *
 * An account with no stored document is absent from the map rather than
 * present with a null: "we do not know where this history starts" and "this
 * history starts at no particular date" are different, and only the first is
 * true here.
 */
export async function loadHistoryStarts(uid, { strict = false } = {}) {
  if (!uid || IS_PREVIEW) return {}

  try {
    const snapshot = await getDocs(collection(db, 'users', uid, 'accounts'))
    const starts = {}
    for (const entry of snapshot.docs) {
      const value = entry.data()?.historyStartsAt
      if (typeof value === 'string' && value) starts[entry.id] = value
    }
    return starts
  } catch (error) {
    if (strict) throw error
    console.error('[transactionStore] account metadata read failed:', error?.message ?? error)
    return {}
  }
}

/** One account's history start, for a caller that needs only the one. */
export async function loadHistoryStart(uid, accountId) {
  if (!uid || !accountId || IS_PREVIEW) return null

  try {
    const snapshot = await getDoc(doc(db, 'users', uid, 'accounts', accountId))
    const value = snapshot.data()?.historyStartsAt
    return typeof value === 'string' && value ? value : null
  } catch (error) {
    console.error('[transactionStore] account read failed:', error?.message ?? error)
    return null
  }
}
