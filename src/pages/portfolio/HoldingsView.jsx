import { fmtCurrency, fmtNumber, fmtPct, parseNum } from '../../utils/portfolioStats'
import EmptyState from './EmptyState'

export default function HoldingsView({ rows, accounts, onUploadClick }) {
  if (!accounts.length && !rows.length) return <EmptyState onUploadClick={onUploadClick} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Accounts & Positions</h2>
        <span className="rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-text-muted shadow-sm">
          {accounts.length} accounts · {rows.length} positions
        </span>
      </div>

      {accounts.map((account) => {
        const acct = account.accountNumber
        const acctRows = account.positions
        const acctStats = account.stats
        const cashSourceLabel = account.cashSource === 'explicit' ? 'Cash from file' : account.cashSource === 'inferred' ? 'Inferred cash' : 'Cash'

        return (
          <div key={acct} className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <div className="flex items-center justify-between border-b border-border-subtle bg-brand-light px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-brand" />
                <span className="text-xs font-bold tracking-wide text-text-secondary">Account {acct}</span>
                <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-text-muted">
                  {acctRows.length} positions
                </span>
                {account.cash !== 0 && (
                  <span className="rounded-full bg-gain-bg px-2 py-0.5 text-[10px] font-medium text-gain">
                    {cashSourceLabel}
                  </span>
                )}
              </div>
              <div className="text-right">
                <span className="font-mono text-sm font-bold tabular text-text-primary">
                  {fmtCurrency(acctStats.totalMarketValue)}
                </span>
                <p className="font-mono text-[10px] tabular text-text-muted">
                  {fmtCurrency(account.cash)} cash
                </p>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 border-b border-border-subtle px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">Position</span>
              <span className="w-20 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">Price · Qty</span>
              <span className="w-28 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">Mkt Value</span>
              <span className="w-28 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">P&L</span>
              <span className="w-16 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">Today</span>
            </div>

            <div className="divide-y divide-border-subtle">
              {acctRows.length === 0 && (
                <div className="px-4 py-4 text-sm text-text-muted">No open positions in this account.</div>
              )}
              {acctRows.map((row, i) => {
                const isCdrRow = /\bCDR\b/i.test(String(row.DESCRIPTION ?? ''))
                const symbol   = row.SYMBOL ?? '—'
                const pnl      = parseNum(row['UNREALIZED GAIN/LOSS'])
                const pnlPct   = row['UNREALIZED GAIN/LOSS %']
                const dayAmt   = parseNum(row['DAY CHANGE'])
                const dayPct   = row['DAY CHANGE %']
                const price    = parseNum(row['MARKET PRICE'])
                const mktVal   = parseNum(row['MARKET VALUE'])
                const bookVal  = parseNum(row['BOOK VALUE'])
                const qty      = parseNum(row.QUANTITY)
                const gainCls  = pnl > 0 ? 'text-gain' : pnl < 0 ? 'text-loss' : 'text-text-muted'
                const dayCls   = dayAmt > 0 ? 'text-gain' : dayAmt < 0 ? 'text-loss' : 'text-text-muted'

                return (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 px-4 py-3.5 transition-colors hover:bg-surface">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">
                        {symbol[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-sm font-bold text-text-primary">{symbol}</span>
                          {isCdrRow && (
                            <span className="rounded bg-gain-bg px-1 py-px text-[9px] font-bold tracking-wide text-gain" title="Canadian Depositary Receipt">CDR</span>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-text-muted" title={row.DESCRIPTION ?? ''}>{row.DESCRIPTION ?? '—'}</p>
                      </div>
                    </div>
                    <div className="w-20 text-right">
                      <p className="font-mono text-sm font-semibold tabular text-text-primary">{fmtCurrency(price)}</p>
                      <p className="text-[11px] tabular text-text-muted">{fmtNumber(qty)} units</p>
                    </div>
                    <div className="w-28 text-right">
                      <p className="font-mono text-sm font-bold tabular text-text-primary">{fmtCurrency(mktVal)}</p>
                      <p className="text-[11px] tabular text-text-muted">{fmtCurrency(bookVal)} cost</p>
                    </div>
                    <div className="w-28 text-right">
                      <p className={`font-mono text-sm font-bold tabular ${gainCls}`}>{fmtCurrency(pnl)}</p>
                      <p className={`text-[11px] font-medium ${gainCls}`}>{pnlPct ?? '—'}</p>
                    </div>
                    <div className="w-16 text-right">
                      <p className={`text-xs font-bold ${dayCls}`}>{dayPct ?? '—'}</p>
                      <p className={`font-mono text-[11px] tabular ${dayCls}`}>{dayAmt !== 0 ? fmtCurrency(dayAmt) : ''}</p>
                    </div>
                  </div>
                )
              })}
              {account.cash !== 0 && (
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 bg-gain-bg/60 px-4 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gain/10 text-sm font-bold text-gain">$</div>
                    <div className="min-w-0">
                      <span className="font-mono text-sm font-bold text-text-primary">CASH</span>
                      <p className="truncate text-[11px] text-text-muted">{cashSourceLabel}</p>
                    </div>
                  </div>
                  <div className="w-20 text-right">
                    <p className="font-mono text-sm font-semibold tabular text-text-primary">{account.currency || 'CAD'}</p>
                    <p className="text-[11px] tabular text-text-muted">balance</p>
                  </div>
                  <div className="w-28 text-right">
                    <p className="font-mono text-sm font-bold tabular text-text-primary">{fmtCurrency(account.cash)}</p>
                    <p className="text-[11px] tabular text-text-muted">cash held</p>
                  </div>
                  <div className="w-28 text-right">
                    <p className="font-mono text-sm font-bold tabular text-text-muted">{fmtCurrency(0)}</p>
                    <p className="text-[11px] font-medium text-text-muted">—</p>
                  </div>
                  <div className="w-16 text-right">
                    <p className="text-xs font-bold text-text-muted">—</p>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-4 border-t border-border bg-brand-light px-4 py-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted">Book Cost</p>
                <p className="font-mono text-xs font-semibold tabular text-text-secondary">{fmtCurrency(acctStats.totalBookValue)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted">Cash</p>
                <p className="font-mono text-xs font-semibold tabular text-text-secondary">{fmtCurrency(account.cash)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted">Total P&L</p>
                <p className={`font-mono text-xs font-semibold tabular ${acctStats.totalPnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {fmtCurrency(acctStats.totalPnl)}&nbsp;
                  <span className="font-normal">({fmtPct(acctStats.totalPnlPct)})</span>
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted">Today</p>
                <p className={`font-mono text-xs font-semibold tabular ${acctStats.totalDayChange >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {fmtCurrency(acctStats.totalDayChange)}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
