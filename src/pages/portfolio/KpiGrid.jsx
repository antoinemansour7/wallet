import { useCallback, useRef, useState } from 'react'
import { fmtCurrency, fmtPct } from '../../utils/portfolioStats'
import StatCard from './StatCard'

function CashEditor({ totalCash, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  const open = useCallback(() => {
    setDraft(totalCash !== 0 ? String(totalCash) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [totalCash])

  const save = useCallback(() => {
    const num = parseFloat(draft.replace(/[^0-9.\-]/g, ''))
    if (!Number.isNaN(num)) onSave(num)
    setEditing(false)
  }, [draft, onSave])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') setEditing(false)
  }, [save])

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-white/40">$</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={save}
          className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 font-mono text-xs text-white outline-none placeholder:text-white/20 focus:border-white/20"
          placeholder="0.00"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={open}
      className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/10 px-2.5 py-1.5 text-[11px] text-white/30 transition-colors hover:border-white/20 hover:text-white/50"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
      Set cash manually
    </button>
  )
}

export default function KpiGrid({ rows, stats, accounts, onCashOverride }) {
  const cashShare = stats.totalMarketValue > 0 ? (stats.totalCashValue / stats.totalMarketValue) * 100 : 0
  const cashSub = stats.totalCashValue !== 0
    ? `${cashShare.toFixed(1)}% of portfolio value`
    : 'No cash balance tracked'
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard label="Total Value" value={fmtCurrency(stats.totalMarketValue)} sub={`${rows.length} positions`} />
      <StatCard
        label="Cash Balance"
        value={fmtCurrency(stats.totalCashValue)}
        sub={cashSub}
        tone={stats.totalCashValue !== 0 ? 'accent' : 'neutral'}
        action={<CashEditor totalCash={stats.totalCashValue} onSave={onCashOverride} />}
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
