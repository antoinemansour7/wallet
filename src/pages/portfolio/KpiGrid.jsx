import { fmtCurrency, fmtPct } from '../../utils/portfolioStats'
import StatCard from './StatCard'

export default function KpiGrid({ rows, stats, accounts }) {
  const accountsWithCash = accounts.filter((account) => account.cash !== 0).length
  const cashShare = stats.totalMarketValue > 0 ? (stats.totalCashValue / stats.totalMarketValue) * 100 : 0
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard label="Total Value" value={fmtCurrency(stats.totalMarketValue)} sub={`${rows.length} positions`} />
      <StatCard
        label="Cash Balance"
        value={fmtCurrency(stats.totalCashValue)}
        sub={accountsWithCash > 0 ? 'Cash on hand across your tracked accounts' : 'No cash balance is currently tracked'}
        tone={stats.totalCashValue !== 0 ? 'accent' : 'neutral'}
        badge={`${cashShare.toFixed(1)}% of value`}
      />
      <StatCard
        label="All-time P&L"
        value={fmtCurrency(stats.totalPnl)}
        sub="Combined closed-trade gains and open-position performance"
        pnl={stats.totalPnl}
        badge={fmtPct(stats.totalPnlPct)}
      />
      <StatCard label="Today's Change" value={fmtCurrency(stats.totalDayChange)} sub="Move since the prior close" badge={fmtPct(stats.dayChangePct)} pnl={stats.totalDayChange} />
      <StatCard label="Accounts" value={String(accounts.length)} sub={`${rows.length} positions total`} />
    </div>
  )
}
