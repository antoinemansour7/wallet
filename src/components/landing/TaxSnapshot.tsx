import type { ReactNode } from 'react'
import './tax-preview.css'

// Illustrative amounts, not a user's data or an estimate of tax savings.
// These separate metrics deliberately retain their different periods/bases.
export default function TaxSnapshot({ amount = '312', animateBars = false }: { amount?: ReactNode; animateBars?: boolean }) {
  return <div className={`wa-tax-snapshot ${animateBars ? 'wa-tax-snapshot-animated' : ''}`}>
    <div className="wa-tax-snapshot-head"><span><i /> Tax & costs</span><span>Illustrative figures</span></div>
    <div className="wa-tax-snapshot-label"><span>Dividend withholding</span><span className="wa-tax-badge">Annual estimate</span></div>
    <div className="wa-tax-snapshot-amount" aria-label="312 Canadian dollars per year"><span aria-hidden="true">${amount}<span className="wa-tax-cents">.00</span></span><small aria-hidden="true">CAD / year</small></div>
    <p className="wa-tax-snapshot-note">See the cost behind your dividends.</p>
    <div className="wa-tax-bars" aria-label="Illustrative annual withholding by account">
      {[{ name: 'TFSA', value: 156 }, { name: 'RRSP', value: 104 }, { name: 'Non-registered', value: 52 }].map(account => <div className="wa-tax-bar-row" key={account.name}><div><span>{account.name}</span><span>${account.value}.00</span></div><svg viewBox="0 0 312 4" preserveAspectRatio="none" aria-hidden="true"><path d="M0 2H312" stroke="var(--wa-dark-line)" strokeWidth="4" /><path className="wa-tax-bar-fill" d={`M0 2H${account.value * 2}`} stroke="var(--wa-sage)" strokeWidth="4" pathLength="1" strokeDasharray="1" /></svg></div>)}
    </div>
    <div className="wa-tax-snapshot-metrics"><div><span>Fund expenses</span><strong>$184.00</strong><small>CAD / year · Estimated</small></div><div><span>FX costs</span><strong>$96.00</strong><small>CAD / year to date · Measured</small></div></div>
    <div className="wa-tax-snapshot-footer"><span aria-hidden="true">✳</span><div><strong>Know what’s measured. See what’s estimated.</strong><small>Account types and available records matter.</small></div></div>
  </div>
}
