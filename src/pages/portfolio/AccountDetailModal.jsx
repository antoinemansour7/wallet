import { useEffect, useRef, useState } from 'react'
import Modal from '../../components/Modal'
import CompanyLogo from '../../components/CompanyLogo'
import { fmtCurrency } from '../../utils/portfolioStats'
import { accountSources, positionSource, sourceLabel } from '../../utils/accountMerge'
import { planAccountRemoval } from '../../utils/accountManagement'
import { accountCurrency, accountTitle, currencyTotals, accountWithholding } from './accountPresentation'
import AccountIcon from './AccountIcons'
import './Accounts.css'

export default function AccountDetailModal({ open, account, accounts = [], onClose, onRemoveSource, onRemoveAccount, busy, error }) {
  const [confirmation, setConfirmation] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const lastAccount = useRef(null)
  const headingRef = useRef(null)
  if (account) lastAccount.current = account
  const displayed = account || lastAccount.current
  useEffect(() => { setConfirmation(null); setShowAll(false) }, [open, displayed?.accountNumber])
  useEffect(() => { if (open) headingRef.current?.focus() }, [confirmation, open])
  if (!displayed) return null
  const withholding = accountWithholding(displayed, { accounts })

  const positions = displayed.positions || []
  const feeds = accountSources(displayed)
  const sorted = [...positions].sort((a, b) => Number(b['MARKET VALUE'] || 0) - Number(a['MARKET VALUE'] || 0))
  const allAccounts = Object.fromEntries((accounts.length ? accounts : [displayed]).map((item) => [item.accountNumber, item]))
  // Retain the reviewed account through the closing animation after its removal.
  if (!allAccounts[displayed.accountNumber]) allAccounts[displayed.accountNumber] = displayed
  const plan = confirmation ? planAccountRemoval({ accounts: allAccounts, accountNumber: displayed.accountNumber, sourceId: confirmation.sourceId }) : null
  const remaining = plan?.nextAccounts[displayed.accountNumber]
  const balances = currencyTotals([displayed])
  const afterBalances = remaining ? currencyTotals([remaining]) : []
  const removedBalances = balances.map(({ currency, value }) => ({ currency, value: value - (afterBalances.find((item) => item.currency === currency)?.value || 0) })).filter((item) => item.value !== 0)
  const balanceText = (items) => items.map(({ currency, value }) => <span className="ac-currency-amount" key={currency}>{fmtCurrency(value)} <small>{currency}</small></span>)
  const removedPositions = confirmation?.sourceId ? positions.filter((row) => positionSource(row) === confirmation.sourceId).length : positions.length
  const disconnects = plan?.operations.filter((operation) => operation.action === 'disconnect') || []
  const keeps = plan?.operations.filter((operation) => operation.action !== 'disconnect') || []

  const confirm = async () => {
    const result = confirmation.sourceId ? await onRemoveSource?.(displayed.accountNumber, confirmation.sourceId) : await onRemoveAccount?.(displayed.accountNumber)
    if (result !== false) setConfirmation(null)
  }

  return <Modal open={open} onClose={onClose} labelledBy="account-detail-title" className="accounts-ui accounts-dialog" dismissible={!busy}>
    <div className="ac-dialog-nav">{confirmation && <button type="button" className="ac-icon-button" aria-label="Back to account" disabled={busy} onClick={() => setConfirmation(null)}><AccountIcon name="back" size={18} /></button>}<span>{confirmation ? 'REVIEW REMOVAL' : 'ACCOUNT DETAILS'}</span><button type="button" className="ac-icon-button" aria-label="Close" disabled={busy} onClick={onClose}><AccountIcon name="close" size={18} /></button></div>
    <div className="ac-dialog-body">
      {confirmation ? <div className="modal-step"><div className="ac-remove-intro"><span className="ac-tile"><AccountIcon name="trash" size={23} /></span><h2 id="account-detail-title" ref={headingRef} tabIndex={-1}>{confirmation.sourceId ? 'Remove this import?' : 'Remove this account?'}</h2><p>{confirmation.sourceId ? `Remove ${sourceLabel(confirmation.sourceId)} and the holdings it added to account ${displayed.accountNumber}.` : `Remove account ${displayed.accountNumber}, including its holdings and recorded cash, from WallAI.`}</p></div><div className="ac-removal-summary"><div><span>Holdings to remove</span><strong>{removedPositions}</strong></div><div><span>Value removed from WallAI</span><strong>{removedBalances.length ? balanceText(removedBalances) : fmtCurrency(0)}</strong></div><div><span>Account after removal</span><strong>{remaining ? balanceText(afterBalances) : 'Removed from portfolio'}</strong></div></div>
        {disconnects.length > 0 && <p className="ac-inline-note">{disconnects.length === 1 ? 'This is the last account using this connection. We’ll also disconnect the brokerage from Plaid.' : 'We’ll also disconnect the brokerage connections no longer used by another account.'}</p>}
        {keeps.length > 0 && <p className="ac-inline-note">Your other accounts at this brokerage will stay connected.{keeps.some((operation) => operation.action === 'keep-connection') ? ' This older import can be removed from WallAI, but its existing brokerage access will stay active.' : ''}</p>}
        <p className="ac-remove-footer-note" style={{ marginTop: 18 }}>This only changes your WallAI portfolio. It doesn’t close your brokerage account, sell investments, or move money. You can add the account again later.</p>
      </div> : <>
        <div className="ac-detail-hero"><span className="ac-tile ac-tile-green"><AccountIcon name={positions.length ? 'bank' : 'wallet'} size={23} /></span><h2 id="account-detail-title" ref={headingRef} tabIndex={-1}>{accountTitle(displayed)}</h2><p>Account {displayed.accountNumber}</p><div className="ac-detail-balance">{balanceText(balances)}</div><dl className="ac-detail-stats"><div><dt>Investments</dt><dd>{balanceText(currencyTotals([{ ...displayed, cash: 0 }]))}</dd></div><div><dt>Cash balance</dt><dd>{fmtCurrency(displayed.cash || 0)} <small>{accountCurrency(displayed)}</small></dd></div></dl></div>
        <div className="ac-section-label"><span>Connections & statements</span><span>{feeds.length}</span></div>
        {feeds.length ? <div className="ac-choice-list">{feeds.map((feed) => <div className="ac-feed" key={feed.id}><span className={`ac-tile ${feed.id.startsWith('plaid:') ? 'ac-tile-green' : ''}`}><AccountIcon name={feed.id.startsWith('plaid:') ? 'link' : 'file'} size={17} /></span><div><strong>{sourceLabel(feed.id)}</strong><small>{feed.id.startsWith('plaid:') ? 'Via Plaid' : 'Imported statement'} · {feed.positions} holding{feed.positions === 1 ? '' : 's'}</small></div><button type="button" className="ac-icon-button" aria-label={`Remove ${sourceLabel(feed.id)}`} disabled={busy} onClick={() => setConfirmation({ sourceId: feed.id })}><AccountIcon name="trash" size={16} /></button></div>)}</div> : <p className="ac-inline-note">This account contains a recorded cash balance, with no imported holdings.</p>}
        {positions.length > 0 && <><div className="ac-section-label"><span>Holdings</span><span>{positions.length}</span></div>{(showAll ? sorted : sorted.slice(0, 5)).map((position, index) => <div className="ac-holding" key={`${position.SYMBOL}-${index}`}><CompanyLogo symbol={position.SYMBOL} description={position.DESCRIPTION} size={30} /><div className="ac-holding-main"><strong>{position.SYMBOL}</strong><small>{position.DESCRIPTION}</small></div><span>{fmtCurrency(position['MARKET VALUE'])}</span></div>)}{sorted.length > 5 && <button type="button" className="ac-text-link" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : `Show all ${sorted.length} holdings`}</button>}</>}
        {withholding && withholding.annualWithheldMinor > 0 && <>
          <div className="ac-section-label"><span>Foreign withholding</span><span>{fmtCurrency(withholding.annualWithheldMinor / 100)}{withholding.basis === 'projected' ? '/yr' : ''}</span></div>
          <p className="ac-inline-note">{withholding.unavoidable
            ? `Taken inside the fund before any distribution reaches this account. No account type changes that, and it cannot be recovered.`
            : `US dividends are taxed 15% before they reach this ${withholding.accountType}. ${withholding.recoverable ? 'It is recoverable through the foreign tax credit.' : 'It cannot be recovered.'}`}</p>
          {withholding.comparison?.map((option) => <p className="ac-inline-note" key={option.accountType}>In your {option.accountType}, that would have been {fmtCurrency(option.annualWithheldMinor / 100)}.</p>)}
          <p className="ac-inline-note">{withholding.basis === 'measured'
            ? `Measured from ${withholding.workings.recordCount} record${withholding.workings.recordCount === 1 ? '' : 's'} between ${withholding.workings.from} and ${withholding.workings.to}.`
            : `${fmtCurrency(withholding.workings.marketValueMinor / 100)} x ${withholding.workings.yieldPct}% assumed yield x ${withholding.workings.withholdingRatePct}%, projected.`}</p>
          {withholding.contributors.length > 0 && <p className="ac-inline-note">From {withholding.contributors.join(', ')}.</p>}
        </>}
      </>}
      {error && <div role="alert" className="ac-inline-error">{error}</div>}
    </div>
    <div className="ac-dialog-footer"><div className="ac-dialog-footer-actions">{confirmation ? <><button type="button" className="ac-button ac-secondary" disabled={busy} onClick={() => setConfirmation(null)}>Keep account</button><button type="button" className="ac-button ac-danger" disabled={busy} onClick={confirm}>{busy && <span className="ac-spinner" aria-hidden="true" />}{busy ? 'Removing…' : confirmation.sourceId ? 'Remove import' : 'Remove account'}</button></> : <><button type="button" className="ac-button ac-danger" disabled={busy} onClick={() => setConfirmation({ sourceId: null })}><AccountIcon name="trash" size={15} /> Remove account</button><button type="button" className="ac-button ac-primary" onClick={onClose}>Done</button></>}</div></div>
  </Modal>
}
