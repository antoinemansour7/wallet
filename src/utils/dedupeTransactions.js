/**
 * Deduplicate repeated source identities within an account. Equal amounts,
 * dates and symbols do not establish that two trades are the same transaction.
 * Duplicate connections must be reconciled by verified account identity at
 * import, never by deleting lookalike trades from unrelated accounts here.
 */
export function dedupeTransactions(transactions = []) {
  const seen = new Set()
  return transactions.filter((row) => {
    if (!row) return false
    const id = row.sourceId || row.id
    if (!id || !row.accountId) return true
    const key = JSON.stringify([row.accountId, row.source || '', id])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function duplicateCount(transactions = []) {
  return transactions.filter(Boolean).length - dedupeTransactions(transactions).length
}
