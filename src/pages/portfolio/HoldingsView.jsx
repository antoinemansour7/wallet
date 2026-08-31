import { useState } from 'react'
import { fmtCurrency, fmtNumber, fmtPct, parseNum } from '../../utils/portfolioStats'
import CompanyLogo from '../../components/CompanyLogo'
import Reveal from '../../components/Reveal'
import EmptyState from './EmptyState'

function normalizePct(val) {
  if (val == null || val === '') return null
  const s = String(val)
  if (s.endsWith('%')) return s
  const n = parseFloat(s)
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : s
}

function ReturnText({ amount, pct, className = '' }) {
  const cls = amount > 0 ? 'text-gain' : amount < 0 ? 'text-loss' : 'text-white/40'
  const arrow = amount > 0 ? '▲' : amount < 0 ? '▼' : ''
  return (
    <p className={`text-[12px] font-medium tabular ${cls} ${className}`}>
      {arrow} {fmtCurrency(Math.abs(amount))}{pct ? ` (${pct})` : ''}
    </p>
  )
}

function PositionRow({ row, expanded, onToggle }) {
  const isCdrRow = /\bCDR\b/i.test(String(row.DESCRIPTION ?? ''))
  const symbol = row.SYMBOL ?? '—'
  const pnl = parseNum(row['UNREALIZED GAIN/LOSS'])
  const pnlPct = normalizePct(row['UNREALIZED GAIN/LOSS %'])
  const dayAmt = parseNum(row['DAY CHANGE'])
  const dayPct = normalizePct(row['DAY CHANGE %'])
  const price = parseNum(row['MARKET PRICE'])
  const mktVal = parseNum(row['MARKET VALUE'])
  const bookVal = parseNum(row['BOOK VALUE'])
  const qty = parseNum(row.QUANTITY)

  return (
    <div className="transition-colors hover:bg-white/[0.03]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5"
      >
        <CompanyLogo symbol={symbol} size={40} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold tracking-[-0.01em] text-white">{symbol}</span>
            {isCdrRow && (
              <span className="rounded-full bg-white/[0.07] px-1.5 py-px text-[9px] font-semibold tracking-wide text-white/50" title="Canadian Depositary Receipt">CDR</span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] tabular text-white/35">
            {fmtNumber(qty)} shares · {fmtCurrency(price)}
          </p>
        </div>

        <div className="text-right">
          <p className="text-[14px] font-semibold tabular text-white">{fmtCurrency(mktVal)}</p>
          <ReturnText amount={pnl} pct={pnlPct} className="mt-0.5 justify-end" />
        </div>
      </button>

      {expanded && (
        <div className="animate-fade-in grid grid-cols-2 gap-3 px-4 pb-4 pl-[68px] sm:grid-cols-4 sm:px-5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-white/30">Today</p>
            <ReturnText amount={dayAmt} pct={dayPct} className="mt-1" />
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-white/30">Total return</p>
            <ReturnText amount={pnl} pct={pnlPct} className="mt-1" />
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-white/30">Book cost</p>
            <p className="mt-1 text-[12px] font-medium tabular text-white/70">{fmtCurrency(bookVal)}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-white/30">Name</p>
            <p className="mt-1 truncate text-[12px] text-white/70" title={row.DESCRIPTION ?? ''}>{row.DESCRIPTION ?? '—'}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function HoldingsView({ rows, accounts, onUploadClick }) {
  const [expandedKey, setExpandedKey] = useState(null)

  if (!accounts.length && !rows.length) return <EmptyState onUploadClick={onUploadClick} />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Holdings</h2>
        <span className="rounded-full border border-white/[0.06] bg-wall-surface px-3 py-1 text-xs text-white/40">
          {accounts.length} accounts · {rows.length} positions
        </span>
      </div>

      {accounts.map((account, accountIndex) => {
        const acct = account.accountNumber
        const acctRows = account.positions
        const acctStats = account.stats
        const acctPositive = acctStats.totalPnl >= 0

        return (
          <Reveal key={acct} delay={accountIndex * 80}>
          <div className="overflow-hidden rounded-card border border-white/[0.06] bg-wall-surface shadow-card">
            {/* Account header — one big number, one colored return */}
            <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-4 pt-5 sm:px-5">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/35">
                  Account {acct}
                </p>
                <p className="mt-1.5 font-display text-[26px] font-medium leading-none tabular text-white">
                  {fmtCurrency(acctStats.totalMarketValue)}
                </p>
                <ReturnText
                  amount={acctStats.totalPnl}
                  pct={fmtPct(acctStats.totalPnlPct)}
                  className="mt-2"
                />
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium tabular ${acctStats.totalDayChange >= 0 ? 'bg-gain/10 text-gain' : 'bg-loss/10 text-loss'}`}>
                  {acctStats.totalDayChange >= 0 ? '+' : ''}{fmtCurrency(acctStats.totalDayChange)} today
                </span>
                {account.cash !== 0 && (
                  <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] tabular text-white/45">
                    {fmtCurrency(account.cash)} cash
                  </span>
                )}
              </div>
            </div>

            {/* Positions */}
            <div className="divide-y divide-white/[0.04] border-t border-white/[0.05]">
              {acctRows.length === 0 && (
                <div className="px-5 py-4 text-sm text-white/40">No open positions in this account.</div>
              )}
              {acctRows.map((row, i) => {
                const key = `${acct}:${i}`
                return (
                  <PositionRow
                    key={key}
                    row={row}
                    expanded={expandedKey === key}
                    onToggle={() => setExpandedKey(expandedKey === key ? null : key)}
                  />
                )
              })}

              {account.cash !== 0 && (
                <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gain/15 text-[15px] font-semibold text-gain">$</div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[14px] font-semibold text-white">Cash</span>
                    <p className="mt-0.5 text-[12px] text-white/35">
                      {account.cashSource === 'explicit' ? 'From file' : account.cashSource === 'inferred' ? 'Inferred' : 'Balance'} · {account.currency || 'CAD'}
                    </p>
                  </div>
                  <p className="text-[14px] font-semibold tabular text-white">{fmtCurrency(account.cash)}</p>
                </div>
              )}
            </div>

            {/* Footer — quiet stats strip */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-white/[0.05] bg-white/[0.02] px-4 py-3 text-[11px] tabular sm:px-5">
              <span className="text-white/30">Book cost <span className="ml-1 text-white/55">{fmtCurrency(acctStats.totalBookValue)}</span></span>
              <span className="text-white/30">Total P&L <span className={`ml-1 ${acctPositive ? 'text-gain' : 'text-loss'}`}>{fmtCurrency(acctStats.totalPnl)} ({fmtPct(acctStats.totalPnlPct)})</span></span>
              <span className="text-white/30">Today <span className={`ml-1 ${acctStats.totalDayChange >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtCurrency(acctStats.totalDayChange)}</span></span>
            </div>
          </div>
          </Reveal>
        )
      })}
    </div>
  )
}
