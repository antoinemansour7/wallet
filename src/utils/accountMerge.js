// ─── Adding a statement to an account ────────────────────────────────────────
// Everything here exists because the app had no concept of *where* an upload
// came from. buildAccountPortfolio treats each upload as a complete snapshot of
// the entire portfolio, so any account absent from the new file reads as fully
// liquidated: positions cleared, and cash credited with the imaginary proceeds.
// Uploading a second brokerage's statement destroyed the first one and left a
// plausible-looking cash balance behind to cover it.
//
// The fix is to know which feed a position came from. A merge then touches only
// that feed's slice of one account, and everything else is copied through
// untouched.
//
// The sum-vs-replace question answers itself once sources exist:
//   · a statement from a NEW source ADDS      (two brokerages, both TFSAs)
//   · a statement from a KNOWN source REPLACES (a fresher file from the same one)
// which is what a person means by "add this to my TFSA" versus "here's this
// month's statement".
//
// Which account a statement belongs to is asked, never inferred. Account
// numbers are not stable across institutions and guessing it wrong silently
// merges two unrelated accounts.

import { parseNum } from './portfolioStats'
import { normalizeStoredAccounts } from './accountPortfolio'

export const SOURCE_KEY = '__sourceId'
export const LEGACY_SOURCE = 'legacy'

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/** Stable id for a feed. Two uploads of the same file are the same source. */
export function sourceIdFor({ kind, name }) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/\.(csv|xlsx?|pdf)$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${kind || 'file'}:${slug || 'unnamed'}`
}

/** Positions saved before sources existed all belong to one implicit feed. */
export function positionSource(row) {
  return row?.[SOURCE_KEY] || LEGACY_SOURCE
}

export function tagPositions(rows = [], sourceId) {
  return rows.map((row) => ({ ...row, [SOURCE_KEY]: sourceId }))
}

const symbolOf = (row) => String(row?.SYMBOL ?? '').trim().toUpperCase()
const valueOf = (row) => parseNum(row?.['MARKET VALUE'])
const qtyOf = (row) => parseNum(row?.QUANTITY)

/**
 * One line per symbol.
 *
 * Plaid reports holdings per account, so two selected accounts that both hold a
 * symbol return two rows for it — and every row lands in the one destination
 * account the person picked. previewMerge collapsed those with a Map (silently
 * keeping the last and discarding the rest) while applyMerge stored both, so
 * the sheet promised one holding of 17 shares and the ledger then showed the
 * same holding twice. Both go through here now, and it adds up rather than
 * discards.
 */
export function aggregateRowsBySymbol(rows = []) {
  const bySymbol = new Map()

  for (const row of rows) {
    const key = symbolOf(row)
    const existing = bySymbol.get(key)
    if (!existing) { bySymbol.set(key, { ...row }); continue }

    const quantity = qtyOf(existing) + qtyOf(row)
    const value = valueOf(existing) + valueOf(row)
    const book = parseNum(existing['BOOK VALUE']) + parseNum(row['BOOK VALUE'])
    const dayChange = parseNum(existing['DAY CHANGE']) + parseNum(row['DAY CHANGE'])
    const previousValue = value - dayChange
    const pnl = book > 0
      ? value - book
      : parseNum(existing['UNREALIZED GAIN/LOSS']) + parseNum(row['UNREALIZED GAIN/LOSS'])

    bySymbol.set(key, {
      ...existing,
      QUANTITY: quantity,
      'MARKET VALUE': round(value),
      'BOOK VALUE': round(book),
      // Recomputed, never summed: adding two unit prices together is nonsense.
      'MARKET PRICE': quantity > 0 ? round(value / quantity) : parseNum(existing['MARKET PRICE']),
      'DAY CHANGE': round(dayChange),
      'DAY CHANGE %': previousValue > 0 ? round((dayChange / previousValue) * 100) : existing['DAY CHANGE %'],
      'UNREALIZED GAIN/LOSS': round(pnl),
      'UNREALIZED GAIN/LOSS %': book > 0 ? round((pnl / book) * 100) : existing['UNREALIZED GAIN/LOSS %'],
    })
  }

  return [...bySymbol.values()]
}

function accountTotal(positions = []) {
  return round(positions.reduce((sum, p) => sum + valueOf(p), 0))
}

/**
 * What a merge would do, computed without doing it. The ticket's requirement
 * that a merge state its effects before running is the whole point: a person
 * combining two brokerages cannot otherwise tell a successful merge from one
 * that quietly replaced their holdings.
 */
export function previewMerge({ accounts = {}, accountNumber, sourceId, rows = [] }) {
  const existing = normalizeStoredAccounts(accounts)
  const target = existing[accountNumber]
  const current = target?.positions ?? []

  const sameSource = current.filter((p) => positionSource(p) === sourceId)
  const otherSources = current.filter((p) => positionSource(p) !== sourceId)
  const isKnownSource = sameSource.length > 0

  const incomingRows = aggregateRowsBySymbol(rows)
  const before = new Map(sameSource.map((p) => [symbolOf(p), p]))
  const incoming = new Map(incomingRows.map((r) => [symbolOf(r), r]))

  const added = []
  const updated = []
  const removed = []

  for (const [symbol, row] of incoming) {
    const prev = before.get(symbol)
    if (!prev) {
      added.push({ symbol, quantity: qtyOf(row), value: valueOf(row) })
    } else if (qtyOf(prev) !== qtyOf(row) || valueOf(prev) !== valueOf(row)) {
      updated.push({
        symbol,
        fromQuantity: qtyOf(prev), toQuantity: qtyOf(row),
        fromValue: valueOf(prev), toValue: valueOf(row),
      })
    }
  }
  for (const [symbol, prev] of before) {
    if (!incoming.has(symbol)) removed.push({ symbol, quantity: qtyOf(prev), value: valueOf(prev) })
  }

  const beforeTotal = accountTotal(current)
  const afterTotal = round(accountTotal(otherSources) + accountTotal(incomingRows))

  return {
    accountNumber,
    isNewAccount: !target,
    isKnownSource,
    // Positions in this account from other feeds — never touched by this merge,
    // and worth stating so combining brokerages does not feel like a gamble.
    keptFromOtherSources: otherSources.length,
    added,
    updated,
    removed,
    beforeTotal,
    afterTotal,
    delta: round(afterTotal - beforeTotal),
  }
}

/**
 * Apply the merge. Only the target account's slice for this source changes;
 * every other account and every other source is copied through as-is.
 */
export function applyMerge({ accounts = {}, accountNumber, sourceId, rows = [], cash = null, currency = '' }) {
  const existing = normalizeStoredAccounts(accounts)
  const target = existing[accountNumber]
  const current = target?.positions ?? []

  const otherSources = current.filter((p) => positionSource(p) !== sourceId)
  const incoming = tagPositions(aggregateRowsBySymbol(rows), sourceId).map((row) => ({
    ...row,
    // The account number on the row is whatever the file said; the destination
    // is what the person chose. Rewrite it so the row and its home agree.
    'ACCOUNT NUMBER': accountNumber,
  }))

  const merged = {
    ...existing,
    [accountNumber]: {
      accountNumber,
      currency: currency || target?.currency || String(rows[0]?.['ACCOUNT CURRENCY'] ?? '').toUpperCase(),
      positions: [...otherSources, ...incoming],
      cash: cash != null ? round(parseNum(cash)) : (target?.cash ?? 0),
      cashSource: cash != null ? 'explicit' : (target?.cashSource ?? 'none'),
      // Realized P&L is a property of trading history, not of importing a file.
      // Inferring it from a merge is what produced phantom proceeds before.
      realizedPnl: target?.realizedPnl ?? 0,
    },
  }

  return merged
}

/**
 * Which accounts a staged statement already knows it belongs to.
 *
 * A file says almost nothing reliable about this, so the destination is asked.
 * A connected brokerage is the opposite: Plaid reports holdings per account and
 * says which. Funnelling them all into one chosen destination pooled a TFSA and
 * an RRSP into a single WallAI account with their holdings mixed and their cash
 * summed — silently, and with a plausible-looking total.
 *
 * It also made the tax work impossible at the root: asset location cannot mean
 * anything when two registration types share one record.
 */
export const PLAID_ACCOUNT_KEY = '__plaidAccountId'

export function knownAccountsIn(rows = []) {
  const seen = new Map()
  for (const row of rows) {
    if (!row?.[PLAID_ACCOUNT_KEY]) continue
    const number = String(row['ACCOUNT NUMBER'] ?? '').trim()
    if (!number) continue
    if (!seen.has(number)) seen.set(number, { accountNumber: number, positions: 0, value: 0 })
    const entry = seen.get(number)
    entry.positions += 1
    entry.value = round(entry.value + valueOf(row))
  }
  return [...seen.values()]
}

/**
 * Apply a statement that already knows its accounts, keeping each row where it
 * says it belongs instead of rewriting all of them to one destination.
 *
 * Every other account and every other source is copied through untouched, the
 * same guarantee applyMerge gives.
 */
export function applyMergeByAccount({ accounts = {}, sourceId, rows = [], cashByAccount = {} }) {
  const byAccount = new Map()
  for (const row of rows) {
    const number = String(row['ACCOUNT NUMBER'] ?? '').trim() || 'Unknown'
    if (!byAccount.has(number)) byAccount.set(number, [])
    byAccount.get(number).push(row)
  }

  let merged = normalizeStoredAccounts(accounts)
  for (const [accountNumber, accountRows] of byAccount) {
    merged = applyMerge({
      accounts: merged,
      accountNumber,
      sourceId,
      rows: accountRows,
      cash: Object.prototype.hasOwnProperty.call(cashByAccount, accountNumber)
        ? cashByAccount[accountNumber]
        : null,
      currency: String(accountRows[0]?.['ACCOUNT CURRENCY'] ?? '').toUpperCase(),
    })
  }
  return merged
}

/**
 * Drop one feed from one account.
 *
 * An account whose last feed is removed has nothing left to describe it, so it
 * goes too — keeping an empty shell around means the accounts list shows a row
 * that holds nothing and cannot be filled except by importing into it again.
 * Cash is a property of the statement that reported it, so it leaves with the
 * last feed rather than lingering as a balance nothing accounts for.
 */
export function removeSource({ accounts = {}, accountNumber, sourceId }) {
  const existing = normalizeStoredAccounts(accounts)
  const target = existing[accountNumber]
  if (!target) return existing

  const kept = (target.positions ?? []).filter((p) => positionSource(p) !== sourceId)
  const next = { ...existing }

  if (kept.length === 0) {
    delete next[accountNumber]
    return next
  }

  next[accountNumber] = { ...target, positions: kept }
  return next
}

/**
 * Plaid's own id for the connection a row came from, carried on the row.
 *
 * The stored source id is `plaid:<institution>` — a label, built to be shown.
 * Disconnecting needs the item id the connection is filed under, and passing
 * the label instead looked up a document that never existed, so every
 * disconnect failed quietly and the connection kept syncing after its holdings
 * were gone.
 */
export const PLAID_ITEM_KEY = '__plaidItemId'

export function plaidItemIdFor(account, sourceId) {
  const match = (account?.positions ?? []).find(
    (position) => positionSource(position) === sourceId && position[PLAID_ITEM_KEY],
  )
  return match?.[PLAID_ITEM_KEY] ?? null
}

/**
 * Drop a whole account.
 *
 * Imports are derived from positions, so an account holding only cash has none
 * — and the detail sheet, which offers removal one import at a time, had
 * nothing to offer. That is reachable honestly (a statement of a pure cash
 * account) and it was also where the phantom-cash bug left its wreckage: an
 * account with no holdings, a balance nobody deposited, and no way out.
 */
export function removeAccount({ accounts = {}, accountNumber }) {
  const next = normalizeStoredAccounts(accounts)
  delete next[accountNumber]
  return next
}

/** Every feed across every account, for "remove all" and for counting. */
export function allSources(accounts = {}) {
  const existing = normalizeStoredAccounts(accounts)
  return Object.values(existing).flatMap((account) => (
    accountSources(account).map((source) => ({ ...source, accountNumber: account.accountNumber }))
  ))
}

/** Feeds already loaded into an account, for showing what it is made of. */
export function accountSources(account) {
  const counts = new Map()
  for (const position of account?.positions ?? []) {
    const id = positionSource(position)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()].map(([id, positions]) => ({ id, positions }))
}

/** Human-readable name for a source id. */
// Registered plans are initialisms; brokerage names are proper nouns. The id is
// lowercased and hyphenated for storage, so it has to be put back before it is
// shown — "questrade tfsa" reads like a typo next to everything around it.
const PLAN_WORDS = new Set(['tfsa', 'rrsp', 'resp', 'fhsa', 'lira', 'rrif', 'ira', 'roth', 'resp'])

function titleCase(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((word) => (PLAN_WORDS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
}

/**
 * What an import is called. The transport is carried by the row's icon, never
 * by the name: prefixing every filename with "File · " also broke the accounts
 * list, where imports are joined with that same separator — two statements read
 * as "File · Questrade TFSA · File · Wealthsimple TFSA", which looks like four.
 */
export function sourceLabel(id) {
  if (id === LEGACY_SOURCE) return 'Imported earlier'
  const [kind, ...rest] = String(id).split(':')
  const name = titleCase(rest.join(':').replace(/-/g, ' '))
  if (kind === 'plaid') return name || 'Connected'
  return name || 'Statement'
}
