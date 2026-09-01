import { useMemo, useState } from 'react'
import Modal, { ModalHeader } from '../../components/Modal'
import CompanyLogo from '../../components/CompanyLogo'
import { fmtCurrency } from '../../utils/portfolioStats'
import { accountSources, sourceLabel, positionSource } from '../../utils/accountMerge'

// What an account is actually made of. An account is not one thing — it is one
// or more feeds stacked on top of each other, and until you can see them
// separately there is no way to undo one import without starting over.

const isConnected = (id) => String(id).startsWith('plaid:')

function FeedIcon({ connected }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-ink/[0.06] text-ink/55">
      {connected ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
        </svg>
      )}
    </span>
  )
}

function Feed({ feed, onRemove, busy }) {
  const connected = isConnected(feed.id)
  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      <FeedIcon connected={connected} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{sourceLabel(feed.id)}</p>
        <p className="mt-0.5 truncate text-[13px] text-ink/45">
          {feed.positions} holding{feed.positions === 1 ? '' : 's'} · {fmtCurrency(feed.value)}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium text-ink/45 transition-colors duration-150 hover:bg-loss/10 hover:text-loss disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
      >
        Remove
      </button>
    </div>
  )
}

/** Removing a feed loses holdings, so it asks — inline, not in a second modal. */
function ConfirmRemove({ feed, onCancel, onConfirm, busy }) {
  const connected = isConnected(feed.id)
  return (
    <div className="rounded-2xl border border-loss/25 bg-loss/[0.05] p-4">
      <p className="text-[14px] font-medium text-ink">
        Remove {sourceLabel(feed.id)}?
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink/55">
        {feed.positions} holding{feed.positions === 1 ? '' : 's'} worth {fmtCurrency(feed.value)} leave
        this account.{connected ? ' The brokerage connection is dropped too.' : ' You can import the file again later.'}
      </p>
      <div className="mt-3.5 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="h-10 flex-1 rounded-xl bg-loss text-[14px] font-semibold text-wall-surface transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss/40"
        >
          {busy ? 'Removing…' : 'Remove'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-10 flex-1 rounded-xl text-[14px] font-medium text-ink/60 transition-colors hover:bg-ink/[0.05] hover:text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
        >
          Keep it
        </button>
      </div>
    </div>
  )
}

export default function AccountDetailModal({ open, account, onClose, onRemoveSource, busy }) {
  const [confirming, setConfirming] = useState(null)

  const feeds = useMemo(() => {
    if (!account) return []
    const byId = accountSources(account)
    return byId.map((feed) => ({
      ...feed,
      value: (account.positions ?? [])
        .filter((p) => positionSource(p) === feed.id)
        .reduce((sum, p) => sum + Number(p['MARKET VALUE'] ?? 0), 0),
    }))
  }, [account])

  const top = useMemo(() => (
    [...(account?.positions ?? [])]
      .sort((a, b) => Number(b['MARKET VALUE'] ?? 0) - Number(a['MARKET VALUE'] ?? 0))
      .slice(0, 8)
  ), [account])

  if (!account) return null

  const lastOne = feeds.length === 1

  return (
    <Modal open={open} onClose={onClose} labelledBy="account-detail-title">
      <ModalHeader onClose={onClose} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
        <div className="px-1 pb-6 pt-1">
          <h2 id="account-detail-title" className="text-[13.5px] font-medium text-ink/45">
            Account {account.accountNumber}
          </h2>
          <p className="mt-1.5 font-display text-[34px] font-medium leading-none tracking-[-0.035em] tabular text-ink">
            {fmtCurrency(account.stats?.totalMarketValue ?? 0)}
          </p>
          <p className="mt-2 text-[13.5px] text-ink/45">
            {account.positions.length} holding{account.positions.length === 1 ? '' : 's'}
            {account.cash !== 0 && ` · ${fmtCurrency(account.cash)} cash`}
          </p>
        </div>

        {top.length > 0 && (
          <div className="mb-6 flex items-center gap-2 px-1">
            <div className="flex -space-x-2">
              {top.map((p) => (
                <span key={p.SYMBOL} className="rounded-full ring-2 ring-wall-surface">
                  <CompanyLogo symbol={p.SYMBOL} description={p.DESCRIPTION} size={24} />
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="mb-2 px-1 text-[13.5px] font-medium text-ink/55">
          {feeds.length === 1 ? 'Where it came from' : 'Where it came from'}
        </p>

        {confirming ? (
          <ConfirmRemove
            feed={confirming}
            busy={busy}
            onCancel={() => setConfirming(null)}
            onConfirm={async () => {
              await onRemoveSource?.(account.accountNumber, confirming.id)
              setConfirming(null)
            }}
          />
        ) : (
          <div className="divide-y divide-ink/[0.06] overflow-hidden rounded-2xl border border-ink/[0.08]">
            {feeds.map((feed) => (
              <Feed key={feed.id} feed={feed} busy={busy} onRemove={() => setConfirming(feed)} />
            ))}
          </div>
        )}

        {!confirming && lastOne && (
          <p className="mt-3.5 px-1 text-[12.5px] leading-relaxed text-ink/40">
            This is the only import in this account. Removing it removes the account.
          </p>
        )}
      </div>
    </Modal>
  )
}
