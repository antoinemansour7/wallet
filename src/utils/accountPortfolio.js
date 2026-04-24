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

function getRowUnitPrice(row) {
  if (!row) return 0
  const marketPrice = parseNum(row['MARKET PRICE'])
  if (marketPrice > 0) return marketPrice

  const quantity = parseNum(row.QUANTITY)
  const marketValue = parseNum(row['MARKET VALUE'])
  if (quantity > 0 && marketValue > 0) return marketValue / quantity

  return 0
}

function getRowKey(row) {
  const symbol = String(row?.SYMBOL ?? '').trim().toUpperCase()
  const description = String(row?.DESCRIPTION ?? '').trim().toUpperCase()
  return `${symbol}::${description}`
}

function getPositionsByKey(rows = []) {
  const map = new Map()
  for (const row of rows) {
    map.set(getRowKey(row), row)
  }
  return map
}

function getSoldBookValue(prevRow, nextRow, soldQty) {
  const prevBook = parseNum(prevRow?.['BOOK VALUE'])
  const nextBook = parseNum(nextRow?.['BOOK VALUE'])
  if (nextRow && prevBook > 0 && nextBook >= 0) {
    const delta = prevBook - nextBook
    if (delta > 0) return delta
  }

  const prevQty = parseNum(prevRow?.QUANTITY)
  const avgCost = prevQty > 0
    ? prevBook / prevQty
    : parseNum(prevRow?.['AVERAGE UNIT COST'])
  return soldQty * avgCost
}

function getBoughtCost(prevRow, nextRow, boughtQty) {
  const prevBook = parseNum(prevRow?.['BOOK VALUE'])
  const nextBook = parseNum(nextRow?.['BOOK VALUE'])
  if (prevRow && nextBook > 0 && prevBook >= 0) {
    const delta = nextBook - prevBook
    if (delta > 0) return delta
  }

  const nextQty = parseNum(nextRow?.QUANTITY)
  const avgCost = nextQty > 0
    ? parseNum(nextRow?.['BOOK VALUE']) / nextQty || parseNum(nextRow?.['AVERAGE UNIT COST'])
    : parseNum(nextRow?.['AVERAGE UNIT COST'])
  const referencePrice = getReferencePrice(prevRow, nextRow)
  return boughtQty * (referencePrice > 0 ? referencePrice : avgCost)
}

function getReferencePrice(prevRow, nextRow) {
  const prices = [getRowUnitPrice(prevRow), getRowUnitPrice(nextRow)].filter((value) => value > 0)
  if (prices.length === 0) return 0
  if (prices.length === 1) return prices[0]
  return (prices[0] + prices[1]) / 2
}

function inferAccountChanges(previousPositions = [], nextPositions = []) {
  const previousByKey = getPositionsByKey(previousPositions)
  const nextByKey = getPositionsByKey(nextPositions)
  const keys = new Set([...previousByKey.keys(), ...nextByKey.keys()])

  let cashDelta = 0
  let realizedPnlDelta = 0

  for (const key of keys) {
    const prevRow = previousByKey.get(key)
    const nextRow = nextByKey.get(key)
    const prevQty = parseNum(prevRow?.QUANTITY)
    const nextQty = parseNum(nextRow?.QUANTITY)

    if (nextQty < prevQty) {
      const soldQty = prevQty - nextQty
      const proceeds = roundMoney(soldQty * getReferencePrice(prevRow, nextRow))
      const bookValue = roundMoney(getSoldBookValue(prevRow, nextRow, soldQty))
      cashDelta += proceeds
      realizedPnlDelta += proceeds - bookValue
    } else if (nextQty > prevQty) {
      const boughtQty = nextQty - prevQty
      const cost = roundMoney(getBoughtCost(prevRow, nextRow, boughtQty))
      cashDelta -= cost
    }
  }

  return {
    cashDelta: roundMoney(cashDelta),
    realizedPnlDelta: roundMoney(realizedPnlDelta),
  }
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

function sumExplicitCashEntries(cashEntries = []) {
  const byAccount = {}

  for (const entry of cashEntries) {
    const accountNumber = normalizeAccountNumber(entry.accountNumber)
    byAccount[accountNumber] = roundMoney((byAccount[accountNumber] || 0) + parseNum(entry.amount))
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
    const nextAccount = nextFromRows[accountNumber] || normalizeStoredAccount(accountNumber, {
      currency: prevAccount.currency,
      positions: [],
    })

    const hasExplicitCash = Object.prototype.hasOwnProperty.call(explicitCashByAccount, accountNumber)
    const hasPreviousSnapshot = Object.prototype.hasOwnProperty.call(previous, accountNumber)
    const changes = hasPreviousSnapshot
      ? inferAccountChanges(prevAccount.positions, nextAccount.positions)
      : { cashDelta: 0, realizedPnlDelta: 0 }
    const cash = hasExplicitCash
      ? explicitCashByAccount[accountNumber]
      : roundMoney(prevAccount.cash + changes.cashDelta)
    const cashSource = hasExplicitCash
      ? 'explicit'
      : changes.cashDelta !== 0
      ? 'inferred'
      : prevAccount.cashSource
    const realizedPnl = roundMoney(prevAccount.realizedPnl + changes.realizedPnlDelta)

    const resolved = {
      accountNumber,
      currency: nextAccount.currency || prevAccount.currency,
      positions: nextAccount.positions,
      cash,
      cashSource,
      realizedPnl,
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
