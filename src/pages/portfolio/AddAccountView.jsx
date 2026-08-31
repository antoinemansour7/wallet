import { useEffect, useMemo, useState } from 'react'
import PlaidLinkButton from '../../components/PlaidLinkButton'
import { fmtCurrency } from '../../utils/portfolioStats'
import { accountSources, sourceLabel } from '../../utils/accountMerge'

// Two screens, not a three-step wizard. The preview depends on which account
// you pick, so asking for the destination and then showing the consequences on
// a separate step split one decision across two places — you chose blind, then
// read about it. They belong together: pick, and the change updates underneath.
//
// No step cards, no numbered circles, no stat tiles. Hierarchy comes from type
// and space; borders appear only where something is selectable.

function PickSource({ inputRef, isDragging, onDragOver, onDragLeave, onDrop, onFile, userId, onPlaidSuccess, onPlaidConnecting }) {
  const [connecting, setConnecting] = useState(false)

  return (
    <div className="space-y-2.5">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`cursor-pointer rounded-2xl border border-dashed px-6 py-12 text-center transition-colors ${
          isDragging
            ? 'border-white/30 bg-white/[0.05]'
            : 'border-white/[0.10] hover:border-white/20 hover:bg-white/[0.02]'
        }`}
      >
        <input
          ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden"
          onChange={(e) => onFile(e.target.files[0])}
        />
        <p className="text-[15px] font-medium text-white">
          {isDragging ? 'Drop it' : 'Drop a statement'}
        </p>
        <p className="mt-1.5 text-[13px] text-white/40">
          or <span className="text-white/60 underline underline-offset-4">choose a file</span>
        </p>
        <p className="mt-4 text-[11.5px] text-white/25">CSV, XLSX or PDF · any broker</p>
      </div>

      {connecting ? (
        <div className="rounded-2xl border border-white/[0.08] px-5 py-4">
          <PlaidLinkButton userId={userId} onSuccess={onPlaidSuccess} onConnecting={onPlaidConnecting} />
          <p className="mt-3 text-[11.5px] leading-relaxed text-white/30">
            Coverage of Canadian brokerages is patchy. If yours is missing, import a statement instead.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConnecting(true)}
          className="w-full rounded-2xl border border-white/[0.07] px-5 py-4 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.02]"
        >
          <span className="block text-[14px] font-medium text-white/85">Connect a brokerage instead</span>
          <span className="mt-0.5 block text-[12.5px] text-white/40">Signs in once and keeps itself current</span>
        </button>
      )}
    </div>
  )
}

