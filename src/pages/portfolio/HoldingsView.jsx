import { fmtCurrency, fmtNumber, fmtPct, parseNum } from '../../utils/portfolioStats'

function normalizePct(val) {
  if (val == null || val === '') return null
  const s = String(val)
  if (s.endsWith('%')) return s
  const n = parseFloat(s)
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : s
}
import EmptyState from './EmptyState'

export default function HoldingsView({ rows, accounts, onUploadClick }) {
  if (!accounts.length && !rows.length) return <EmptyState onUploadClick={onUploadClick} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Accounts & Positions</h2>
        <span className="rounded-full border border-white/[0.06] bg-wall-surface px-3 py-1 font-mono text-xs text-white/40">
          {accounts.length} accounts · {rows.length} positions
        </span>
      </div>

      {accounts.map((account) => {
        const acct = account.accountNumber
        const acctRows = account.positions
        const acctStats = account.stats
        const cashSourceLabel = account.cashSource === 'explicit' ? 'Cash from file' : account.cashSource === 'inferred' ? 'Inferred cash' : 'Cash'

        return (
          <div key={acct} className="overflow-hidden rounded-card border border-white/[0.06] bg-wall-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06]-subtle bg-white/[0.04] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-white/10" />
                <span className="text-xs font-bold tracking-wide text-white/60">Account {acct}</span>
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-white/40">
                  {acctRows.length} pos
                </span>
                {account.cash !== 0 && (
                  <span className="rounded-full bg-gain/10 px-2 py-0.5 text-[10px] font-medium text-gain">
                    {cashSourceLabel}
                  </span>
                )}
              </div>
              <div className="text-right">
                <span className="font-mono text-sm font-bold tabular text-white">
                  {fmtCurrency(acctStats.totalMarketValue)}
                </span>
                <p className="font-mono text-[10px] tabular text-white/40">
                  {fmtCurrency(account.cash)} cash
                </p>
              </div>
            </div>

            <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 border-b border-white/[0.06]-subtle px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">Position</span>
              <span className="w-20 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">Price · Qty</span>
              <span className="w-28 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">Mkt Value</span>
              <span className="w-28 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">P&L</span>
              <span className="w-16 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">Today</span>
            </div>

            <div className="divide-y divide-border-subtle">
              {acctRows.length === 0 && (
                <div className="px-4 py-4 text-sm text-white/40">No open positions in this account.</div>
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
                const gainCls  = pnl > 0 ? 'text-gain' : pnl < 0 ? 'text-loss' : 'text-white/40'
                const dayCls   = dayAmt > 0 ? 'text-gain' : dayAmt < 0 ? 'text-loss' : 'text-white/40'

                return (
                  <div key={i} className="px-4 py-3.5 transition-colors hover:bg-white/[0.02]">
                    {/* Desktop layout */}
                    <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-sm font-bold text-white">
                          {symbol[0]}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm font-bold text-white">{symbol}</span>
                            {isCdrRow && (
                              <span className="rounded bg-gain/10 px-1 py-px text-[9px] font-bold tracking-wide text-gain" title="Canadian Depositary Receipt">CDR</span>
                            )}
                          </div>
                          <p className="truncate text-[11px] text-white/40" title={row.DESCRIPTION ?? ''}>{row.DESCRIPTION ?? '—'}</p>
                        </div>
                      </div>
                      <div className="w-20 text-right">
                        <p className="font-mono text-sm font-semibold tabular text-white">{fmtCurrency(price)}</p>
                        <p className="text-[11px] tabular text-white/40">{fmtNumber(qty)} units</p>
                      </div>
                      <div className="w-28 text-right">
                        <p className="font-mono text-sm font-bold tabular text-white">{fmtCurrency(mktVal)}</p>
                        <p className="text-[11px] tabular text-white/40">{fmtCurrency(bookVal)} cost</p>
                      </div>
                      <div className="w-28 text-right">
                        <p className={`font-mono text-sm font-bold tabular ${gainCls}`}>{fmtCurrency(pnl)}</p>
                        <p className={`text-[11px] font-medium ${gainCls}`}>{normalizePct(pnlPct) ?? '—'}</p>
                      </div>
                      <div className="w-16 text-right">
                        <p className={`font-mono text-xs font-bold tabular ${dayCls}`}>{dayAmt !== 0 ? fmtCurrency(dayAmt) : ''}</p>
                        <p className={`text-[11px] font-medium ${dayCls}`}>{normalizePct(dayPct) ?? '—'}</p>
                      </div>
                    </div>
                    {/* Mobile layout */}
                    <div className="flex items-center gap-3 sm:hidden">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-sm font-bold text-white">
                        {symbol[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-sm font-bold text-white">{symbol}</span>
                          {isCdrRow && (
                            <span className="rounded bg-gain/10 px-1 py-px text-[9px] font-bold tracking-wide text-gain">CDR</span>
                          )}
                          <span className="ml-auto font-mono text-sm font-bold tabular text-white">{fmtCurrency(mktVal)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="text-[11px] tabular text-white/40">{fmtNumber(qty)} @ {fmtCurrency(price)}</span>
                          <span className={`ml-auto font-mono text-[11px] font-semibold tabular ${gainCls}`}>
                            {fmtCurrency(pnl)} ({normalizePct(pnlPct) ?? '—'})
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {account.cash !== 0 && (
                <div className="bg-gain/[0.06] px-4 py-3.5">
                  {/* Desktop */}
                  <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gain/10 text-sm font-bold text-gain">$</div>
                      <div className="min-w-0">
                        <span className="font-mono text-sm font-bold text-white">CASH</span>
                        <p className="truncate text-[11px] text-white/40">{cashSourceLabel}</p>
                      </div>
                    </div>
                    <div className="w-20 text-right">
                      <p className="font-mono text-sm font-semibold tabular text-white">{account.currency || 'CAD'}</p>
                      <p className="text-[11px] tabular text-white/40">balance</p>
                    </div>
                    <div className="w-28 text-right">
                      <p className="font-mono text-sm font-bold tabular text-white">{fmtCurrency(account.cash)}</p>
                      <p className="text-[11px] tabular text-white/40">cash held</p>
                    </div>
                    <div className="w-28 text-right">
                      <p className="font-mono text-sm font-bold tabular text-white/40">{fmtCurrency(0)}</p>
                      <p className="text-[11px] font-medium text-white/40">—</p>
                    </div>
                    <div className="w-16 text-right">
                      <p className="text-xs font-bold text-white/40">—</p>
                    </div>
                  </div>
                  {/* Mobile */}
                  <div className="flex items-center gap-3 sm:hidden">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gain/10 text-sm font-bold text-gain">$</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center">
                        <span className="font-mono text-sm font-bold text-white">CASH</span>
                        <span className="ml-auto font-mono text-sm font-bold tabular text-white">{fmtCurrency(account.cash)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-white/40">{cashSourceLabel} · {account.currency || 'CAD'}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-white/[0.06] bg-white/[0.04] px-4 py-3 sm:grid-cols-4 sm:gap-4">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">Book Cost</p>
                <p className="font-mono text-xs font-semibold tabular text-white/60">{fmtCurrency(acctStats.totalBookValue)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">Cash</p>
                <p className="font-mono text-xs font-semibold tabular text-white/60">{fmtCurrency(account.cash)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">Total P&L</p>
                <p className={`font-mono text-xs font-semibold tabular ${acctStats.totalPnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {fmtCurrency(acctStats.totalPnl)}&nbsp;
                  <span className="font-normal">({fmtPct(acctStats.totalPnlPct)})</span>
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">Today</p>
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
