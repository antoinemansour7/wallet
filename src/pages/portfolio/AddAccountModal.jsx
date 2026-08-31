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
      className="flex w-full items-center gap-3.5 rounded-xl border border-white/[0.07] px-4 py-3.5 text-left transition-colors hover:border-white/[0.16] hover:bg-white/[0.03]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white/70">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-white">{title}</span>
        <span className="mt-0.5 block text-[12.5px] text-white/40">{hint}</span>
      </span>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/25">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}

function Destination({ label, detail, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        selected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.035]'
      }`}
    >
      <span className={`h-[14px] w-[14px] shrink-0 rounded-full border transition-colors ${
        selected ? 'border-[4.5px] border-white' : 'border-white/25'
      }`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-white">{label}</span>
        {detail && <span className="mt-0.5 block truncate text-[12px] text-white/40">{detail}</span>}
      </span>
    </button>
  )
}

function Changes({ preview }) {
  const { added, updated, removed, keptFromOtherSources, beforeTotal, afterTotal } = preview
  const lines = [
    ...added.map((x) => ({ k: `a${x.symbol}`, sign: '+', symbol: x.symbol, detail: `${x.quantity} shares`, amount: x.value, tone: 'text-gain' })),
    ...updated.map((x) => ({ k: `u${x.symbol}`, sign: '', symbol: x.symbol, detail: `${x.fromQuantity} → ${x.toQuantity}`, amount: x.toValue - x.fromValue, tone: 'text-white/70' })),
    ...removed.map((x) => ({ k: `r${x.symbol}`, sign: '−', symbol: x.symbol, detail: 'not in this file', amount: -x.value, tone: 'text-loss' })),
  ]

  return (
    <div>
      {lines.length === 0 ? (
        <p className="py-2 text-[12.5px] text-white/40">Nothing changes — already loaded.</p>
      ) : lines.map((l) => (
        <div key={l.k} className="flex items-baseline gap-2.5 py-[5px]">
          <span className={`w-2.5 shrink-0 text-[12.5px] ${l.tone}`}>{l.sign}</span>
          <span className="w-14 shrink-0 text-[13px] font-medium text-white">{l.symbol}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-white/40">{l.detail}</span>
          <span className={`shrink-0 text-[12.5px] tabular ${l.tone}`}>
            {l.amount >= 0 ? '+' : ''}{fmtCurrency(l.amount)}
          </span>
        </div>
      ))}

      <div className="mt-3 flex items-baseline justify-between border-t border-white/[0.07] pt-3">
        <span className="text-[12px] text-white/40">
          {keptFromOtherSources > 0 ? `${keptFromOtherSources} existing kept` : 'Total'}
        </span>
        <span className="text-[13px] tabular text-white/45">
          {fmtCurrency(beforeTotal)}
          <span className="mx-1.5 text-white/25">→</span>
          <span className="font-semibold text-white">{fmtCurrency(afterTotal)}</span>
        </span>
      </div>
    </div>
  )
}

export default function AddAccountModal({
  open, onClose,
  accounts = [], error, loading, loadingMsg, inputRef, isDragging, userId,
  pending, preview, busy,
  onDragOver, onDragLeave, onDrop, onFile,
  onPlaidSuccess, onPlaidConnecting,
  onChooseDestination, onConfirm, onCancel,
}) {
  const [mode, setMode] = useState(null)
  const [chosen, setChosen] = useState(null)

  useEffect(() => { if (open) setMode(null) }, [open])

  useEffect(() => {
    if (!pending) { setChosen(null); return }
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

  const target = chosen?.mode === 'new' ? 'new account' : chosen?.accountNumber
  const back = pending ? onCancel : mode ? () => setMode(null) : undefined

  return (
    <Modal open={open} onClose={onClose} labelledBy="add-account-title">
      <ModalHeader
        id="add-account-title"
        title={pending ? pending.name : 'Add an account'}
        subtitle={pending ? `${pending.rows.length} holding${pending.rows.length === 1 ? '' : 's'}` : undefined}
        onBack={back}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {loading && (
          <div className="flex flex-col items-center py-14">
            <div className="relative h-8 w-8">
              <div className="absolute inset-0 rounded-full border border-white/[0.08]" />
              <div className="absolute inset-0 animate-spin rounded-full border border-white/60 border-t-transparent" />
            </div>
            <p className="mt-4 text-[12.5px] text-white/45">{loadingMsg}</p>
          </div>
        )}

        {/* Pick a source */}
        {!loading && !pending && !mode && (
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

        {!loading && !pending && mode === 'file' && (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`cursor-pointer rounded-xl border border-dashed px-6 py-12 text-center transition-colors ${
              isDragging ? 'border-white/30 bg-white/[0.05]' : 'border-white/[0.12] hover:border-white/25 hover:bg-white/[0.02]'
            }`}
          >
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden"
              onChange={(e) => onFile(e.target.files[0])} />
            <p className="text-[14px] font-medium text-white">{isDragging ? 'Drop it' : 'Drop a file'}</p>
            <p className="mt-1 text-[12.5px] text-white/40">
              or <span className="text-white/60 underline underline-offset-4">browse</span>
            </p>
          </div>
        )}

        {!loading && !pending && mode === 'connect' && (
          <div>
            <PlaidLinkButton userId={userId} onSuccess={onPlaidSuccess} onConnecting={onPlaidConnecting} />
            <p className="mt-3 text-[11.5px] leading-relaxed text-white/30">
              Canadian coverage is patchy. Import a statement if yours is missing.
            </p>
          </div>
        )}

        {/* Review */}
        {!loading && pending && (
          <>
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/30">Add to</p>
            <div className="-mx-3">
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

            {preview && (
              <div className="mt-5">
                {/* Only the surprising case earns a sentence. Adding alongside is
                    what the ledger already shows; replacing is not. */}
                {preview.isKnownSource && (
                  <p className="mb-2.5 text-[12.5px] leading-snug text-white/50">
                    Imported before — this replaces what it loaded last time.
                  </p>
                )}
                <Changes preview={preview} />
              </div>
            )}
          </>
        )}

        {error && <p className="mt-4 text-[12.5px] text-loss/90">{error}</p>}
      </div>

      {!loading && pending && (
        <div className="border-t border-white/[0.06] p-4">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !preview}
            className="w-full rounded-xl bg-white py-2.5 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Adding…' : `Add to ${target}`}
          </button>
        </div>
      )}
    </Modal>
  )
}
