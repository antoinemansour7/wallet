import { useEffect, useMemo, useState } from 'react'
import Modal, { ModalHeader } from '../../components/Modal'
import PlaidLinkButton from '../../components/PlaidLinkButton'
import { fmtCurrency } from '../../utils/portfolioStats'
import { accountSources, sourceLabel } from '../../utils/accountMerge'
import { Group, Tile, Option, IconStatement, IconBrokerage } from './listGroup'

// Copy is deliberately thin here. An overlay this size is read at a glance, and
// every sentence explaining the flow is a sentence competing with the two
// choices that are the flow.
//
// Sizing note: everything in here used to sit between 11.5px and 13.5px at a
// third of full opacity. That is the register of a dense dashboard, not of a
// sheet you are asked to make one decision in, and it is most of why it read as
// filler. Rows are 15px on a 60px target with real dividers.

// Plaid hands these back lowercase. Registered plans are initialisms and look
// wrong in sentence case; everything else is an ordinary noun.
const PLAN_TYPES = new Set(['tfsa', 'rrsp', 'resp', 'fhsa', 'lira', 'rrif', 'ira', 'roth', '401k'])

function accountTypeLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (PLAN_TYPES.has(lower)) return raw.toUpperCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

const IconPlus = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const IconAccount = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="5.5" width="19" height="14" rx="2.5" /><path d="M2.5 10.5h19" />
  </svg>
)

const IconCheck = ({ className = '' }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
    strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
)

// The choice is exclusive, so it stays a radio to a screen reader — but the
// marker is a check on the selected row. A column of empty circles down the left
// edge is the loudest thing on a panel whose subject is a number.
function Destination({ icon, label, detail, selected, onClick }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:bg-ink/[0.05] ${
        selected ? 'bg-ink/[0.04]' : 'hover:bg-ink/[0.025]'
      }`}
    >
      <Tile>{icon}</Tile>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{label}</span>
        {detail && <span className="mt-0.5 block truncate text-[13px] text-ink/45">{detail}</span>}
      </span>
      <IconCheck className={`shrink-0 text-accent transition-opacity duration-150 dark:text-ink ${selected ? 'opacity-100' : 'opacity-0'}`} />
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
      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-ink/[0.025] focus-visible:outline-none focus-visible:bg-ink/[0.05]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{label}</span>
        {detail && <span className="mt-0.5 block truncate text-[13px] text-ink/45">{detail}</span>}
      </span>
      <span className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
        checked ? 'border-accent bg-accent dark:border-ink dark:bg-ink' : 'border-ink/25'
      }`}>
        {checked && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" strokeWidth="3.4"
            strokeLinecap="round" strokeLinejoin="round" className="stroke-white dark:stroke-wall-surface">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </span>
    </button>
  )
}

