import { useEffect, useMemo, useState } from 'react'
import Modal, { ModalHeader } from '../../components/Modal'
import PlaidLinkButton from '../../components/PlaidLinkButton'
import { fmtCurrency } from '../../utils/portfolioStats'
import { accountSources, sourceLabel } from '../../utils/accountMerge'

// Copy is deliberately thin here. An overlay this size is read at a glance, and
// every sentence explaining the flow is a sentence competing with the two
// choices that are the flow.

function Option({ icon, title, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-xl border border-ink/[0.09] px-4 py-3.5 text-left transition-colors hover:border-ink/[0.18] hover:bg-ink/[0.03]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink/[0.06] text-ink/70">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[12.5px] text-ink/40">{hint}</span>
      </span>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink/25">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}

// A section marker. The eyebrow is the only structural device in here, so it
// stays consistent: same size, same tracking, same colour, everywhere.
function Eyebrow({ children, className = '' }) {
  return (
    <p className={`text-[10.5px] font-semibold uppercase tracking-[0.11em] text-ink/35 ${className}`}>
      {children}
    </p>
  )
}

// The choice is exclusive, so it stays a radio to a screen reader — but the
// marker moves to the right and becomes a check. A column of empty circles down
// the left edge is the loudest thing on a panel whose subject is a number.
function Destination({ label, detail, selected, onClick }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 ${
        selected ? 'bg-ink/[0.05]' : 'hover:bg-ink/[0.03]'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13.5px] transition-colors ${
          selected ? 'font-medium text-ink' : 'text-ink/70'
        }`}>
          {label}
        </span>
        {detail && <span className="mt-0.5 block truncate text-[11.5px] text-ink/35">{detail}</span>}
      </span>
      <svg
        aria-hidden="true"
        width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
        strokeLinecap="round" strokeLinejoin="round"
        className={`shrink-0 text-accent transition-opacity duration-150 dark:text-ink ${selected ? 'opacity-100' : 'opacity-0'}`}
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </button>
  )
}

function AccountChoice({ label, detail, checked, onToggle }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
    >
      <span className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
        checked ? 'border-accent bg-accent dark:border-ink dark:bg-ink' : 'border-ink/25'
      }`}>
        {checked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" strokeWidth="3.5"
            strokeLinecap="round" strokeLinejoin="round"
            className="stroke-white dark:stroke-wall-surface">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-ink">{label}</span>
        {detail && <span className="mt-0.5 block truncate text-[12px] text-ink/40">{detail}</span>}
      </span>
    </button>
  )
}

// Folded away by default. Every line here used to be the same green plus at the
// same weight, which is five ways of saying the one thing the headline already
// says. Closed, it is a count; open, colour means something again because only
// the exceptions carry it.
function Changes({ preview, open, onToggle }) {
  const { added, updated, removed, keptFromOtherSources, beforeTotal, afterTotal } = preview
  const lines = [
    ...added.map((x) => ({ k: `a${x.symbol}`, symbol: x.symbol, detail: `${x.quantity} shares`, amount: x.value, tone: 'text-ink/60' })),
    ...updated.map((x) => ({ k: `u${x.symbol}`, symbol: x.symbol, detail: `${x.fromQuantity} → ${x.toQuantity} shares`, amount: x.toValue - x.fromValue, tone: 'text-ink/60' })),
    ...removed.map((x) => ({ k: `r${x.symbol}`, symbol: x.symbol, detail: 'not in this import', amount: -x.value, tone: 'text-loss' })),
  ]

  if (lines.length === 0) {
    return <p className="text-[12.5px] text-ink/40">Nothing changes — this is already loaded.</p>
  }

  const summary = [
    added.length && `${added.length} new`,
    updated.length && `${updated.length} updated`,
    removed.length && `${removed.length} removed`,
  ].filter(Boolean).join(' · ')

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
      >
        <Eyebrow>Detail</Eyebrow>
        <span className="truncate text-[11.5px] text-ink/30">{summary}</span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
          strokeLinecap="round" strokeLinejoin="round"
          className={`ml-auto shrink-0 text-ink/25 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-1">
          {lines.map((l) => (
            <div key={l.k} className="flex items-baseline gap-3 py-[5px]">
              <span className="w-16 shrink-0 truncate text-[12.5px] font-medium text-ink/85">{l.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink/35">{l.detail}</span>
              <span className={`shrink-0 font-mono text-[12px] tabular ${l.tone}`}>
                {l.amount >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(l.amount))}
              </span>
            </div>
          ))}

          {/* Only meaningful when the account already held something. On a new
              account this read "$0.00 → $49,360.80", which looks like a bug. */}
          {beforeTotal > 0 && (
            <div className="mt-2.5 flex items-baseline justify-between border-t border-ink/[0.07] pt-2.5">
              <span className="text-[11.5px] text-ink/35">
                {keptFromOtherSources > 0 ? `${keptFromOtherSources} kept from other imports` : 'This account'}
              </span>
              <span className="font-mono text-[12px] tabular text-ink/40">
                {fmtCurrency(beforeTotal)}
                <span className="mx-1.5 text-ink/25">→</span>
                <span className="font-semibold text-ink">{fmtCurrency(afterTotal)}</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AddAccountModal({
  open, onClose,
  accounts = [], error, loading, loadingMsg, inputRef, isDragging, userId,
  pending, preview, busy,
  discovered, onImportDiscovered,
  onDragOver, onDragLeave, onDrop, onFile,
  onPlaidAccounts, onPlaidConnecting, onPlaidError,
  onChooseDestination, onConfirm, onCancel,
}) {
  const [mode, setMode] = useState(null)
  const [chosen, setChosen] = useState(null)
  const [picked, setPicked] = useState([])
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => { if (open) setMode(null) }, [open])

  // Seed from the server's default (investment accounts), so the common case
  // is one tap to confirm rather than a checklist to work through.
  useEffect(() => {
    if (!discovered) { setPicked([]); return }
    setPicked(discovered.enabledAccountIds?.length
      ? discovered.enabledAccountIds
      : discovered.accounts.map((a) => a.id))
  }, [discovered])

  useEffect(() => {
    if (!pending) { setChosen(null); return }
    setDetailOpen(false)
    const initial = { mode: 'new', accountNumber: pending.suggestedAccountNumber }
    setChosen(initial)
    onChooseDestination?.(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.sourceId])

  const pick = (value) => { setChosen(value); onChooseDestination?.(value) }

  const sourcesByAccount = useMemo(() => Object.fromEntries(
    accounts.map((a) => [a.accountNumber, accountSources(a)]),
  ), [accounts])

  const describe = (a) => {
    const feeds = (sourcesByAccount[a.accountNumber] ?? []).map((s) => sourceLabel(s.id))
    return `${a.positions.length} holding${a.positions.length === 1 ? '' : 's'}${feeds.length ? ` · ${feeds[0]}` : ''}`
  }

  // What this statement is worth, independent of where it lands — so the
  // headline figure holds still while you choose between destinations.
  const incomingTotal = useMemo(() => {
    if (!preview) return null
    const add = preview.added.reduce((s, x) => s + x.value, 0)
    const upd = preview.updated.reduce((s, x) => s + x.toValue, 0)
    return add + upd
  }, [preview])

  const target = chosen?.mode === 'new' ? 'new account' : chosen?.accountNumber
  const back = pending ? onCancel : mode ? () => setMode(null) : undefined
  const togglePick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const holdingCount = pending?.rows.length ?? 0

  return (
    <Modal open={open} onClose={onClose} labelledBy="add-account-title">
      <ModalHeader
        id="add-account-title"
        title={discovered ? (discovered.institutionName || 'Connected') : pending ? pending.name : 'Add an account'}
        subtitle={discovered ? 'Choose what to bring in' : undefined}
        onBack={discovered ? undefined : back}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {loading && (
          <div className="flex flex-col items-center py-14">
            <div className="relative h-8 w-8">
              <div className="absolute inset-0 rounded-full border border-ink/[0.1]" />
              <div className="absolute inset-0 animate-spin rounded-full border border-ink/60 border-t-transparent" />
            </div>
            <p className="mt-4 text-[12.5px] text-ink/45">{loadingMsg}</p>
          </div>
        )}

        {/* Which accounts to import */}
        {!loading && discovered && (
          <div className="-mx-3">
            {discovered.accounts.map((a) => (
              <AccountChoice
                key={a.id}
                label={a.officialName || a.name || 'Account'}
                detail={[a.subtype || a.type, a.mask ? `••${a.mask}` : null].filter(Boolean).join(' · ')}
                checked={picked.includes(a.id)}
                onToggle={() => togglePick(a.id)}
              />
            ))}
            <p className="mt-3 px-3 text-[11.5px] leading-relaxed text-ink/30">
              Only what you tick is read. Your bank may require connecting other
              accounts — they stay out of WallAI.
            </p>
          </div>
        )}

        {/* Pick a source */}
        {!loading && !pending && !discovered && !mode && (
          <div className="space-y-2">
            <Option
              title="Import a statement"
              hint="CSV, XLSX or PDF"
              onClick={() => setMode('file')}
              icon={(
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
                </svg>
              )}
            />
            <Option
              title="Connect a brokerage"
              hint="Sign in securely"
              onClick={() => setMode('connect')}
              icon={(
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
                </svg>
              )}
            />
          </div>
        )}

        {!loading && !pending && !discovered && mode === 'file' && (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`cursor-pointer rounded-xl border border-dashed px-6 py-12 text-center transition-colors ${
              isDragging ? 'border-ink/30 bg-ink/[0.05]' : 'border-ink/[0.14] hover:border-ink/25 hover:bg-ink/[0.02]'
            }`}
          >
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden"
              onChange={(e) => onFile(e.target.files[0])} />
            <p className="text-[14px] font-medium text-ink">{isDragging ? 'Drop it' : 'Drop a file'}</p>
            <p className="mt-1 text-[12.5px] text-ink/40">
              or <span className="text-ink/60 underline underline-offset-4">browse</span>
            </p>
          </div>
        )}

        {!loading && !pending && !discovered && mode === 'connect' && (
          <div>
            <PlaidLinkButton userId={userId} onAccounts={onPlaidAccounts} onConnecting={onPlaidConnecting} onError={onPlaidError} />
            <p className="mt-3 text-[11.5px] leading-relaxed text-ink/30">
              Canadian coverage is patchy. Import a statement if yours is missing.
            </p>
          </div>
        )}

        {/* Review. The sum is the subject of this screen — the whole decision is
            where it lands — so it leads at a size nothing else competes with,
            and the rest of the panel stays quiet underneath it. */}
        {!loading && !discovered && pending && (
          <>
            <div className="pb-5 pt-1.5">
              <p className="font-display text-[32px] font-medium leading-none tracking-[-0.03em] tabular text-ink">
                {incomingTotal != null ? fmtCurrency(incomingTotal) : '—'}
              </p>
              <p className="mt-2 text-[12.5px] text-ink/40">
                {holdingCount} holding{holdingCount === 1 ? '' : 's'} to import
              </p>
            </div>

            <div className="border-t border-ink/[0.07] pt-4">
              <Eyebrow className="mb-1.5 px-3">Where it goes</Eyebrow>
              <div className="-mx-3" role="radiogroup" aria-label="Destination account">
                <Destination
                  label="New account"
                  detail={pending.suggestedAccountNumber}
                  selected={chosen?.mode === 'new'}
                  onClick={() => pick({ mode: 'new', accountNumber: pending.suggestedAccountNumber })}
                />
                {accounts.map((a) => (
                  <Destination
                    key={a.accountNumber}
                    label={a.accountNumber}
                    detail={describe(a)}
                    selected={chosen?.mode === 'existing' && chosen.accountNumber === a.accountNumber}
                    onClick={() => pick({ mode: 'existing', accountNumber: a.accountNumber })}
                  />
                ))}
              </div>
            </div>

            {preview && (
              <div className="mt-4 border-t border-ink/[0.07] pt-3.5">
                {/* Only the surprising case earns a sentence. Adding alongside is
                    what the ledger already shows; replacing is not. */}
                {preview.isKnownSource && (
                  <p className="mb-2.5 text-[12.5px] leading-snug text-ink/50">
                    Imported before — this replaces what it loaded last time.
                  </p>
                )}
                <Changes preview={preview} open={detailOpen} onToggle={() => setDetailOpen((v) => !v)} />
              </div>
            )}
          </>
        )}

        {error && <p className="mt-4 text-[12.5px] text-loss/90">{error}</p>}
      </div>

      {!loading && discovered && (
        <div className="border-t border-ink/[0.07] p-4">
          <button
            type="button"
            onClick={() => onImportDiscovered?.(picked)}
            disabled={busy || picked.length === 0}
            className="w-full rounded-xl bg-accent py-2.5 text-[13.5px] font-semibold text-wall-surface transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-ink"
          >
            {busy ? 'Importing…' : picked.length === 0 ? 'Pick at least one' : `Import ${picked.length} account${picked.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {!loading && !discovered && pending && (
        <div className="border-t border-ink/[0.07] p-4">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !preview}
            className="w-full rounded-xl bg-accent py-2.5 text-[13.5px] font-semibold text-wall-surface transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-ink"
          >
            {busy ? 'Adding…' : `Add to ${target}`}
          </button>
        </div>
      )}
    </Modal>
  )
}
