import { useCallback, useRef, useState } from 'react'
import { fmtCurrency, fmtPct } from '../../utils/portfolioStats'
import ChangedValue from '../../components/ChangedValue'

// Four figures on a ruled line rather than four boxes. The hero chart above is
// unframed too, so a card here would draw a border around the quieter half of
// the same thought.
function Cell({ label, children }) {
  return (
    <div className="min-w-0 sm:px-6 sm:first:pl-0 sm:last:pr-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/45">{label}</p>
      {children}
    </div>
  )
}

function Value({ value, children, className = 'text-ink' }) {
  return (
    <ChangedValue
      as="p"
      value={value}
      className={`mt-2 truncate rounded font-display text-[21px] font-medium leading-none tracking-tight tabular sm:text-[23px] ${className}`}
    >
      {children}
    </ChangedValue>
  )
}

function Sub({ children }) {
  return <p className="mt-2 truncate text-[11.5px] tabular text-ink/45">{children}</p>
}

function CashCell({ totalCash, share, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  const open = useCallback(() => {
    setDraft(totalCash !== 0 ? String(totalCash) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [totalCash])

  const save = useCallback(() => {
    const num = parseFloat(draft.replace(/[^0-9.-]/g, ''))
    if (!Number.isNaN(num)) onSave(num)
    setEditing(false)
  }, [draft, onSave])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') setEditing(false)
  }, [save])

  if (editing) {
    return (
      <Cell label="Cash">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={save}
          aria-label="Cash balance"
          className="mt-1.5 w-full max-w-[10rem] rounded-lg border border-ink/20 bg-ink/[0.04] px-2 py-1 font-display text-[19px] font-medium tabular text-ink outline-none placeholder:text-ink/25 focus:border-ink/40"
          placeholder="0.00"
        />
        <Sub>Press Enter to save</Sub>
      </Cell>
    )
  }

  return (
    <Cell label="Cash">
      <div className="mt-2 flex items-baseline gap-1.5">
        <ChangedValue as="p" value={totalCash} className="truncate rounded font-display text-[21px] font-medium leading-none tracking-tight tabular text-ink sm:text-[23px]">
          {fmtCurrency(totalCash)}
        </ChangedValue>
        {/* Editing cash is a rare correction, so it gets an affordance the size
            of its importance instead of the dashed button that used to sit
            under the number and outweigh it. */}
        <button
          type="button"
          onClick={open}
          aria-label="Set cash manually"
          title="Set cash manually"
          className="-my-1 shrink-0 rounded-md p-1 text-ink/25 transition-colors hover:text-ink/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      </div>
      {totalCash !== 0 && <Sub>{share.toFixed(1)}% of total</Sub>}
    </Cell>
  )
}

export default function StatRail({ rows, stats, accounts, onCashOverride }) {
  const cashShare = stats.totalMarketValue > 0 ? (stats.totalCashValue / stats.totalMarketValue) * 100 : 0
  const dayCls = stats.totalDayChange > 0 ? 'text-gain' : stats.totalDayChange < 0 ? 'text-loss' : 'text-ink'
  const pnlCls = stats.totalPnl > 0 ? 'text-gain' : stats.totalPnl < 0 ? 'text-loss' : 'text-ink'

  return (
    <div className="my-7 grid grid-cols-2 gap-x-6 gap-y-7 border-y border-ink/[0.09] py-6 sm:grid-cols-4 sm:gap-x-0 sm:gap-y-0 sm:divide-x sm:divide-ink/[0.09]">
        <Cell label="Today">
          <Value value={stats.totalDayChange} className={dayCls}>
            {stats.totalDayChange >= 0 ? '+' : ''}{fmtCurrency(stats.totalDayChange)}
          </Value>
          <Sub>{fmtPct(stats.dayChangePct)}</Sub>
        </Cell>

        {/* "Return" alone left one real question unanswered — since when? — and
            "all time" didn't answer it, it just moved the ambiguity into the
            caption. "Total return" is the standard term for this exact figure
            (cumulative gain or loss against what you paid), so the label now
            carries the meaning on its own and the caption is free to be just
            the number, the same shape as Today's. */}
        <Cell label="Total return">
          <Value value={stats.totalPnl} className={pnlCls}>
            {stats.totalPnl >= 0 ? '+' : ''}{fmtCurrency(stats.totalPnl)}
          </Value>
          <Sub>{fmtPct(stats.totalPnlPct)}</Sub>
        </Cell>

        <CashCell totalCash={stats.totalCashValue} share={cashShare} onSave={onCashOverride} />

        {/* "Positions" here, "Holdings" on the tab one row up — two words for
            the thing this whole page is about. Matches the vocabulary
            CompositionPanel and the Holdings tab already use. */}
        <Cell label="Holdings">
          <Value value={rows.length}>{rows.length}</Value>
          <Sub>across {accounts.length} account{accounts.length === 1 ? '' : 's'}</Sub>
        </Cell>
    </div>
  )
}