function Destination({ label, detail, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3.5 rounded-xl px-4 py-3 text-left transition-colors ${
        selected ? 'bg-white/[0.07] ring-1 ring-white/20' : 'hover:bg-white/[0.035]'
      }`}
    >
      <span className={`h-[15px] w-[15px] shrink-0 rounded-full border transition-colors ${
        selected ? 'border-[5px] border-white' : 'border-white/25'
      }`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-white">{label}</span>
        <span className="mt-0.5 block truncate text-[12.5px] text-white/40">{detail}</span>
      </span>
    </button>
  )
}

/** The change itself, as a ledger rather than a row of counters. */
function Changes({ preview }) {
  const { added, updated, removed, keptFromOtherSources, beforeTotal, afterTotal, delta } = preview
  const lines = [
    ...added.map((x) => ({ key: `a${x.symbol}`, sign: '+', symbol: x.symbol, detail: `${x.quantity} shares`, amount: x.value, tone: 'text-gain' })),
    ...updated.map((x) => ({ key: `u${x.symbol}`, sign: '', symbol: x.symbol, detail: `${x.fromQuantity} → ${x.toQuantity} shares`, amount: x.toValue - x.fromValue, tone: 'text-white/70' })),
    ...removed.map((x) => ({ key: `r${x.symbol}`, sign: '−', symbol: x.symbol, detail: 'gone from this statement', amount: -x.value, tone: 'text-loss' })),
  ]

  return (
    <div>
      {lines.length === 0 ? (
        <p className="py-3 text-[13px] text-white/40">
          Nothing changes — this statement matches what is already loaded.
        </p>
      ) : (
        <div className="-mx-1">
          {lines.map((l) => (
            <div key={l.key} className="flex items-baseline gap-3 px-1 py-[7px]">
              <span className={`w-3 shrink-0 text-[13px] ${l.tone}`}>{l.sign}</span>
              <span className="w-16 shrink-0 text-[13.5px] font-medium text-white">{l.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/40">{l.detail}</span>
              <span className={`shrink-0 text-[13px] tabular ${l.tone}`}>
                {l.amount >= 0 ? '+' : ''}{fmtCurrency(l.amount)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-baseline justify-between border-t border-white/[0.07] pt-3.5">
        <span className="text-[12.5px] text-white/40">
          {keptFromOtherSources > 0
            ? `${keptFromOtherSources} existing holding${keptFromOtherSources === 1 ? '' : 's'} stay as they are`
            : 'Account total'}
        </span>
        <span className="text-[14px] tabular text-white/45">
          {fmtCurrency(beforeTotal)}
          <span className="mx-1.5 text-white/25">→</span>
          <span className="font-semibold text-white">{fmtCurrency(afterTotal)}</span>
        </span>
      </div>
    </div>
  )
}

export default function AddAccountView({
  accounts = [], error, loading, loadingMsg, inputRef, isDragging, userId,
  pending, preview, busy,
  onDragOver, onDragLeave, onDrop, onFile,
  onPlaidSuccess, onPlaidConnecting,
  onChooseDestination, onConfirm, onCancel,
}) {
  const [chosen, setChosen] = useState(null)

  // A fresh statement starts the choice over, and defaults to a new account so
  // the review below is never blank while you decide.
  useEffect(() => {
    if (!pending) { setChosen(null); return }
    const initial = { mode: 'new', accountNumber: pending.suggestedAccountNumber }
    setChosen(initial)
    onChooseDestination?.(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.sourceId])

  const pick = (value) => {
    setChosen(value)
    onChooseDestination?.(value)
  }

  const sourcesByAccount = useMemo(() => Object.fromEntries(
    accounts.map((a) => [a.accountNumber, accountSources(a)]),
  ), [accounts])

  const describe = (a) => {
    const feeds = (sourcesByAccount[a.accountNumber] ?? []).map((s) => sourceLabel(s.id))
    return `${a.positions.length} holding${a.positions.length === 1 ? '' : 's'}`
      + (feeds.length ? ` · ${feeds.join(', ')}` : '')
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-[460px] flex-col items-center py-28">
        <div className="relative h-9 w-9">
          <div className="absolute inset-0 rounded-full border border-white/[0.08]" />
          <div className="absolute inset-0 animate-spin rounded-full border border-white/60 border-t-transparent" />
        </div>
        <p className="mt-5 text-[13px] text-white/45">{loadingMsg}</p>
      </div>
    )
  }

  // ── Review ────────────────────────────────────────────────────────────────
  if (pending) {
    const target = chosen?.mode === 'new' ? 'a new account' : chosen?.accountNumber
    return (
      <div className="mx-auto max-w-[460px] pb-12">
        <button
          type="button"
          onClick={onCancel}
          className="mb-7 -ml-1 flex items-center gap-1.5 px-1 text-[13px] text-white/40 transition-colors hover:text-white/70"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </button>

        <h2 className="text-[21px] font-semibold tracking-[-0.02em] text-white">{pending.name}</h2>
        <p className="mt-1.5 text-[13.5px] text-white/45">
          {pending.rows.length} holding{pending.rows.length === 1 ? '' : 's'} read from this statement
        </p>

        <p className="mb-1 mt-8 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/30">Add to</p>
        <div className="-mx-4">
          <Destination
            label="A new account"
            detail={`Creates ${pending.suggestedAccountNumber}`}
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
          <>
            <p className="mb-2 mt-8 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/30">
              What changes
            </p>
            <p className="mb-3 text-[13px] leading-relaxed text-white/50">
              {preview.isNewAccount
                ? 'These holdings start a new account.'
                : preview.isKnownSource
                  ? 'You have imported this statement before, so it replaces what it loaded last time.'
                  : 'These are added alongside what this account already holds.'}
            </p>
            <Changes preview={preview} />
          </>
        )}

        {error && <p className="mt-5 text-[13px] text-loss/90">{error}</p>}

        {/* One way out, not two — Back at the top already abandons this. */}
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || !preview}
          className="mt-8 w-full rounded-xl bg-white py-3 text-[14px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Adding…' : `Add to ${target}`}
        </button>
      </div>
    )
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-[460px] pb-12">
      <h2 className="text-[21px] font-semibold tracking-[-0.02em] text-white">Add an account</h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/45">
        Import a statement and choose whether it is a new account or part of one you already have.
      </p>

      <div className="mt-7">
        <PickSource
          inputRef={inputRef} isDragging={isDragging} userId={userId}
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onFile={onFile}
          onPlaidSuccess={onPlaidSuccess} onPlaidConnecting={onPlaidConnecting}
        />
      </div>

      {error && <p className="mt-5 text-[13px] text-loss/90">{error}</p>}

      {accounts.length > 0 && (
        <div className="mt-10">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/30">
            Your accounts
          </p>
          {accounts.map((a) => (
            <div key={a.accountNumber} className="flex items-baseline justify-between border-b border-white/[0.05] py-3 last:border-0">
              <span className="text-[14px] font-medium text-white/85">{a.accountNumber}</span>
              <span className="text-[12.5px] text-white/35">{describe(a)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
