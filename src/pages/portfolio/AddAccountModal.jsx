import { useEffect, useRef, useState } from 'react'
import Modal from '../../components/Modal'
import PlaidLinkButton from '../../components/PlaidLinkButton'
import { fmtCurrency } from '../../utils/portfolioStats'
import { accountSources, sourceLabel } from '../../utils/accountMerge'
import { cashEntryAmount } from '../../utils/accountPortfolio'
import AccountIcon from './AccountIcons'
import './Accounts.css'

const PLAN_TYPES = new Set(['tfsa', 'rrsp', 'resp', 'fhsa', 'lira', 'rrif', 'ira', 'roth', '401k'])
const typeLabel = (value = '') => PLAN_TYPES.has(value.toLowerCase()) ? value.toUpperCase() : value.charAt(0).toUpperCase() + value.slice(1)

function Steps({ current, file }) {
  const labels = file ? ['Upload', 'Review'] : ['Connect', 'Choose accounts', 'Review']
  return <ol className="ac-steps" aria-label="Add account progress">{labels.map((label, index) => <li key={label} aria-current={index === current ? 'step' : undefined} className={index < current ? 'is-complete' : ''}><span>{index < current ? <AccountIcon name="check" size={11} /> : index + 1}</span>{label}</li>)}</ol>
}

