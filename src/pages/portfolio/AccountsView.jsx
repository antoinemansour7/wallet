import { useRef, useState } from 'react'
import CompanyLogo from '../../components/CompanyLogo'
import { fmtCurrency } from '../../utils/portfolioStats'
import { accountSources, sourceLabel } from '../../utils/accountMerge'
import { accountTitle, brokerageConnections, currencyTotals } from './accountPresentation'
import { accountTypeLabel, taxAccountType } from './tax/taxModel'
import AccountIcon from './AccountIcons'
import './Accounts.css'

export default function AccountsView({ accounts = [], taxSettings = {}, onAdd, onOpenAccount, onFile, notice, onDismissNotice }) {
  const [filter, setFilter] = useState('all')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const connections = brokerageConnections(accounts)
  const connectedCount = accounts.filter((account) => accountSources(account).some((feed) => feed.id.startsWith('plaid:'))).length
  const visibleAccounts = accounts.filter((account) => filter === 'all' || accountSources(account).some((feed) => feed.id.startsWith('plaid:')))
  const totals = currencyTotals(accounts)

  return (
    <section className="accounts-ui accounts-page" aria-labelledby="accounts-title">
      <header className="accounts-heading">
        <div><p className="accounts-eyebrow">YOUR PORTFOLIO</p><h1 id="accounts-title">Your accounts</h1><p>Everything you own. All in one place.</p></div>
        <button className="ac-button ac-primary" onClick={() => onAdd?.()}><AccountIcon name="plus" size={17} /> Add account</button>
      </header>
      {notice && <div className="ac-notice" role="status"><AccountIcon name="check" size={18} /><span>{notice}</span><button className="ac-icon-button" aria-label="Dismiss notification" onClick={onDismissNotice}><AccountIcon name="close" size={16} /></button></div>}

      {accounts.length > 0 && (
        <div className="accounts-summary">
          <div className="accounts-summary-main"><span>Total account value</span><div className="accounts-total-values">{totals.map(({ currency, value }) => <p key={currency}>{fmtCurrency(value)} <span>{currency || 'Currency not specified'}</span></p>)}</div><span>Investments and cash across {accounts.length} account{accounts.length === 1 ? '' : 's'}</span></div>
          <div className="accounts-summary-stat"><AccountIcon name="wallet" /><strong>{accounts.length}</strong><span>Accounts</span></div>
          <div className="accounts-summary-stat"><AccountIcon name="link" /><strong>{connections.length}</strong><span>Brokerage connection{connections.length === 1 ? '' : 's'}</span></div>
          <div className="accounts-summary-art" aria-hidden="true"><i /><i /><i /><i /></div>
        </div>
      )}

      <div className="accounts-layout">
        <div>
          {accounts.length > 0 ? <>
            <div className="accounts-toolbar"><div className="accounts-filters" role="group" aria-label="Filter accounts"><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All accounts <span>{accounts.length}</span></button><button aria-pressed={filter === 'linked'} onClick={() => setFilter('linked')}>Via Plaid <span>{connectedCount}</span></button></div><span className="accounts-toolbar-hint">Select an account to manage</span></div>
            <div className="accounts-grid">
              {visibleAccounts.map((account) => {
                const feeds = accountSources(account)
                const linked = feeds.some((feed) => feed.id.startsWith('plaid:'))
                const positions = account.positions || []
                const top = [...positions].sort((a, b) => Number(b['MARKET VALUE'] || 0) - Number(a['MARKET VALUE'] || 0)).slice(0, 4)
                return <button className="account-card" key={account.accountNumber} onClick={() => onOpenAccount?.(account)} aria-label={`Manage account ${account.accountNumber}`}>
                  <div className="account-card-top"><span className={`ac-tile ${linked ? 'ac-tile-green' : ''}`}><AccountIcon name={linked ? 'bank' : positions.length ? 'file' : 'wallet'} /></span><span className={`ac-badge ${linked ? 'ac-badge-connected' : ''}`}>{linked ? <><span /> Via Plaid</> : positions.length ? 'Statement' : 'Cash'}</span><AccountIcon name="chevron" size={15} /></div>
                  <h2>{taxSettings.accountTypes?.[account.accountNumber] ? accountTypeLabel(taxAccountType(account, taxSettings) || 'UNKNOWN') : accountTitle(account)}</h2><p className="account-identifier">Account {account.accountNumber}</p>
                  <div className="account-card-balances">{currencyTotals([account]).map(({ currency, value }) => <p key={currency} className="account-card-value">{fmtCurrency(value)} <span>{currency}</span></p>)}</div>
                  <p className="account-card-sources">{feeds.map((feed) => sourceLabel(feed.id)).join(' · ') || 'Cash balance'}</p>
                  <div className="account-card-footer"><div className="account-logos">{top.map((position, index) => <CompanyLogo key={`${position.SYMBOL}-${index}`} symbol={position.SYMBOL} description={position.DESCRIPTION} size={23} />)}</div><span>{positions.length} holding{positions.length === 1 ? '' : 's'}</span><span className="account-cash-label">{fmtCurrency(account.cash || 0)} cash</span></div>
                </button>
              })}
              <button className="account-add-card" onClick={() => onAdd?.()}><span className="ac-tile"><AccountIcon name="plus" /></span><strong>{filter === 'linked' && !visibleAccounts.length ? 'Connect your first brokerage' : 'Bring another account in'}</strong><span>Connect a brokerage or upload a statement</span><span className="ac-text-link">Add account <AccountIcon name="arrow" size={16} /></span></button>
            </div>
          </> : <div className="accounts-empty"><div className="accounts-empty-art" aria-hidden="true"><span className="ac-tile"><AccountIcon name="bank" size={30} /></span><span className="ac-tile"><AccountIcon name="wallet" size={30} /></span></div><p className="accounts-eyebrow">LET’S GET STARTED</p><h2>A home for your investments.</h2><p>Bring your accounts together to see your holdings, cash, and performance.</p><button className="ac-button ac-primary" onClick={() => onAdd?.('connect')}><AccountIcon name="link" size={18} /> Connect a brokerage</button><button className="ac-button ac-secondary" onClick={() => inputRef.current?.click()}><AccountIcon name="upload" size={18} /> Import a statement</button><span className="ac-security"><AccountIcon name="lock" size={14} /> Your money stays with your brokerage.</span></div>}
        </div>

        <aside className="accounts-sidebar">
          <section className="ac-side-card"><div className="ac-side-heading"><h2>Brokerage connections</h2><AccountIcon name="link" size={17} /></div>
            {connections.length ? <div className="ac-connections">{connections.map((connection) => <button key={connection.key} onClick={() => onOpenAccount?.(connection.accounts[0])}><span className="ac-bank-initial">{connection.label[0]}</span><span><strong>{connection.label}</strong><small>{connection.accounts.length} account{connection.accounts.length === 1 ? '' : 's'} via Plaid</small></span><AccountIcon name="chevron" size={14} /></button>)}</div> : <p>Connect your brokerage to bring in the accounts you choose.</p>}
            <button className="ac-text-link" onClick={() => onAdd?.('connect')}><AccountIcon name="plus" size={15} /> Connect a brokerage</button>
          </section>
          <section className={`ac-side-card ac-import-card ${dragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files[0]) onFile?.(event.dataTransfer.files[0]) }}>
            <span className="ac-tile"><AccountIcon name="file" /></span><h2>Prefer a statement?</h2><p>Upload a file from your brokerage. We’ll show you what’s in it before you add it.</p><button className="ac-button ac-secondary" onClick={() => inputRef.current?.click()}><AccountIcon name="upload" size={16} /> Import a statement</button><small>{dragging ? 'Drop your statement here' : 'CSV, XLSX, or PDF · Drag and drop here'}</small>
          </section>
          <p className="ac-sidebar-note"><AccountIcon name="shield" size={19} /><span>You’re in control.<br />Choose what to add. Remove it whenever you need.</span></p>
        </aside>
      </div>
      <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="sr-only" tabIndex={-1} aria-label="Import account statement" onChange={(event) => { if (event.target.files?.[0]) onFile?.(event.target.files[0]); event.target.value = '' }} />
    </section>
  )
}
