import CompanyLogo from '../../components/CompanyLogo'
import { fmtCurrency } from '../../utils/portfolioStats'
import { accountSources, sourceLabel } from '../../utils/accountMerge'

// The page is the list of what you have; adding is a task that opens over it.
// Previously this page *was* the add form, which meant the thing you look at
// most often was a pair of upload boxes.

function AddButton({ onClick, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={primary
        ? 'rounded-xl bg-white px-5 py-2.5 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90'
        : 'flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-3.5 py-2 text-[13px] font-medium text-white/70 transition-colors hover:border-white/[0.16] hover:text-white'}
    >
      {!primary && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      )}
      Add account
    </button>
  )
}

export default function AccountsView({ accounts = [], onAdd }) {
  if (accounts.length === 0) {
    return (
      <div className="mx-auto flex max-w-[420px] flex-col items-center py-24 text-center">
        <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-white">No accounts yet</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-white/45">
          Import a statement or connect a brokerage to get started.
        </p>
        <div className="mt-7">
          <AddButton onClick={onAdd} primary />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-white">Accounts</h2>
        <AddButton onClick={onAdd} />
      </div>

      <div className="space-y-2.5">
        {accounts.map((account) => {
          const feeds = accountSources(account)
          const top = [...account.positions]
            .sort((a, b) => Number(b['MARKET VALUE'] ?? 0) - Number(a['MARKET VALUE'] ?? 0))
            .slice(0, 5)

          return (
            <div key={account.accountNumber} className="rounded-2xl border border-white/[0.06] bg-wall-surface px-5 py-4">
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-semibold text-white">{account.accountNumber}</p>
                  <p className="mt-0.5 truncate text-[12px] text-white/35">
                    {feeds.map((f) => sourceLabel(f.id)).join(' · ') || 'no statements yet'}
                  </p>
                </div>
                <p className="shrink-0 text-[15px] font-semibold tabular text-white">
                  {fmtCurrency(account.stats?.totalMarketValue ?? 0)}
                </p>
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
                <span className="text-[12px] text-white/35">
                  {account.positions.length} holding{account.positions.length === 1 ? '' : 's'}
                  {account.cash !== 0 && ` · ${fmtCurrency(account.cash)} cash`}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
