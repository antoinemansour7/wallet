import { useMemo, useState } from 'react'
import PlaidLinkButton from '../../components/PlaidLinkButton'
import UploadIcon from './UploadIcon'
import { fmtCurrency } from '../../utils/portfolioStats'
import { accountSources, sourceLabel } from '../../utils/accountMerge'

// Adding to a portfolio is two questions, and the old screen asked neither:
// where is this coming from, and which account does it belong to. Every upload
// was assumed to be the whole world, which is why a second brokerage erased the
// first. The destination is asked rather than inferred — account numbers are not
// stable across institutions, and guessing wrong silently merges two unrelated
// accounts.

function Step({ n, title, hint, done, active, children }) {
  return (
    <section className={`rounded-2xl border px-5 py-4 transition-colors ${
      active ? 'border-white/[0.12] bg-wall-surface' : 'border-white/[0.05] bg-wall-surface/40'
    }`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          done ? 'bg-gain/15 text-gain' : active ? 'bg-white/[0.10] text-white' : 'bg-white/[0.05] text-white/30'
        }`}>
          {done ? '✓' : n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={`text-[14px] font-semibold ${active || done ? 'text-white' : 'text-white/40'}`}>{title}</h3>
          {hint && <p className="mt-0.5 text-[12px] text-white/40">{hint}</p>}
        </div>
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  )
}

function Choice({ selected, onClick, title, subtitle, icon, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors ${
        selected ? 'border-white/25 bg-white/[0.06]' : 'border-white/[0.07] hover:border-white/[0.14] hover:bg-white/[0.03]'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-white">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-white/45">{subtitle}</span>
      </span>
      <span className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
        selected ? 'border-white bg-white' : 'border-white/20'
      }`} />
    </button>
  )
}