// Folded away by default. Every line here used to be the same green plus at the
// same weight, which is five ways of saying the one thing the headline already
// says. Closed, it is a count; open, colour means something again because only
// removals carry it.
function Changes({ preview, open, onToggle }) {
  const { added, updated, removed, keptFromOtherSources, beforeTotal, afterTotal } = preview
  const lines = [
    ...added.map((x) => ({ k: `a${x.symbol}`, symbol: x.symbol, detail: `${x.quantity} shares`, amount: x.value, tone: 'text-ink/65' })),
    ...updated.map((x) => ({ k: `u${x.symbol}`, symbol: x.symbol, detail: `${x.fromQuantity} → ${x.toQuantity} shares`, amount: x.toValue - x.fromValue, tone: 'text-ink/65' })),
    ...removed.map((x) => ({ k: `r${x.symbol}`, symbol: x.symbol, detail: 'not in this import', amount: -x.value, tone: 'text-loss' })),
  ]

  if (lines.length === 0) {
    return <p className="text-[13px] text-ink/45">Nothing changes — this is already loaded.</p>
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="-mx-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13.5px] font-medium text-ink/55 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
      >
        {open ? 'Hide holdings' : `Show ${lines.length} holding${lines.length === 1 ? '' : 's'}`}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
          strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-1.5">
          {lines.map((l) => (
            <div key={l.k} className="flex items-baseline gap-3 py-1.5">
              <span className="w-[68px] shrink-0 truncate text-[13.5px] font-medium text-ink/85">{l.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink/40">{l.detail}</span>
              <span className={`shrink-0 font-mono text-[13px] tabular ${l.tone}`}>
                {l.amount >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(l.amount))}
              </span>
            </div>
          ))}

          {/* Only meaningful when the account already held something. On a new
              account this read "$0.00 → $49,360.80", which looks like a bug. */}
          {beforeTotal > 0 && (
            <div className="mt-3 flex items-baseline justify-between border-t border-ink/[0.07] pt-3">
              <span className="text-[12.5px] text-ink/40">
                {keptFromOtherSources > 0 ? `${keptFromOtherSources} kept from other imports` : 'This account'}
              </span>
              <span className="font-mono text-[13px] tabular text-ink/45">
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

function PrimaryButton({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-12 w-full rounded-[14px] bg-accent text-[15px] font-semibold tracking-[-0.01em] text-wall-surface transition-opacity duration-150 hover:opacity-90 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 focus-visible:ring-offset-wall-surface dark:bg-ink"
    >
      {children}
    </button>
  )
}

export default function AddAccountModal({
  open, onClose, initialMode = null,
  accounts = [], error, loading, loadingMsg, inputRef, isDragging, userId,
  pending, preview, busy,
  discovered, onImportDiscovered,
  onDragOver, onDragLeave, onDrop, onFile,
  onPlaidAccounts, onPlaidConnecting, onPlaidError,
  onChooseDestination, onConfirm, onCancel,
}) {
  const [mode, setMode] = useState(initialMode)
  const [chosen, setChosen] = useState(null)
  const [picked, setPicked] = useState([])
  const [detailOpen, setDetailOpen] = useState(false)

  // Opened from the empty accounts screen, the route in has already been
  // chosen — landing on the chooser again would ask the same question twice.
  useEffect(() => { if (open) setMode(initialMode) }, [open, initialMode])

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

  // The review step names itself in its own heading, so the chrome above stays
  // as navigation only rather than printing the institution twice.
  const chromeTitle = discovered
    ? (discovered.institutionName || 'Connected')
    : pending ? null : 'Add an account'

  return (
    <Modal open={open} onClose={onClose} labelledBy="add-account-title">
      <ModalHeader
        id={pending ? undefined : 'add-account-title'}
        title={chromeTitle}
        subtitle={discovered ? 'Choose what to bring in' : undefined}
        onBack={discovered ? undefined : back}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
        {loading && (
          <div className="flex flex-col items-center py-16">
            <div className="relative h-8 w-8">
              <div className="absolute inset-0 rounded-full border-2 border-ink/[0.09]" />
              <div className="absolute inset-0 animate-spin rounded-full border-2 border-ink/50 border-t-transparent" />
            </div>
            <p className="mt-4 text-[13.5px] text-ink/45">{loadingMsg}</p>
          </div>
        )}

        {/* Which accounts to import */}
        {!loading && discovered && (
          <>
            <Group className="mt-2">
              {discovered.accounts.map((a) => (
                <AccountChoice
                  key={a.id}
                  label={a.officialName || a.name || 'Account'}
                  detail={[accountTypeLabel(a.subtype || a.type), a.mask ? `••${a.mask}` : null].filter(Boolean).join(' · ')}
                  checked={picked.includes(a.id)}
                  onToggle={() => togglePick(a.id)}
                />
              ))}
            </Group>
            <p className="mt-3.5 px-1 text-[12.5px] leading-relaxed text-ink/40">
              Only what you tick is read. Your bank may require connecting other
              accounts — they stay out of WallAI.
            </p>
          </>
        )}

        {/* Pick a source */}
        {!loading && !pending && !discovered && !mode && (
          <Group className="mt-2">
            <Option
              icon={<IconStatement />}
              title="Import a statement"
              hint="CSV, XLSX or PDF"
              onClick={() => setMode('file')}
            />
            <Option
              icon={<IconBrokerage />}
              title="Connect a brokerage"
              hint="Sign in securely"
              onClick={() => setMode('connect')}
            />
          </Group>
        )}

        {!loading && !pending && !discovered && mode === 'file' && (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`mt-2 cursor-pointer rounded-2xl border border-dashed px-6 py-14 text-center transition-colors ${
              isDragging ? 'border-ink/30 bg-ink/[0.04]' : 'border-ink/[0.16] hover:border-ink/25 hover:bg-ink/[0.02]'
            }`}
          >
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden"
              onChange={(e) => onFile(e.target.files[0])} />
            <p className="text-[15px] font-medium text-ink">{isDragging ? 'Drop it' : 'Drop a file'}</p>
            <p className="mt-1 text-[13px] text-ink/45">
              or <span className="text-ink/70 underline underline-offset-4">browse</span>
            </p>
          </div>
        )}

        {!loading && !pending && !discovered && mode === 'connect' && (
          <div className="mt-2">
            <Group>
              <PlaidLinkButton userId={userId} onAccounts={onPlaidAccounts} onConnecting={onPlaidConnecting} onError={onPlaidError} />
            </Group>
            <p className="mt-3.5 px-1 text-[12.5px] leading-relaxed text-ink/40">
              Canadian coverage is patchy. Import a statement if yours is missing.
            </p>
          </div>
        )}

        {/* Review. The sum is the subject of this screen — the whole decision is
            where it lands — so it leads at a size nothing competes with, and
            holds still while you move between destinations. */}
        {!loading && !discovered && pending && (
          <>
            <div className="px-1 pb-6 pt-1">
              <h2 id="add-account-title" className="text-[13.5px] font-medium text-ink/45">{pending.name}</h2>
              <p className="mt-1.5 font-display text-[34px] font-medium leading-none tracking-[-0.035em] tabular text-ink">
                {incomingTotal != null ? fmtCurrency(incomingTotal) : '—'}
              </p>
              <p className="mt-2 text-[13.5px] text-ink/45">
                {holdingCount} holding{holdingCount === 1 ? '' : 's'}
              </p>
            </div>

            <p className="mb-2 px-1 text-[13.5px] font-medium text-ink/55">Add to</p>
            <Group role="radiogroup">
              <Destination
                icon={<IconPlus />}
                label="New account"
                detail={pending.suggestedAccountNumber}
                selected={chosen?.mode === 'new'}
                onClick={() => pick({ mode: 'new', accountNumber: pending.suggestedAccountNumber })}
              />
              {accounts.map((a) => (
                <Destination
                  key={a.accountNumber}
                  icon={<IconAccount />}
                  label={a.accountNumber}
                  detail={describe(a)}
                  selected={chosen?.mode === 'existing' && chosen.accountNumber === a.accountNumber}
                  onClick={() => pick({ mode: 'existing', accountNumber: a.accountNumber })}
                />
              ))}
            </Group>

            {preview && (
              <div className="mt-4 px-1">
                {/* Only the surprising case earns a sentence. Adding alongside is
                    what the ledger already shows; replacing is not. */}
                {preview.isKnownSource && (
                  <p className="mb-2.5 text-[13px] leading-snug text-ink/55">
                    Imported before — this replaces what it loaded last time.
                  </p>
                )}
                <Changes preview={preview} open={detailOpen} onToggle={() => setDetailOpen((v) => !v)} />
              </div>
            )}
          </>
        )}

        {error && <p className="mt-4 px-1 text-[13px] text-loss/90">{error}</p>}
      </div>

      {!loading && discovered && (
        <div className="px-4 pb-4 pt-2">
          <PrimaryButton onClick={() => onImportDiscovered?.(picked)} disabled={busy || picked.length === 0}>
            {busy ? 'Importing…' : picked.length === 0 ? 'Pick at least one' : `Import ${picked.length} account${picked.length === 1 ? '' : 's'}`}
          </PrimaryButton>
        </div>
      )}

      {!loading && !discovered && pending && (
        <div className="px-4 pb-4 pt-2">
          <PrimaryButton onClick={onConfirm} disabled={busy || !preview}>
            {busy ? 'Adding…' : `Add to ${target}`}
          </PrimaryButton>
        </div>
      )}
    </Modal>
  )
}