function Changes({ preview }) {
  const [expanded, setExpanded] = useState(false)
  const changes = [
    ...preview.added.map((row) => ({ key: `add-${row.symbol}`, symbol: row.symbol, detail: `${row.quantity} shares added`, value: row.value })),
    ...preview.updated.map((row) => ({ key: `update-${row.symbol}`, symbol: row.symbol, detail: `${row.fromQuantity} → ${row.toQuantity} shares`, value: row.toValue - row.fromValue })),
    ...preview.removed.map((row) => ({ key: `remove-${row.symbol}`, symbol: row.symbol, detail: 'Removed from this import', value: -row.value, removed: true })),
  ]
  return <div className="ac-change-list">
    {preview.isKnownSource && <p className="ac-inline-note">This replaces the previous statement from this source. Holdings from your other imports stay in place.</p>}
    {changes.length ? <><button type="button" className="ac-text-link" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide changes' : `Review ${changes.length} holding change${changes.length === 1 ? '' : 's'}`}<AccountIcon name="chevron" size={12} /></button>{expanded && changes.map((row) => <div key={row.key}><span>{row.symbol}<br /><small>{row.detail}</small></span><span className={row.removed ? 'ac-change-negative' : ''}>{row.value >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(row.value))}</span></div>)}</> : <p className="ac-inline-note">These holdings are already in your portfolio.</p>}
  </div>
}

export default function AddAccountModal({
  open, onClose, initialMode = null, accounts = [], error, loading, loadingMsg, inputRef, isDragging, userId,
  pending, preview, busy, discovered, onImportDiscovered, onDragOver, onDragLeave, onDrop, onFile,
  onPlaidAccounts, onPlaidConnecting, onPlaidError, onChooseDestination, onConfirm, onCancel, completed,
}) {
  const [mode, setMode] = useState(initialMode)
  const [chosen, setChosen] = useState(null)
  const [picked, setPicked] = useState([])
  const [linkOpen, setLinkOpen] = useState(false)
  const headingRef = useRef(null)
  const initializedPending = useRef(null)
  useEffect(() => { if (open) { setMode(initialMode); setLinkOpen(false) } }, [open, initialMode])
  useEffect(() => {
    if (!discovered) { setPicked([]); return }
    const allowed = new Set(discovered.accounts.map((account) => account.id))
    setPicked((discovered.enabledAccountIds || discovered.accounts.filter((account) => account.type === 'investment').map((account) => account.id)).filter((id) => allowed.has(id)))
  }, [discovered])
  useEffect(() => {
    if (initializedPending.current === pending) return
    initializedPending.current = pending
    if (!pending || pending.knownAccounts?.length) { setChosen(null); return }
    const initial = { mode: 'new', accountNumber: pending.suggestedAccountNumber }
    setChosen(initial)
    onChooseDestination?.(initial)
  }, [pending, onChooseDestination])

  const locked = Boolean(busy || loading || linkOpen)
  const known = pending?.knownAccounts || []
  const fileFlow = pending ? pending.kind !== 'plaid' : mode === 'file'
  const step = completed ? 'success' : loading ? 'loading' : pending ? 'review' : discovered ? 'select' : mode || 'method'
  useEffect(() => { if (open && !linkOpen) headingRef.current?.focus() }, [step, open, linkOpen])
  const choose = (value) => { setChosen(value); onChooseDestination?.(value) }
  const toggle = (id) => setPicked((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const back = pending ? onCancel : !discovered && mode ? () => setMode(null) : null
  const cashTotal = (pending?.cashEntries || []).reduce((sum, entry) => sum + cashEntryAmount(entry), 0)
  const importTotals = new Map()
  for (const row of pending?.rows || []) {
    const currency = row['ACCOUNT CURRENCY'] || 'Currency unspecified'
    importTotals.set(currency, (importTotals.get(currency) || 0) + Number(row['MARKET VALUE'] || 0))
  }
  for (const entry of pending?.cashEntries || []) {
    const currency = entry.currency || 'Currency unspecified'
    importTotals.set(currency, (importTotals.get(currency) || 0) + cashEntryAmount(entry))
  }
  const target = known.length ? `${known.length} account${known.length === 1 ? '' : 's'}` : chosen?.mode === 'new' ? 'new account' : chosen?.accountNumber
  const title = { method: 'Bring your accounts together', connect: 'Connect your brokerage', file: 'Import a statement', loading: loadingMsg || 'Preparing your accounts', select: 'Choose your accounts', review: 'Review before you add', success: 'Your accounts are ready' }[step]
  const subtitle = { method: 'Choose how you’d like to add your investments.', connect: 'Link securely with Plaid, then choose what to bring into WallAI.', file: 'Upload a statement from your brokerage. You’ll review it before anything is added.', select: `Select the accounts from ${discovered?.institutionName || 'your brokerage'} you want to track.`, review: pending?.name, success: 'You can now see your investments alongside your other accounts.' }[step]

  return <Modal open={open} onClose={onClose} labelledBy="add-account-title" className="accounts-ui accounts-dialog" dismissible={!locked} suspendFocus={linkOpen}>
    <div className="ac-dialog-nav">{back && !completed && <button type="button" className="ac-icon-button" aria-label="Back" onClick={back} disabled={locked}><AccountIcon name="back" size={18} /></button>}<span>{completed ? 'ALL SET' : 'ADD AN ACCOUNT'}</span><button type="button" className="ac-icon-button" aria-label="Close" onClick={onClose} disabled={locked}><AccountIcon name="close" size={18} /></button></div>
    <div className="ac-dialog-body">
      {step !== 'method' && step !== 'success' && <Steps file={fileFlow} current={pending ? fileFlow ? 1 : 2 : discovered ? 1 : 0} />}
      <div className="ac-dialog-heading"><h2 id="add-account-title" ref={headingRef} tabIndex={-1}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {step === 'method' && <div className="ac-methods modal-step"><button type="button" className="ac-method" onClick={() => setMode('connect')}><span className="ac-tile ac-tile-green"><AccountIcon name="bank" /></span><span><strong>Connect a brokerage</strong><small>Choose your institution and link with Plaid.</small><span className="ac-badge">Secure connection</span></span><AccountIcon name="chevron" size={16} /></button><button type="button" className="ac-method" onClick={() => setMode('file')}><span className="ac-tile"><AccountIcon name="file" /></span><span><strong>Import a statement</strong><small>Add your holdings from a CSV, XLSX, or PDF.</small></span><AccountIcon name="chevron" size={16} /></button></div>}
      {step === 'connect' && <div className="modal-step"><div className="ac-connection-art" aria-hidden="true"><span className="ac-tile">W</span><i /><AccountIcon name="link" size={23} /><i /><span className="ac-tile"><AccountIcon name="bank" size={27} /></span></div><div className="ac-benefits"><div><AccountIcon name="shield" size={18} /><span><strong>A secure connection through Plaid</strong><p>Sign in with your institution. WallAI doesn’t receive your brokerage password.</p></span></div><div><AccountIcon name="check" size={18} /><span><strong>You choose the accounts</strong><p>Review your holdings and balances before adding them.</p></span></div><div><AccountIcon name="wallet" size={18} /><span><strong>Your money stays where it is</strong><p>Connecting an account doesn’t move money or place trades.</p></span></div></div><PlaidLinkButton userId={userId} onAccounts={onPlaidAccounts} onConnecting={onPlaidConnecting} onError={onPlaidError} onLinkOpenChange={setLinkOpen} /><p className="ac-plaid-footnote">Can’t find your institution? <button type="button" className="ac-text-link" onClick={() => setMode('file')}>Import a statement</button></p></div>}
      {step === 'file' && <div className={`ac-file-drop modal-step ${isDragging ? 'is-dragging' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}><span className="ac-tile"><AccountIcon name="upload" size={23} /></span><strong>{isDragging ? 'Drop your statement here' : 'Drop a file'}</strong><p>or choose one from your device</p><button type="button" className="ac-button ac-secondary" onClick={() => inputRef.current?.click()}>Browse files</button><small>CSV, XLSX, XLS, or PDF</small><input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="sr-only" tabIndex={-1} aria-label="Statement file" onChange={(event) => { if (event.target.files?.[0]) onFile?.(event.target.files[0]); event.target.value = '' }} /></div>}
      {step === 'loading' && <div className="ac-loading modal-step" role="status"><span className="ac-spinner" aria-hidden="true" /><h3>{loadingMsg || 'Preparing your accounts…'}</h3><p>This may take a moment.<br />We’ll bring you to the review when it’s ready.</p></div>}
      {step === 'select' && <div className="modal-step"><div className="ac-selection-meta"><span>{picked.length} of {discovered.accounts.length} selected</span><button type="button" className="ac-text-link" disabled={locked} onClick={() => setPicked(picked.length === discovered.accounts.length ? [] : discovered.accounts.map((account) => account.id))}>{picked.length === discovered.accounts.length ? 'Deselect all' : 'Select all'}</button></div><div className="ac-choice-list">{discovered.accounts.map((account) => <label className="ac-choice" key={account.id}><span className="ac-tile"><AccountIcon name={account.type === 'investment' ? 'bank' : 'wallet'} size={17} /></span><span><strong>{account.officialName || account.name || 'Account'}</strong><small>{[typeLabel(account.subtype || account.type || ''), account.mask ? `•• ${account.mask}` : null].filter(Boolean).join(' · ')}</small></span><input type="checkbox" checked={picked.includes(account.id)} disabled={locked} onChange={() => toggle(account.id)} /></label>)}</div>{!discovered.accounts.length && <p className="ac-inline-note">No accounts were returned by this institution. Close this connection and try another institution or a statement.</p>}<p className="ac-inline-note">Only selected accounts will be added to your portfolio. You can remove them later.</p></div>}
      {step === 'review' && <div className="modal-step"><div className="ac-review-total"><span>Account value to import</span><p>{[...importTotals].map(([currency, value]) => <span key={currency} style={{ display: 'block' }}>{fmtCurrency(value)} <small style={{ display: 'inline' }}>{currency}</small></span>)}</p><small>{pending.rows.length} holding{pending.rows.length === 1 ? '' : 's'}{cashTotal !== 0 ? ' · Includes cash' : ''}</small></div>{known.length > 0 ? <><div className="ac-section-label"><span>{known.length} account{known.length === 1 ? '' : 's'}</span><span>Holdings value</span></div><div className="ac-choice-list">{known.map((account) => <div className="ac-review-account" key={account.accountNumber}><span className="ac-tile"><AccountIcon name="bank" size={18} /></span><span><strong>{account.accountNumber}</strong><small>{account.positions} holding{account.positions === 1 ? '' : 's'} · {accounts.some((current) => current.accountNumber === account.accountNumber) ? 'Update existing account' : 'New account'}</small></span><b>{fmtCurrency(account.value)}</b></div>)}</div><p className="ac-inline-note">Each account stays separate. Holdings already imported from this connection will be updated.</p></> : <><p className="ac-section-label">Where should these investments go?</p><div className="ac-choice-list" role="radiogroup" aria-label="Import destination"><label className="ac-choice"><input type="radio" name="import-destination" checked={chosen?.mode === 'new'} disabled={locked} onChange={() => choose({ mode: 'new', accountNumber: pending.suggestedAccountNumber })} /><span><strong>New account</strong><small>{pending.suggestedAccountNumber}</small></span></label>{accounts.map((account) => <label className="ac-choice" key={account.accountNumber}><input type="radio" name="import-destination" checked={chosen?.mode === 'existing' && chosen.accountNumber === account.accountNumber} disabled={locked} onChange={() => choose({ mode: 'existing', accountNumber: account.accountNumber })} /><span><strong>{account.accountNumber}</strong><small>{accountSources(account).map((feed) => sourceLabel(feed.id)).join(' · ') || 'Cash account'}</small></span></label>)}</div>{preview && <Changes preview={preview} />}</>}</div>}
      {step === 'success' && <div className="modal-step"><div className="ac-connection-art"><span className="ac-tile ac-tile-green"><AccountIcon name="check" size={30} /></span></div><div className="ac-review-total"><span>Added to your portfolio</span><p>{completed.count} account{completed.count === 1 ? '' : 's'}</p><small>{completed.name}</small></div></div>}
      {error && <div className="ac-inline-error" role="alert">{error}</div>}
    </div>
    {(step === 'method' || step === 'select' || step === 'review' || step === 'success') && <div className="ac-dialog-footer">
      {step === 'select' && <button type="button" className="ac-button ac-primary" disabled={locked || picked.length === 0} onClick={() => onImportDiscovered?.(picked)}>{busy && <span className="ac-spinner" aria-hidden="true" />}{busy ? 'Preparing review…' : 'Review selected accounts'}{!busy && <AccountIcon name="arrow" size={17} />}</button>}
      {step === 'review' && <button type="button" className="ac-button ac-primary" disabled={locked || (!preview && !known.length)} onClick={onConfirm}>{busy && <span className="ac-spinner" aria-hidden="true" />}{busy ? 'Adding accounts…' : `Add ${target === 'new account' ? 'new account' : known.length ? target : 'to ' + target}`}{!busy && <AccountIcon name="check" size={17} />}</button>}
      {step === 'success' && <button type="button" className="ac-button ac-primary" onClick={onClose}>View your accounts <AccountIcon name="arrow" size={17} /></button>}
      <p className="ac-security"><AccountIcon name="lock" size={13} /> Your money stays with your brokerage.</p>
    </div>}
  </Modal>
}