/** What the merge will do, before it does it. */
function MergePreview({ preview, onConfirm, onCancel, busy }) {
  const { added, updated, removed, keptFromOtherSources, beforeTotal, afterTotal, delta, isNewAccount, isKnownSource } = preview
  const nothing = added.length === 0 && updated.length === 0 && removed.length === 0

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-white/60">
        {isNewAccount
          ? 'This creates a new account.'
          : isKnownSource
            ? 'You have imported this statement before, so it replaces what it loaded last time. Holdings from your other statements in this account stay as they are.'
            : 'This is a new statement for an account you already have, so its holdings are added alongside what is already there.'}
      </p>

      <div className="grid grid-cols-3 gap-2">
        {[
          { k: 'Added', v: added.length, cls: 'text-gain' },
          { k: 'Updated', v: updated.length, cls: 'text-white' },
          { k: 'Removed', v: removed.length, cls: removed.length ? 'text-loss' : 'text-white/40' },
        ].map((c) => (
          <div key={c.k} className="rounded-xl bg-white/[0.03] px-3 py-2.5 text-center">
            <p className={`text-[18px] font-semibold tabular ${c.cls}`}>{c.v}</p>
            <p className="mt-0.5 text-[11px] text-white/40">{c.k}</p>
          </div>
        ))}
      </div>

      {keptFromOtherSources > 0 && (
        <p className="text-[12px] text-white/40">
          {keptFromOtherSources} holding{keptFromOtherSources === 1 ? '' : 's'} from your other statements
          in this account will not be touched.
        </p>
      )}

      {(added.length > 0 || updated.length > 0 || removed.length > 0) && (
        <div className="max-h-52 overflow-y-auto rounded-xl border border-white/[0.06]">
          {added.map((x) => (
            <Line key={`a${x.symbol}`} symbol={x.symbol} tone="gain" detail={`+${x.quantity} shares · ${fmtCurrency(x.value)}`} />
          ))}
          {updated.map((x) => (
            <Line key={`u${x.symbol}`} symbol={x.symbol} tone="plain"
              detail={`${x.fromQuantity} → ${x.toQuantity} shares`} />
          ))}
          {removed.map((x) => (
            <Line key={`r${x.symbol}`} symbol={x.symbol} tone="loss" detail={`no longer in this statement`} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3">
        <span className="text-[12px] text-white/45">Account value</span>
        <span className="text-[13px] tabular text-white/70">
          {fmtCurrency(beforeTotal)} <span className="text-white/30">→</span>{' '}
          <span className="font-semibold text-white">{fmtCurrency(afterTotal)}</span>
          <span className={`ml-2 ${delta >= 0 ? 'text-gain' : 'text-loss'}`}>
            {delta >= 0 ? '+' : ''}{fmtCurrency(delta)}
          </span>
        </span>
      </div>

      {nothing && (
        <p className="text-[12px] text-white/40">
          Nothing would change — this statement matches what is already loaded.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="flex-1 rounded-xl bg-white py-3 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Adding…' : isNewAccount ? 'Create account' : 'Add to account'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl border border-white/[0.08] px-5 text-[13.5px] text-white/60 transition-colors hover:border-white/[0.16] hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function Line({ symbol, detail, tone }) {
  const cls = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-white/60'
  return (
    <div className="flex items-center justify-between border-b border-white/[0.04] px-3.5 py-2 last:border-0">
      <span className="text-[12.5px] font-medium text-white/80">{symbol}</span>
      <span className={`text-[12px] tabular ${cls}`}>{detail}</span>
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
  const [method, setMethod] = useState(null)
  const [destination, setDestination] = useState(null)

  const hasAccounts = accounts.length > 0
  const chooseDestination = (value) => {
    setDestination(value)
    onChooseDestination?.(value)
  }

  // Step 2 only becomes a question once a statement has actually been read.
  const readyForDestination = Boolean(pending)

  const sourcesByAccount = useMemo(() => Object.fromEntries(
    accounts.map((a) => [a.accountNumber, accountSources(a)]),
  ), [accounts])

  if (loading) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center py-24">
        <div className="relative h-10 w-10">
          <div className="absolute inset-0 rounded-full border border-white/[0.08]" />
          <div className="absolute inset-0 animate-spin rounded-full border border-white/60 border-t-transparent" />
        </div>
        <p className="mt-5 text-[13px] text-white/50">{loadingMsg}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <header className="mb-5">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-white">Add an account</h2>
        <p className="mt-1.5 text-[13px] text-white/45">
          Connect a brokerage or import a statement, then choose whether it is a new account
          or part of one you already have.
        </p>
      </header>

      <Step n={1} title="Where is it coming from?" active={!pending} done={Boolean(pending)}>
        {!pending && (
          <div className="space-y-2">
            <Choice
              selected={method === 'connect'}
              onClick={() => setMethod('connect')}
              title="Connect a brokerage"
              subtitle="Signs in and keeps itself current. Coverage of Canadian brokerages is patchy — if yours is missing, import a statement instead."
            />
            {method === 'connect' && (
              <div className="pl-1 pt-1">
                <PlaidLinkButton userId={userId} onSuccess={onPlaidSuccess} onConnecting={onPlaidConnecting} />
              </div>
            )}

            <Choice
              selected={method === 'file'}
              onClick={() => setMethod('file')}
              title="Import a statement"
              subtitle="CSV, XLSX or PDF from any broker. Works everywhere, and you re-import when you want it refreshed."
            />
            {method === 'file' && (
              <div
                className={`mt-1 cursor-pointer rounded-xl border border-dashed px-6 py-10 text-center transition-colors ${
                  isDragging ? 'border-white/25 bg-white/[0.04]' : 'border-white/[0.10] hover:border-white/20 hover:bg-white/[0.02]'
                }`}
                onClick={() => inputRef.current?.click()}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <input
                  ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden"
                  onChange={(e) => onFile(e.target.files[0])}
                />
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.05]">
                  <UploadIcon active={isDragging} />
                </div>
                <p className="text-[13.5px] font-medium text-white/70">
                  {isDragging ? 'Drop to read it' : 'Drop a statement here'}
                </p>
                <p className="mt-1 text-[12px] text-white/35">
                  or <span className="text-white/55 underline underline-offset-2">browse</span>
                </p>
              </div>
            )}
          </div>
        )}

        {pending && (
          <p className="text-[12.5px] text-white/50">
            Read <span className="text-white/75">{pending.name}</span> — {pending.rows.length} holding
            {pending.rows.length === 1 ? '' : 's'} found.
          </p>
        )}
      </Step>

      <Step
        n={2}
        title="Which account is it?"
        hint={readyForDestination ? undefined : 'Choose after a statement is read'}
        active={readyForDestination && !preview}
        done={Boolean(preview)}
      >
        {readyForDestination && !preview && (
          <div className="space-y-2">
            <Choice
              selected={destination?.mode === 'new'}
              onClick={() => chooseDestination({ mode: 'new', accountNumber: pending.suggestedAccountNumber })}
              title="A new account"
              subtitle={`Creates “${pending.suggestedAccountNumber}” and puts these holdings in it.`}
            />
            {hasAccounts && (
              <>
                <p className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/30">
                  or add to one you have
                </p>
                {accounts.map((a) => (
                  <Choice
                    key={a.accountNumber}
                    selected={destination?.mode === 'existing' && destination.accountNumber === a.accountNumber}
                    onClick={() => chooseDestination({ mode: 'existing', accountNumber: a.accountNumber })}
                    title={`Account ${a.accountNumber}`}
                    subtitle={`${a.positions.length} holding${a.positions.length === 1 ? '' : 's'} · ${
                      (sourcesByAccount[a.accountNumber] ?? []).map((s) => sourceLabel(s.id)).join(', ') || 'no statements yet'
                    }`}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {preview && (
          <p className="text-[12.5px] text-white/50">
            {preview.isNewAccount ? 'New account' : `Account ${preview.accountNumber}`}
          </p>
        )}
      </Step>

      <Step n={3} title="Check what changes" active={Boolean(preview)}>
        {preview
          ? <MergePreview preview={preview} onConfirm={onConfirm} onCancel={onCancel} busy={busy} />
          : <p className="text-[12.5px] text-white/35">Nothing is saved until you confirm here.</p>}
      </Step>

      {error && (
        <div className="rounded-xl bg-loss/[0.08] px-4 py-3">
          <p className="text-[13px] text-loss/90">{error}</p>
        </div>
      )}

      {hasAccounts && !pending && (
        <div className="pt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/30">Already added</p>
          <div className="space-y-1.5">
            {accounts.map((a) => (
              <div key={a.accountNumber} className="flex items-center justify-between rounded-xl border border-white/[0.05] px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-white/80">Account {a.accountNumber}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-white/35">
                    {(sourcesByAccount[a.accountNumber] ?? []).map((s) => sourceLabel(s.id)).join(' · ') || 'no statements yet'}
                  </p>
                </div>
                <span className="shrink-0 text-[12px] tabular text-white/45">
                  {a.positions.length} holding{a.positions.length === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
