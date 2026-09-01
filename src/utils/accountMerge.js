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

  const before = new Map(sameSource.map((p) => [symbolOf(p), p]))
  const incoming = new Map(rows.map((r) => [symbolOf(r), r]))

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
  const afterTotal = round(accountTotal(otherSources) + accountTotal(rows))

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
  const incoming = tagPositions(rows, sourceId).map((row) => ({
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

export function sourceLabel(id) {
  if (id === LEGACY_SOURCE) return 'Imported earlier'
  const [kind, ...rest] = String(id).split(':')
  const name = titleCase(rest.join(':').replace(/-/g, ' '))
  if (kind === 'plaid') return name || 'Connected'
  return name ? `File · ${name}` : 'File'
}
