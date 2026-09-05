import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'

// Intentionally repurposed: account placement and cash, not holding weights.
export default function AccountAllocationChart({ accounts, currency }) {
  const items = [...accounts].sort((a, b) => b.value - a.value)
  const max = Math.max(...items.map((item) => Math.max(0, item.invested) + Math.max(0, item.cash)), 1)
  const cash = items.reduce((sum, item) => sum + item.cash, 0)
  const total = items.reduce((sum, item) => sum + item.value, 0)
  return <ChartPanel title="Across your accounts" meta={currency} className="account-analysis-panel">
    <p className="analytics-subtitle">Where your investments and cash sit</p>
    <div className="account-analysis-legend"><span><i className="analytics-key" />Invested</span><span><i className="analytics-key is-cash" />Cash</span></div>
    <ol className="account-analysis-list">{items.map((item) => <li key={item.accountNumber}><div className="account-analysis-label"><strong>{item.accountNumber}</strong><span>{fmtCurrency(item.value)}</span></div><div className="account-analysis-track" aria-hidden="true"><span style={{ width: `${Math.max(0, item.invested) / max * 100}%` }} /><span className="is-cash" style={{ width: `${Math.max(0, item.cash) / max * 100}%` }} /></div><div className="account-analysis-caption"><span>{fmtCurrency(item.invested)} invested</span><span>{fmtCurrency(item.cash)} cash</span></div></li>)}</ol>
    <div className="account-analysis-cash"><span>Cash across these accounts</span><strong>{fmtCurrency(cash)}<small>{total > 0 && cash >= 0 ? `${(cash / total * 100).toFixed(1)}% of balance` : currency}</small></strong></div>
    <p className="analytics-panel-note">Each bar uses the same scale. Recorded cash is included in the account balance.{items.some((item) => item.invested < 0 || item.cash < 0) ? ' Negative balances are listed; bars show positive amounts only.' : ''}</p>
  </ChartPanel>
}
