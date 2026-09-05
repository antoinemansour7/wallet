import { accountSources, aggregateRowsBySymbol, knownAccountsIn, PLAID_ACCOUNT_KEY, plaidItemIdFor, positionSource, removeAccount, removeSource } from './accountMerge'

// Aggregate a security only within the account that owns it.
export function prepareImportRows(rows = []) {
  if (!rows.some((row) => row[PLAID_ACCOUNT_KEY])) return aggregateRowsBySymbol(rows)
  const groups = new Map()
  for (const row of rows) {
    const key = row[PLAID_ACCOUNT_KEY] || row['ACCOUNT NUMBER'] || 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.values()].flatMap(aggregateRowsBySymbol)
}

export function importAccountSummary(rows, cashEntries = [], connected = false) {
  const known = knownAccountsIn(rows)
  if (!connected) return known
  const result = new Map(known.map((account) => [account.accountNumber, account]))
  for (const entry of cashEntries) {
    if (entry.accountNumber && !result.has(entry.accountNumber)) result.set(entry.accountNumber, { accountNumber: entry.accountNumber, positions: 0, value: 0 })
  }
  return [...result.values()]
}

// Remove only the requested account/import. Keep sibling accounts in the same
// Plaid item enabled; revoke the item only after its last tracked account leaves.
export function planAccountRemoval({ accounts, accountNumber, sourceId }) {
  const account = accounts[accountNumber]
  if (!account) throw new Error('This account has already been removed.')
  const nextAccounts = sourceId ? removeSource({ accounts, accountNumber, sourceId }) : removeAccount({ accounts, accountNumber })
  const feeds = accountSources(account).filter((feed) => (!sourceId || feed.id === sourceId) && feed.id.startsWith('plaid:'))
  const operations = new Map()
  for (const feed of feeds) {
    const itemId = plaidItemIdFor(account, feed.id)
    const key = itemId || feed.id
    if (operations.has(key)) continue
    const siblings = Object.values(nextAccounts).flatMap((remaining) => accountSources(remaining).flatMap((source) => {
      if (!source.id.startsWith('plaid:')) return []
      const remainingItem = plaidItemIdFor(remaining, source.id)
      const same = itemId && remainingItem ? itemId === remainingItem : source.id === feed.id
      if (!same) return []
      const metadataIds = remaining.sources?.find((entry) => entry.id === source.id)?.plaidAccountIds || []
      const rows = remaining.positions.filter((position) => positionSource(position) === source.id)
      return [{ ids: [...new Set([...metadataIds, ...rows.map((row) => row[PLAID_ACCOUNT_KEY]).filter(Boolean)])] }]
    }))
    const institution = feed.id.slice('plaid:'.length)
    if (!siblings.length) {
      operations.set(key, { action: 'disconnect', itemId, institution })
      continue
    }
    const ids = [...new Set(siblings.flatMap((sibling) => sibling.ids))]
    if (!itemId || siblings.some((sibling) => !sibling.ids.length)) {
      // Older imports lack the ids required to narrow Plaid access. Removing
      // the local record still must not disconnect unrelated tracked accounts.
      operations.set(key, { action: 'keep-connection', itemId, institution })
    } else {
      operations.set(key, { action: 'select-accounts', itemId, accountIds: ids })
    }
  }
  return { nextAccounts, operations: [...operations.values()] }
}
