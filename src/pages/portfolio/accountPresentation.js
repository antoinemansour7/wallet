import { accountSources, plaidItemIdFor, sourceLabel } from '../../utils/accountMerge'
import { analyticsScopes } from './chartAnalytics'

export function accountTitle(account) {
  const type = account.positions?.find((row) => row['ACCOUNT TYPE'])?.['ACCOUNT TYPE']
  if (type) return String(type)
  if (/\s|^(TFSA|RRSP|FHSA|RESP)$/i.test(account.accountNumber)) return account.accountNumber
  return account.positions?.length ? 'Investment account' : 'Cash account'
}

export function accountCurrency(account) {
  return account.currency || account.positions?.[0]?.['ACCOUNT CURRENCY'] || ''
}

export function currencyTotals(accounts) {
  return analyticsScopes(accounts).map((scope) => ({ currency: scope.currency, value: scope.accounts.reduce((sum, account) => sum + account.value, 0) }))
}

export function brokerageConnections(accounts) {
  const connections = new Map()
  for (const account of accounts) {
    for (const source of accountSources(account).filter((feed) => feed.id.startsWith('plaid:'))) {
      const key = plaidItemIdFor(account, source.id) || source.id
      if (!connections.has(key)) connections.set(key, { key, label: sourceLabel(source.id), accounts: [] })
      connections.get(key).accounts.push(account)
    }
  }
  return [...connections.values()]
}
