import { useEffect, useMemo, useRef, useState } from 'react'
import Modal, { ModalClose } from '../../components/Modal'
import CompanyLogo from '../../components/CompanyLogo'
import { fmtCurrency } from '../../utils/portfolioStats'
import { accountSources, sourceLabel, positionSource } from '../../utils/accountMerge'
import { Group, Tile } from './listGroup'

// What an account is actually made of. An account is not one thing — it is one
// or more imports stacked on top of each other, and until you can see them
// separately there is no way to undo one without starting over.

const isConnected = (id) => String(id).startsWith('plaid:')

const IconLink = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
)

const IconFile = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
  </svg>
)

/**
 * An import, and what it is worth. The money sits at the right edge where the
 * eye already goes for it — it used to be buried in grey subtitle text while
 * the word "Remove" owned that edge, printed once per row, which made the
 * loudest thing on a panel about a balance the way to destroy it.
 */
function Feed({ feed, onRemove, busy, dimmed, expanded }) {
  const label = sourceLabel(feed.id)
  return (
    // While one import is being confirmed the others step back and stop
    // answering, so the question on screen has one answer rather than three.
    <div className={`flex items-center gap-3.5 px-4 py-3.5 transition-opacity duration-motion-short ${
      dimmed ? 'pointer-events-none opacity-35' : ''
    }`}>
      <Tile>{isConnected(feed.id) ? <IconLink /> : <IconFile />}</Tile>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{label}</p>
        <p className="mt-0.5 truncate text-[13px] text-ink/45">
          {feed.positions} holding{feed.positions === 1 ? '' : 's'}
        </p>
      </div>

      <span className="shrink-0 text-[14px] font-medium tabular text-ink/70">{fmtCurrency(feed.value)}</span>

      <button
        type="button"
        onClick={onRemove}
        disabled={busy || expanded}
        aria-label={`Remove ${label}`}
        tabIndex={dimmed ? -1 : undefined}
        className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink/40 transition-colors duration-motion-short hover:bg-loss/10 hover:text-loss disabled:opacity-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3" />
        </svg>
      </button>
    </div>
  )
}

/** The pair of choices every confirmation in this sheet ends with. */
function ConfirmActions({ busy, onCancel, onConfirm, label = 'Remove' }) {
  return (
    <div className="mt-3.5 flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="h-9 rounded-[10px] px-3.5 text-[13.5px] font-medium text-ink/55 transition-colors duration-motion-short hover:bg-ink/[0.05] hover:text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        // Tinted, not a saturated slab. Filled loss put the brightest thing in
        // the sheet on the button that destroys holdings, which is the wrong
        // thing to draw the eye — the arithmetic above it is.
        className="h-9 rounded-[10px] border border-loss/30 bg-loss/[0.12] px-4 text-[13.5px] font-semibold text-loss transition-colors duration-motion-short hover:bg-loss/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-loss/40 focus-visible:ring-offset-2 focus-visible:ring-offset-wall-surface"
      >
        {busy ? 'Removing…' : label}
      </button>
    </div>
  )
}

/**
 * An account with no imports left.
 *
 * Imports are counted from positions, so an account holding only cash has none
 * and this sheet — which removes one import at a time — had nothing to show and
 * no way out of the account. Reachable honestly with a cash-only statement, and
 * also where the phantom-cash bug stranded people: no holdings, a balance
 * nobody deposited, and every route out greyed into nothing.
 */
