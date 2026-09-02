import { parseNum } from './portfolioStats'

function normalizeAccountNumber(value) {
  const text = String(value ?? '').trim()
  return text || 'Unknown'
}

function normalizeCurrency(value) {
  return String(value ?? '').trim().toUpperCase()
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function clonePosition(row) {
  return { ...row }
}

function normalizeStoredAccount(accountNumber, account = {}) {
  return {
    accountNumber,
    currency: normalizeCurrency(account.currency),
    positions: Array.isArray(account.positions) ? account.positions.map(clonePosition) : [],
    cash: roundMoney(parseNum(account.cash)),
    cashSource: account.cashSource || 'none',
    realizedPnl: roundMoney(parseNum(account.realizedPnl)),
  }
}

function buildAccountsFromRows(rows = []) {
  const accounts = {}

  for (const row of rows) {
    const accountNumber = normalizeAccountNumber(row['ACCOUNT NUMBER'])
    if (!accounts[accountNumber]) {
      accounts[accountNumber] = normalizeStoredAccount(accountNumber, {
        currency: row['ACCOUNT CURRENCY'],
        positions: [],
      })
    }

    accounts[accountNumber].positions.push(clonePosition(row))
    if (!accounts[accountNumber].currency) {
      accounts[accountNumber].currency = normalizeCurrency(row['ACCOUNT CURRENCY'])
    }
  }

  return accounts
}

/**
 * A statement calls the figure `amount`; the Plaid route called it `value`, and
 * this only ever read `amount` — so every cash balance arriving from a
 * connected brokerage summed to zero and vanished. Both names are read here so
 * anything already stored keeps working.
 */
export function cashEntryAmount(entry) {
  return parseNum(entry?.amount ?? entry?.value)
}

function sumExplicitCashEntries(cashEntries = []) {
  const byAccount = {}

  for (const entry of cashEntries) {
    const accountNumber = normalizeAccountNumber(entry.accountNumber)
    byAccount[accountNumber] = roundMoney((byAccount[accountNumber] || 0) + cashEntryAmount(entry))
  }

  return byAccount
}

export function normalizeStoredAccounts(accounts) {
  if (!accounts || typeof accounts !== 'object') return {}

  return Object.fromEntries(
    Object.entries(accounts).map(([accountNumber, account]) => (
      [normalizeAccountNumber(accountNumber), normalizeStoredAccount(normalizeAccountNumber(accountNumber), account)]
    )),
  )
}

export function buildAccountPortfolio({
  rows = [],
  previousAccounts = {},
  cashEntries = [],
} = {}) {
  const previous = normalizeStoredAccounts(previousAccounts)
  const nextFromRows = buildAccountsFromRows(rows)
  const explicitCashByAccount = sumExplicitCashEntries(cashEntries)
  const accountNumbers = new Set([
    ...Object.keys(previous),
    ...Object.keys(nextFromRows),
    ...Object.keys(explicitCashByAccount),
  ])

  const nextAccounts = {}

  for (const accountNumber of accountNumbers) {
    const prevAccount = previous[accountNumber] || normalizeStoredAccount(accountNumber)
    const fromRows = nextFromRows[accountNumber]

    // Rows that say nothing about an account are a gap, not a liquidation. This
    // used to diff the two snapshots and book the difference as trades, which
    // is why one refresh that came back short emptied an account and credited
    // it with thousands of dollars of proceeds nobody received, marked
    // "inferred". Importing a statement has not gone through here since
    // positions learned which feed they came from — applyMerge owns that, and
    // deliberately infers nothing — so the only caller left is the live price
    // refresh, where quantities never change and a missing row is always a
    // dropped fetch.
    const positions = fromRows ? fromRows.positions : prevAccount.positions
    const hasExplicitCash = Object.prototype.hasOwnProperty.call(explicitCashByAccount, accountNumber)

    const resolved = {
      accountNumber,
      currency: fromRows?.currency || prevAccount.currency,
      positions,
      cash: hasExplicitCash ? explicitCashByAccount[accountNumber] : prevAccount.cash,
      cashSource: hasExplicitCash ? 'explicit' : prevAccount.cashSource,
      realizedPnl: prevAccount.realizedPnl,
    }

    if (resolved.positions.length > 0 || resolved.cash !== 0 || resolved.cashSource !== 'none' || resolved.realizedPnl !== 0) {
      nextAccounts[accountNumber] = resolved
    }
  }

  return nextAccounts
}

export function flattenAccountRows(accounts) {
  return getAccountEntries(accounts).flatMap((account) => account.positions.map(clonePosition))
}

export function getAccountEntries(accounts) {
  return Object.entries(normalizeStoredAccounts(accounts))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([accountNumber, account]) => ({
      accountNumber,
      ...account,
    }))
}

export function hasAccountPortfolio(accounts) {
  return getAccountEntries(accounts).length > 0
}
