import { useMemo } from 'react'
import { analyticsScopes } from './chartAnalytics'
import ComparisonChart from './ComparisonChart'
import GainsByHoldingChart from './GainsByHoldingChart'
import AccountAllocationChart from './AccountAllocationChart'
import './Charts.css'

const scopeTotal = (scope) => (scope?.accounts || []).reduce((sum, account) => sum + (account.value || 0), 0)

export default function ChartsView({ accounts }) {
  const scopes = useMemo(() => analyticsScopes(accounts), [accounts])
  // These charts still show one currency at a time — CAD and USD balances
  // cannot be added together without converting them, so a combined total
  // would be a wrong number rather than a fuller one. With the picker gone,
  // the largest currency is the one worth defaulting to; the previous
  // alphabetical default would have shown a token CAD balance and hidden a
  // portfolio held in USD.
  const scope = useMemo(() => scopes.reduce((largest, item) => (scopeTotal(item) > scopeTotal(largest) ? item : largest), scopes[0]), [scopes])
  if (!scope) return null
  return <div className="analytics-page">
    <header className="analytics-heading"><div><p className="analytics-eyebrow">YOUR PORTFOLIO</p><h1>Charts</h1><p>Compare with the market. See what’s driving the change.</p></div></header>
    <ComparisonChart key={scope.currency} scope={scope} />
    <div className="analytics-support"><GainsByHoldingChart rows={scope.rows} currency={scope.currency} /><AccountAllocationChart accounts={scope.accounts} currency={scope.currency} /></div>
    {scopes.length > 1 && <p className="analytics-page-note">Showing {scope.currency} balances. Holdings recorded in another currency are not included in these charts.</p>}
  </div>
}