function NoImports({ account, busy, confirming, onStart, onCancel, onConfirm }) {
  return (
    <div className="rounded-2xl border border-ink/[0.08] px-4 py-4">
      {confirming ? (
        <div className="modal-step">
          <p className="text-[13px] leading-relaxed text-ink/65">
            Deletes account {account.accountNumber} and the {fmtCurrency(account.cash)} recorded
            against it. There are no holdings left in it.
          </p>
          <ConfirmActions busy={busy} onCancel={onCancel} onConfirm={onConfirm} label="Remove account" />
        </div>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-ink/55">
            No imports left — only a cash balance.
          </p>
          {/* Its own right-aligned row rather than sharing the sentence's line:
              at this width the two only just failed to fit, and a button that
              wraps under its label reads as a mistake. This is also where every
              other action in this sheet sits. */}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onStart}
              disabled={busy}
              className="-mr-1.5 h-9 rounded-[10px] px-3 text-[13.5px] font-medium text-ink/55 transition-colors duration-motion-short hover:bg-loss/10 hover:text-loss disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
            >
              Remove account
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Removing loses holdings, so it asks — in the row it belongs to, so the other
 * imports you are keeping stay on screen and you keep your place. It used to
 * replace the whole list with a red panel, which hid what the account was made
 * of at exactly the moment that mattered.
 *
 * The arithmetic is the point, and it is the same before → after line the add
 * sheet shows. Adding a statement and removing one are the same operation in
 * opposite directions, so they say so the same way.
 */
function ConfirmRemove({ feed, total, accountNumber, lastOne, onCancel, onConfirm, busy }) {
  const after = total - feed.value
  const connected = isConnected(feed.id)
  const n = `${feed.positions} holding${feed.positions === 1 ? '' : 's'}`

  return (
    <div className="modal-step px-4 pb-4 pl-4 pt-0.5 sm:pl-[66px]">
      {/* Say what is deleted, name it, and name what it takes with it. The old
          wording — "5 holdings leave this account", "the account goes with it" —
          described a deletion as a departure and never said where anything
          went, which is the one thing you need before pressing a red button. */}
      <p className="text-[13px] leading-relaxed text-ink/65">
        {connected
          ? `Deletes the ${n} from this connection and disconnects ${sourceLabel(feed.id)}.`
          : `Deletes the ${n} this file added.`}
        {lastOne && ` This is the only import in account ${accountNumber}, so the account is deleted too.`}
      </p>

      {!lastOne && (
        <p className="mt-2.5 font-mono text-[13px] tabular text-ink/40">
          {fmtCurrency(total)}
          <span className="mx-1.5 text-ink/25">→</span>
          <span className="font-semibold text-ink">{fmtCurrency(after)}</span>
        </p>
      )}

      <p className="mt-2 text-[12.5px] leading-relaxed text-ink/40">
        {connected ? 'You can connect it again later.' : 'You can import the file again later.'}
      </p>

      <ConfirmActions busy={busy} onCancel={onCancel} onConfirm={onConfirm} />
    </div>
  )
}

export default function AccountDetailModal({ open, account, onClose, onRemoveSource, onRemoveAccount, busy }) {
  const [confirming, setConfirming] = useState(null)
  const [confirmingAccount, setConfirmingAccount] = useState(false)
  const lastAccount = useRef(null)
  if (account) lastAccount.current = account
  const displayedAccount = account ?? lastAccount.current

  // The panel is mounted for the life of the page, so a half-answered
  // confirmation would otherwise follow you into the next account it opens —
  // where its id matches nothing, leaving every row dimmed and unanswerable.
  useEffect(() => {
    setConfirming(null)
    setConfirmingAccount(false)
  }, [open, displayedAccount?.accountNumber])

  const feeds = useMemo(() => {
    if (!displayedAccount) return []
    return accountSources(displayedAccount).map((feed) => ({
      ...feed,
      value: (displayedAccount.positions ?? [])
        .filter((p) => positionSource(p) === feed.id)
        .reduce((sum, p) => sum + Number(p['MARKET VALUE'] ?? 0), 0),
    }))
  }, [displayedAccount])

  const top = useMemo(() => (
    [...(displayedAccount?.positions ?? [])]
      .sort((a, b) => Number(b['MARKET VALUE'] ?? 0) - Number(a['MARKET VALUE'] ?? 0))
      .slice(0, 8)
  ), [displayedAccount])

  if (!displayedAccount) return null

  const total = displayedAccount.stats?.totalMarketValue ?? 0
  const holdings = displayedAccount.positions.length

  return (
    <Modal open={open} onClose={onClose} labelledBy="account-detail-title">
      <ModalClose onClose={onClose} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-5">
        <div className="px-1 pb-6">
          <h2 id="account-detail-title" className="pr-10 text-[13.5px] font-medium text-ink/45">
            Account {displayedAccount.accountNumber}
          </h2>
          <p className="mt-1.5 font-display text-[34px] font-medium leading-none tracking-[-0.035em] tabular text-ink">
            {fmtCurrency(total)}
          </p>

          {/* The logos caption the line rather than floating above it in a strip
              of their own, which is all they were doing before. */}
          <div className="mt-3 flex items-center gap-2.5">
            {top.length > 0 && (
              <div className="flex shrink-0 -space-x-2">
                {top.map((p) => (
                  <span key={p.SYMBOL} className="rounded-full ring-2 ring-wall-surface">
                    <CompanyLogo symbol={p.SYMBOL} description={p.DESCRIPTION} size={24} />
                  </span>
                ))}
              </div>
            )}
            <p className="text-[13.5px] text-ink/45">
              {holdings} holding{holdings === 1 ? '' : 's'}
              {displayedAccount.cash !== 0 && ` · ${fmtCurrency(displayedAccount.cash)} cash`}
            </p>
          </div>
        </div>

        <p className="mb-2 px-1 text-[13.5px] font-medium text-ink/55">
          {feeds.length === 1 ? 'Import' : 'Imports'}
        </p>

        {feeds.length === 0 ? (
          <NoImports
            account={displayedAccount}
            busy={busy}
            confirming={confirmingAccount}
            onStart={() => setConfirmingAccount(true)}
            onCancel={() => setConfirmingAccount(false)}
            onConfirm={async () => {
              await onRemoveAccount?.(displayedAccount.accountNumber)
              setConfirmingAccount(false)
            }}
          />
        ) : (
        <Group>
          {feeds.map((feed) => {
            const expanded = confirming === feed.id
            return (
              <div key={feed.id}>
                <Feed
                  feed={feed}
                  busy={busy}
                  expanded={expanded}
                  dimmed={Boolean(confirming) && !expanded}
                  onRemove={() => setConfirming(feed.id)}
                />
                {expanded && (
                  <ConfirmRemove
                    feed={feed}
                    total={total}
                    accountNumber={displayedAccount.accountNumber}
                    lastOne={feeds.length === 1}
                    busy={busy}
                    onCancel={() => setConfirming(null)}
                    onConfirm={async () => {
                      await onRemoveSource?.(displayedAccount.accountNumber, feed.id)
                      setConfirming(null)
                    }}
                  />
                )}
              </div>
            )
          })}
        </Group>
        )}
      </div>
    </Modal>
  )
}
