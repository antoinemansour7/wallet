import { useRef, useState } from 'react'
import CompanyLogo from '../../components/CompanyLogo'
import { fmtCurrency } from '../../utils/portfolioStats'
import { accountSources, sourceLabel } from '../../utils/accountMerge'
import { Group, Option, IconStatement, IconBrokerage } from './listGroup'

// The page is the list of what you have; adding is a task that opens over it.
// Previously this page *was* the add form, which meant the thing you look at
// most often was a pair of upload boxes.

function AddButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium text-ink/50 transition-colors duration-motion-short hover:bg-ink/[0.04] hover:text-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
      Add account
    </button>
  )
}

/**
 * An empty screen is an invitation to act, so this one is the chooser rather
 * than a sign pointing at one: the two routes in are the two routes in, not a
 * button that opens a sheet asking the same question again.
 *
 * It is also a drop target across its whole surface. Dropping a statement was
 * always supported and was buried two clicks deep inside the add sheet, which
 * is the one place you cannot drop a file onto until you have already decided
 * to import one.
 */
function EmptyAccounts({ onAdd, onFile }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const take = (file) => { if (file) onFile?.(file) }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer?.files?.[0]) }}
      className={`mx-auto max-w-[440px] rounded-[24px] border px-6 pb-9 pt-12 transition-colors duration-motion-short sm:px-8 ${
        dragging ? 'border-ink/25 bg-ink/[0.04]' : 'border-transparent'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.pdf"
        className="hidden"
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }}
      />

      <h2 className="font-display text-[27px] font-medium leading-[1.12] tracking-[-0.03em] text-ink">
        Add your first account
      </h2>
      <p className="mt-2.5 max-w-[36ch] text-[14px] leading-relaxed text-ink/45">
        Holdings, cash and returns are all built from what you import.
      </p>

      <Group className="mt-7">
        <Option
          icon={<IconStatement />}
          title="Import a statement"
          hint="CSV, XLSX or PDF"
          onClick={() => inputRef.current?.click()}
        />
        <Option
          icon={<IconBrokerage />}
          title="Connect a brokerage"
          hint="Sign in securely"
          onClick={() => onAdd?.('connect')}
        />
      </Group>

      <p className="mt-4 text-[12.5px] text-ink/35">
        {dragging ? 'Drop it to start reading.' : 'Or drop a statement anywhere on this panel.'}
      </p>
    </div>
  )
}

export default function AccountsView({ accounts = [], onAdd, onOpenAccount, onFile }) {
  if (accounts.length === 0) {
    return <EmptyAccounts onAdd={onAdd} onFile={onFile} />
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">Accounts</h2>
        <AddButton onClick={() => onAdd?.()} />
      </div>

      <div className="space-y-2.5">
        {accounts.map((account) => {
          const feeds = accountSources(account)
          const top = [...account.positions]
            .sort((a, b) => Number(b['MARKET VALUE'] ?? 0) - Number(a['MARKET VALUE'] ?? 0))
            .slice(0, 5)

          return (
            <button
              key={account.accountNumber}
              type="button"
              onClick={() => onOpenAccount?.(account)}
              className="block w-full rounded-2xl border border-ink/[0.07] bg-wall-surface px-5 py-4 text-left transition-colors duration-motion-short hover:border-ink/[0.14] hover:bg-ink/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
            >
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-semibold text-ink">{account.accountNumber}</p>
                  <p className="mt-0.5 truncate text-[12px] text-ink/35">
                    {feeds.map((f) => sourceLabel(f.id)).join(' · ') || 'no statements yet'}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[15px] font-semibold tabular text-ink">
                    {fmtCurrency(account.stats?.totalMarketValue ?? 0)}
                  </span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                    strokeLinecap="round" strokeLinejoin="round" className="text-ink/25">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </span>
              </div>

              {/* A glance at what is inside, so the row is worth looking at. */}
              <div className="mt-3.5 flex items-center gap-2">
                <div className="flex -space-x-2">
                  {top.map((p) => (
                    <span key={p.SYMBOL} className="ring-2 ring-wall-surface rounded-full">
                      <CompanyLogo symbol={p.SYMBOL} description={p.DESCRIPTION} size={22} />
                    </span>
                  ))}
                </div>
                <span className="text-[12px] text-ink/35">
                  {account.positions.length} holding{account.positions.length === 1 ? '' : 's'}
                  {account.cash !== 0 && ` · ${fmtCurrency(account.cash)} cash`}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
