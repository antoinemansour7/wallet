import { useCallback, useRef, useState } from 'react'
import { fmtCurrency, fmtPct } from '../../utils/portfolioStats'
import Reveal from '../../components/Reveal'

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

function Stat({ label, value, valueCls = 'text-white', sub, action }) {
  return (
    <div className="min-w-0 flex-1 px-4 py-3.5 sm:px-5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/30">{label}</p>
      <p className={`mt-1 truncate text-[15px] font-semibold tabular ${valueCls}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] tabular text-white/30">{sub}</p>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  )
}

// Quiet single-strip stats under the hero chart — broker style, no giant
// KPI cards, no explainer sentences.
export default function KpiGrid({ rows, stats, accounts, onCashOverride }) {
  const cashShare = stats.totalMarketValue > 0 ? (stats.totalCashValue / stats.totalMarketValue) * 100 : 0
  const dayCls = stats.totalDayChange > 0 ? 'text-gain' : stats.totalDayChange < 0 ? 'text-loss' : 'text-white'
  const pnlCls = stats.totalPnl > 0 ? 'text-gain' : stats.totalPnl < 0 ? 'text-loss' : 'text-white'

  return (
    <Reveal>
      <div className="mb-5 mt-6 grid grid-cols-2 divide-white/[0.05] rounded-card border border-white/[0.06] bg-wall-surface shadow-card sm:flex sm:divide-x">
        <Stat
          label="Today"
          value={`${stats.totalDayChange >= 0 ? '+' : ''}${fmtCurrency(stats.totalDayChange)}`}
          valueCls={dayCls}
          sub={fmtPct(stats.dayChangePct)}
        />
        <Stat
          label="All-time return"
          value={`${stats.totalPnl >= 0 ? '+' : ''}${fmtCurrency(stats.totalPnl)}`}
          valueCls={pnlCls}
          sub={fmtPct(stats.totalPnlPct)}
        />
        <Stat
          label="Cash"
          value={fmtCurrency(stats.totalCashValue)}
          sub={stats.totalCashValue !== 0 ? `${cashShare.toFixed(1)}% of portfolio` : undefined}
          action={<CashEditor totalCash={stats.totalCashValue} onSave={onCashOverride} />}
        />
        <Stat
          label="Positions"
          value={String(rows.length)}
          sub={`across ${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
        />
      </div>
    </Reveal>
  )
}
