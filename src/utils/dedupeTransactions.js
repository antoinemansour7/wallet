/**
 * One real transaction, imported once.
 *
 * A brokerage connected more than once produces a separate Plaid item per
 * connection, and each item assigns its own `investment_transaction_id` to the
 * same real trade. The ids therefore never collide, nothing upstream merges
 * them, and a ledger ends up holding the same purchase three times — as a real
 * one did:
 *
 *   2026-08-12  BUY  RKLB  918.56 USD   x3
 *   2026-08-12  BUY  NVDA  246.11 CAD   x3
 *
 * Cost base, realised gains and contribution room all read the ledger straight,
 * so that account believed it held three times what it owned. This is the
 * single place to stop it, applied where transactions are read rather than in
 * each consumer, because a dedupe that some callers apply and others do not is
 * a disagreement waiting to be found in a tax figure.
 *
 * ## What counts as the same transaction
 *
 * Identity is what the trade *is*, not which connection reported it: the date,
 * what was traded, how much, for how much, and which way. The account is
 * deliberately excluded — that is the field the duplicates differ in, since
 * each connection assigns its own account id to the same real account.
 *
 * The risk this accepts is real but small: two genuinely separate purchases of
 * the same security, for the same amount, on the same day, in two different
 * accounts would be merged. That is a rare and mostly-harmless collision, and
 * the alternative — counting one holding three times — is neither.
 */

const identity = (t) => [
  t?.tradeDate,
  t?.action,
  t?.securityKey ?? t?.symbol ?? '',
  Number(t?.quantity) || 0,
  Number(t?.amountMinor) || 0,
  String(t?.currency ?? '').toUpperCase(),
].join('|')

/**
 * @returns the transactions with duplicate imports of the same real trade
 *   removed, keeping the first seen. Order is otherwise preserved.
 */
export function dedupeTransactions(transactions = []) {
  const seen = new Set()
  const kept = []

  for (const transaction of transactions) {
    if (!transaction) continue
    const key = identity(transaction)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(transaction)
  }

  return kept
}

/** How many records the same real trade was imported under. */
export function duplicateCount(transactions = []) {
  return transactions.filter(Boolean).length - dedupeTransactions(transactions).length
}
