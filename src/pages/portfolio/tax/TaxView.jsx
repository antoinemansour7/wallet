import { useMemo, useState } from 'react'
import AccountIcon from '../AccountIcons'
import { accountTitle } from '../accountPresentation'
import { projectWithholding } from '../../../utils/withholdingTax'
import { conversionComparison } from '../../../utils/currencyConversion'
import { ACCOUNT_TYPES, accountTypeLabel, contributionRoom, localTaxDate, money, recordedFees, saleScenario, taxAccountType, taxOverview, taxProjectionRow, validNumber } from './taxModel'
import './Tax.css'

const CRA_TFSA = 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributing/before.html'
const CRA_RRSP = 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/contributing-a-rrsp-prpp.html'
const TREATY = 'https://www.canada.ca/en/department-finance/programs/tax-policy/tax-treaties/country/united-states-america-convention-consolidated-1980-1983-1984-1995-1997-2007.html'
const Field = ({ label, children, hint }) => <label className="tax-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
const SectionHeading = ({ number, title, subtitle, aside }) => <div className="tax-section-heading"><div><span className="tax-overline">{number}</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{aside}</div>
const Badge = ({ children }) => <span className="tax-badge">{children}</span>

export function TaxOverviewPointer({ accounts, settings, onOpen }) {
  const types = accounts.filter((a) => taxAccountType(a, settings)).length
  return <button type="button" className="tax-pointer" onClick={onOpen}>
    <AccountIcon name="shield" size={17} /><span>Tax & costs <span>Withholding, fees and contribution room across {accounts.length} accounts{types < accounts.length ? ' · Account details needed' : ''}</span></span><span className="tax-pointer-cta">Explore tax <AccountIcon name="arrow" size={15} /></span>
  </button>
}

export function AccountTaxSection({ account, settings = {}, onOpenTax }) {
  const currencies = [...new Set((account.positions || []).map((r) => r['ACCOUNT CURRENCY'] || account.currency).filter(Boolean))]
  const summaries = currencies.map((currency) => taxOverview([account], settings, currency))
  const covered = summaries.some((s) => s.covered)
  return <section className="tax-account-section" aria-label="Account withholding">
    <div><span>Dividend withholding</span><Badge>Estimate</Badge></div>
    {covered ? <p className="tax-account-amount">{summaries.filter((s) => s.covered).map((s) => <span key={s.currency}>{money(s.annualMinor, s.currency)} <small>{s.currency} / year</small></span>)}</p> : <p className="tax-account-amount">Not estimated</p>}
    <p>{!taxAccountType(account, settings) ? 'Add the account’s registration type to estimate its withholding.' : covered ? `Based on a ${settings.yieldPct ?? 1.3}% assumed US dividend yield. Fund-level withholding is excluded.` : 'The current holdings need more listing or distribution information for a withholding estimate.'}</p>
    {onOpenTax && <button type="button" className="tax-text-button" onClick={onOpenTax}>Compare on the Tax page <AccountIcon name="arrow" size={14} /></button>}
  </section>
}

function WithholdingSimulator({ accounts, settings, currency }) {
  const eligible = accounts.flatMap((account) => (account.positions || []).filter((row) => (row['ACCOUNT CURRENCY'] || account.currency) === currency && taxProjectionRow(row))
    .map((row, index) => ({ account, row, key: `${account.accountNumber}:${row.SYMBOL}:${index}` })))
  const [holdingKey, setHoldingKey] = useState('')
  const [leftKey, setLeftKey] = useState('')
  const [rightKey, setRightKey] = useState('')
  const [years, setYears] = useState(10)
  const holding = eligible.find((h) => h.key === holdingKey) || eligible[0]
  const typedAccounts = accounts.filter((a) => taxAccountType(a, settings))
  const left = typedAccounts.find((a) => a.accountNumber === leftKey) || typedAccounts.find((a) => a.accountNumber === holding?.account.accountNumber) || typedAccounts[0]
  const right = typedAccounts.find((a) => a.accountNumber === rightKey) || typedAccounts.find((a) => taxAccountType(a, settings) !== taxAccountType(left || {}, settings)) || typedAccounts[0]
  const projections = [left, right].map((account) => account && holding ? projectWithholding({ row: taxProjectionRow(holding.row), accountType: taxAccountType(account, settings), assumptions: { yieldPct: settings.yieldPct ?? 1.3 } }) : null)
  const inFund = projections.some((p) => p?.treatment === 'IN_FUND')
  const comparable = projections.every(Boolean) && !inFund
  const difference = comparable ? Math.abs(projections[0].annualWithheldMinor - projections[1].annualWithheldMinor) * years : null
  return <section className="tax-card tax-simulator" id="tax-simulator">
    <SectionHeading number="02 / COMPARE" title="Same holding. Different account." subtitle="Change the account, keeping the investment and yield the same." />
    {!holding || typedAccounts.length < 2 ? <div className="tax-empty"><AccountIcon name="bank" size={24} /><h3>A comparison needs two accounts</h3><p>Set the registration types above. Eligible holdings in {currency} will appear here.</p></div> : <>
      <Field label="Holding"><select value={holding.key} onChange={(e) => setHoldingKey(e.target.value)}>{eligible.map((h) => <option key={h.key} value={h.key}>{h.row.SYMBOL} · {h.account.accountNumber}</option>)}</select></Field>
      <div className="tax-comparison">
        {[left, right].map((account, index) => <div className="tax-comparison-option" key={index}>
          <Field label={index === 0 ? 'Account A' : 'Account B'}><select value={account.accountNumber} onChange={(e) => (index === 0 ? setLeftKey : setRightKey)(e.target.value)}>{typedAccounts.map((a) => <option key={a.accountNumber} value={a.accountNumber}>{accountTypeLabel(taxAccountType(a, settings))} · {a.accountNumber}</option>)}</select></Field>
          <small>Annual withholding</small><strong>{comparable ? money(projections[index].annualWithheldMinor, currency) : '—'}</strong>
          <p>{inFund ? 'Fund-level distributions needed' : projections[index]?.exempt ? 'Treaty-exempt in this scenario' : projections[index]?.recoverable ? 'Potential foreign tax credit' : projections[index] ? 'Withholding is not recoverable' : 'No direct US withholding modeled'}</p>
        </div>)}
      </div>
      <div className="tax-period"><label htmlFor="tax-years">Illustration over <strong>{years} years</strong></label><input id="tax-years" type="range" min="1" max="30" value={years} onChange={(e) => setYears(Number(e.target.value))} /></div>
      <div className="tax-comparison-result"><span>Difference in withholding<br /><small>Same value and yield each year, no compounding</small></span><strong>{money(difference, currency)} <small>{currency}</small></strong></div>
      <p className="tax-footnote">This compares dividend withholding only. It excludes Canadian income tax, contribution deductions, withdrawal tax and investment returns.</p>
    </>}
  </section>
}

function ContributionCard({ type, record, disabled, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ room: '', contributed: '0', asOf: '' })
  const [planned, setPlanned] = useState('')
  const today = localTaxDate()
  const room = contributionRoom(record, today, planned)
  const startEdit = () => { setDraft({ room: record?.room ?? '', contributed: record?.contributed ?? '0', asOf: record?.asOf || today }); setEditing(true) }
  const submit = async (e) => { e.preventDefault(); if (await onSave(draft)) setEditing(false) }
  return <div className="tax-room-card">
    <div className="tax-room-title"><h3>{type}</h3><button type="button" className="tax-text-button" disabled={disabled} onClick={startEdit}>{record ? 'Edit figures' : 'Add room'} <AccountIcon name="plus" size={13} /></button></div>
    {editing ? <form onSubmit={submit} className="tax-room-form">
      <Field label={`${type} available room (CAD)`}><input type="number" step="0.01" required value={draft.room} onChange={(e) => setDraft({ ...draft, room: e.target.value })} /></Field>
      <Field label="Accurate as of"><input type="date" required max={today} value={draft.asOf} onChange={(e) => setDraft({ ...draft, asOf: e.target.value })} /></Field>
      <Field label="Contributions since that date (CAD)" hint="Total across all your accounts of this type."><input type="number" min="0" step="0.01" required value={draft.contributed} onChange={(e) => setDraft({ ...draft, contributed: e.target.value })} /></Field>
      <div className="tax-actions"><button className="tax-button" disabled={disabled} type="submit">{disabled ? 'Saving…' : 'Save figures'}</button><button className="tax-text-button" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
    </form> : <>
      <strong className={`tax-room-amount ${room.remainingMinor < 0 ? 'tax-negative' : ''}`}>{room.status === 'current' ? money(room.remainingMinor) : room.status === 'stale' ? 'Needs an update' : 'Not entered'} <small>{room.status === 'current' ? 'CAD remaining' : ''}</small></strong>
      <p>{room.status === 'current' ? `Based on your figures as of ${room.asOf}. Contributions entered: ${money(room.contributedMinor)}.` : room.status === 'stale' ? `Your last figure is from ${room.asOf}. Enter this year’s room before checking a contribution.` : `Use your own records and ${type === 'TFSA' ? 'CRA account' : 'latest notice of assessment'}. Room is shared across all ${type}s.`}</p>
      {room.status === 'current' && <><Field label={`Check a planned ${type} contribution (CAD)`}><input type="number" min="0" step="0.01" placeholder="0.00" value={planned} onChange={(e) => setPlanned(e.target.value)} /></Field>{room.afterMinor !== null && <p role="status" className={room.afterMinor < 0 ? 'tax-notice tax-negative' : 'tax-notice'}>{room.afterMinor < 0 ? `${money(Math.abs(room.afterMinor))} above the room you recorded.` : `${money(room.afterMinor)} would remain based on your figures.`}</p>}</>}
    </>}
  </div>
}

function ContributionSection({ workspace }) {
  const { settings, update, loading, saving, loadFailed } = workspace
  return <section className="tax-card" id="tax-room"><SectionHeading number="03 / CONTRIBUTIONS" title="Room to contribute" subtitle="Your figures, across every account of the same type." aside={<Badge>CAD</Badge>} />
    {['TFSA', 'RRSP'].map((type) => <ContributionCard key={type} type={type} record={settings.room?.[type]} disabled={loading || saving || loadFailed}
      onSave={(record) => update({ room: { ...settings.room, [type]: record } })} />)}
    <p className="tax-footnote">Contributions are entered manually; bank transfers and cash balances are not treated as deposits. TFSA withdrawals do not add room until the following calendar year. New-year limits are not added automatically.</p>
    <div className="tax-source-links"><a href={CRA_TFSA} target="_blank" rel="noreferrer">TFSA rules ↗</a><a href={CRA_RRSP} target="_blank" rel="noreferrer">RRSP room ↗</a></div>
  </section>
}

function ConversionSection() {
  const [amount, setAmount] = useState('10000')
  const [spread, setSpread] = useState('1.5')
  const [commission, setCommission] = useState('9.95')
  const [bidAsk, setBidAsk] = useState('0.1')
  const base = conversionComparison({ amountCad: validNumber(amount) })
  const valid = base && [spread, commission, bidAsk].every((v) => validNumber(v) !== null) && Number(spread) <= 100 && Number(bidAsk) <= 100
  const brokerMinor = valid ? Math.round(Number(amount) * Number(spread)) : null
  const gambitMinor = valid ? Math.round(Number(amount) * Number(bidAsk)) + Math.round(Number(commission) * 100) * 2 : null
  return <section className="tax-card" id="tax-conversion"><SectionHeading number="04 / CURRENCY" title="What does converting cost?" subtitle="Compare costs for a CAD-to-USD conversion." aside={<Badge>Scenario</Badge>} />
    <div className="tax-input-grid"><Field label="Amount to convert (CAD)"><input type="number" min="0" step="100" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="Broker FX spread (%)"><input type="number" min="0" max="100" step="0.01" value={spread} onChange={(e) => setSpread(e.target.value)} /></Field><Field label="Commission per trade (CAD)"><input type="number" min="0" step="0.01" value={commission} onChange={(e) => setCommission(e.target.value)} /></Field><Field label="Combined bid–ask cost (%)"><input type="number" min="0" max="100" step="0.01" value={bidAsk} onChange={(e) => setBidAsk(e.target.value)} /></Field></div>
    <div className="tax-cost-row"><span>Broker conversion</span><strong>{money(brokerMinor)} <small>CAD</small></strong></div><div className="tax-cost-row"><span>Norbert’s Gambit <small>Two commissions + bid–ask cost</small></span><strong>{money(gambitMinor)} <small>CAD</small></strong></div>
    {valid ? <div className="tax-scenario-difference"><span>Difference under these assumptions</span><strong>{money(brokerMinor - gambitMinor)} CAD</strong></div> : <p className="tax-notice">{validNumber(amount) !== null && Number(amount) < 5000 ? 'Enter at least $5,000 CAD to compare this approach.' : 'Enter valid amounts and percentages to compare costs.'}</p>}
    <details className="tax-details"><summary>How this comparison works</summary><p>Norbert’s Gambit uses a dual-currency security such as DLR / DLR.U: buy in CAD, journal to its USD listing, then sell in USD. Confirm eligibility, commissions and journalling steps with your broker. These are editable examples, not a quote from your brokerage. The exchange rate can move between trades; settlement and waiting costs are excluded.</p></details>
  </section>
}

function FeesSection({ ledger, year }) {
  const fees = recordedFees(ledger.transactions, year)
  const hasTransactions = ledger.transactions.some((t) => t.tradeDate?.startsWith(`${year}-`))
  return <section className="tax-card" id="tax-fees"><SectionHeading number="05 / FEES" title="The cost of your accounts" subtitle={`Recorded charges in ${year}, kept in their original currency.`} aside={<Badge>Recorded</Badge>} />
    {ledger.loading ? <p className="tax-loading" role="status">Loading recorded charges…</p> : !hasTransactions ? <div className="tax-empty"><AccountIcon name="file" size={25} /><h3>No fee history available</h3><p>Commissions and account fees appear when transaction history is available. Holdings alone don’t show what you paid.</p></div> : fees.totals.map((total) => <div key={total.currency} className="tax-fee-currency"><div className="tax-fee-total"><span>{total.currency}</span><strong>{money(total.commissionsMinor + total.accountFeesMinor, total.currency)}</strong></div><div className="tax-cost-row"><span>Trading commissions</span><span>{money(total.commissionsMinor, total.currency)}</span></div><div className="tax-cost-row"><span>Account & service fees</span><span>{money(total.accountFeesMinor, total.currency)}</span></div></div>)}
    <p className="tax-footnote">Fund expenses and FX spreads are not included in recorded charges. They need separate cost data.{fees.missing > 0 ? ` ${fees.missing} incomplete records were excluded.` : ''}</p>
  </section>
}

function SalesSection({ ledger }) {
  const sales = useMemo(() => ledger.transactions.filter((t) => t.action === 'SELL').sort((a, b) => b.tradeDate.localeCompare(a.tradeDate)), [ledger.transactions])
  const [selected, setSelected] = useState('')
  const [price, setPrice] = useState('')
  const sale = sales.find((t) => t.id === selected) || sales[0]
  const comparison = saleScenario(sale, price)
  return <section className="tax-card" id="tax-sales"><SectionHeading number="06 / YOUR DECISIONS" title="After a sale" subtitle="Compare a recorded sale with holding the same number of shares." aside={<Badge>Price-only scenario</Badge>} />
    {ledger.loading ? <p className="tax-loading" role="status">Loading sales…</p> : !sale ? <div className="tax-empty tax-empty-wide"><AccountIcon name="file" size={24} /><div><h3>Your sale history starts with a transaction</h3><p>Actual sales and partial sales will appear here. Removing an account or an import never counts as a sale.</p></div></div> : <>
      <div className="tax-input-grid"><Field label="Recorded sale"><select value={sale.id} onChange={(e) => { setSelected(e.target.value); setPrice('') }}>{sales.map((t) => <option key={t.id} value={t.id}>{t.symbol} · {Math.abs(t.quantity)} shares · {t.tradeDate} · {t.currency}</option>)}</select></Field><Field label={`Comparison price per share (${sale.currency || 'currency unknown'})`}><input type="number" min="0" step="0.0001" placeholder="Enter a price" value={price} onChange={(e) => setPrice(e.target.value)} /></Field></div>
      <div className="tax-sale-comparison"><div><span>Sale proceeds before fees</span><strong>{money(comparison?.grossProceedsMinor ?? (Number.isFinite(sale.priceMinor) && Number.isFinite(sale.quantity) ? Math.round(Math.abs(sale.quantity) * sale.priceMinor) : null), sale.currency || 'CAD')}</strong><small>{sale.tradeDate}</small></div><div><span>Value at your comparison price</span><strong>{money(comparison?.heldValueMinor, sale.currency || 'CAD')}</strong><small>Same share count</small></div><div><span>Difference from holding</span><strong>{comparison ? `${comparison.differenceMinor > 0 ? '+' : ''}${money(comparison.differenceMinor, comparison.currency)}` : '—'}</strong><small>{comparison ? comparison.differenceMinor > 0 ? 'Holding would be worth more' : comparison.differenceMinor < 0 ? 'Selling avoided this price decline' : 'No price difference' : 'Enter a price to compare'}</small></div></div>
      <p className="tax-footnote">Uses the price you enter, not a live quote. Excludes dividends, fees, tax, splits and what happened to the sale proceeds. Adjust for corporate actions before comparing.</p>
    </>}
  </section>
}

export default function TaxView({ accounts, workspace, onOpenAccount, onAddAccount }) {
  const { settings, loading, saving, error, loadFailed, update, ledger } = workspace
  const currencies = [...new Set(accounts.flatMap((a) => [a.currency, ...(a.positions || []).map((r) => r['ACCOUNT CURRENCY'])]).filter(Boolean))].sort()
  const [chosenCurrency, setCurrency] = useState('CAD')
  const currency = currencies.includes(chosenCurrency) ? chosenCurrency : currencies[0] || 'CAD'
  const summary = useMemo(() => taxOverview(accounts, settings, currency), [accounts, settings, currency])
  const [yieldDraft, setYieldDraft] = useState(null)
  const year = new Date().getFullYear()
  const changeType = (accountNumber, type) => update({ accountTypes: { ...settings.accountTypes, [accountNumber]: type } })
  return <div className="tax-page">
    <header className="tax-header"><div><div className="tax-overline">YOUR PORTFOLIO / {year}</div><h1>Tax & costs</h1><p>The whole picture, across all your accounts.</p></div><div className="tax-currency-control" role="group" aria-label="Tax display currency">{currencies.map((value) => <button type="button" key={value} aria-pressed={currency === value} onClick={() => setCurrency(value)}>{value}</button>)}</div></header>
    {error && <p className="tax-error" role="alert">{error}</p>}{ledger.error && <p className="tax-error" role="alert">{ledger.error}</p>}{ledger.limited && <p className="tax-notice">Showing the latest 5,000 transactions. Earlier history is excluded from fees and sale comparisons.</p>}
    <section className="tax-hero" aria-label="Portfolio withholding summary"><div className="tax-hero-main"><div className="tax-hero-label">Illustrative annual withholding <Badge>Estimate</Badge></div><div className="tax-hero-amount">{loading ? '—' : summary.covered ? money(summary.annualMinor, currency) : 'Not estimated'} <span>{summary.covered ? `${currency} / year` : ''}</span></div><p>{summary.covered ? `On ${money(summary.coveredValueMinor, currency)} of modeled holdings.` : 'Confirm account types and listing details to build your estimate.'}</p></div><div className="tax-hero-details"><div><span>Potential foreign tax credit</span><strong>{summary.covered ? money(summary.creditMinor, currency) : '—'} <small>{currency}</small></strong></div><div><span>Holdings included</span><strong>{summary.covered} <small>in {currency}</small></strong></div><div><span>Need more information</span><strong>{summary.gaps.length} <small>holdings</small></strong></div></div></section>
    <div className="tax-assumption-line"><span>Assumes US-source dividends and treaty eligibility. Fund-level withholding is excluded.</span><form onSubmit={async (e) => { e.preventDefault(); if (await update({ yieldPct: Number(yieldDraft ?? settings.yieldPct ?? 1.3) })) setYieldDraft(null) }}><label htmlFor="tax-yield">Dividend yield</label><input id="tax-yield" type="number" min="0" max="100" step="0.1" required value={yieldDraft ?? settings.yieldPct ?? 1.3} onChange={(e) => setYieldDraft(e.target.value)} /><span>%</span><button type="submit" disabled={loading || saving || loadFailed || yieldDraft === null}>Apply</button></form></div>
    <nav className="tax-section-nav" aria-label="Tax sections">{[['tax-accounts', 'Accounts'], ['tax-simulator', 'Compare'], ['tax-room', 'Contribution room'], ['tax-conversion', 'Currency'], ['tax-fees', 'Fees'], ['tax-sales', 'Sales']].map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
    <section className="tax-card tax-accounts" id="tax-accounts"><SectionHeading number="01 / ACROSS YOUR ACCOUNTS" title="Where withholding happens" subtitle="Account registration changes the treatment. Currency totals stay separate." />
      {accounts.length === 0 && <div className="tax-empty"><AccountIcon name="bank" size={24} /><h3>Bring your accounts together</h3><p>Add an account to see withholding and compare its treatment. You can enter contribution room below at any time.</p>{onAddAccount && <button type="button" className="tax-text-button" onClick={onAddAccount}>Add an account <AccountIcon name="plus" size={14} /></button>}</div>}
      {accounts.length > 0 && <div className="tax-table-wrap"><table className="tax-account-table"><thead><tr><th>Account</th><th>Registration</th><th>Annual withholding</th><th>Treatment & coverage</th></tr></thead><tbody>{summary.rows.map(({ account, type, annualMinor, holdings, gaps }) => <tr key={account.accountNumber}><th><button type="button" onClick={() => onOpenAccount?.(account)}>{accountTitle(account)}<span>{account.accountNumber} <AccountIcon name="arrow" size={12} /></span></button></th><td><select aria-label={`Registration for ${account.accountNumber}`} value={type || ''} disabled={loading || saving || loadFailed} onChange={(e) => changeType(account.accountNumber, e.target.value)}><option value="">Choose type</option>{ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{accountTypeLabel(type)}</option>)}</select></td><td className="tax-numeric"><strong>{holdings.length ? money(annualMinor, currency) : '—'}</strong><small>{holdings.length ? `${currency} / year` : 'Not estimated'}</small></td><td><span className={`tax-treatment ${holdings.length && holdings.every((h) => h.projection.exempt) ? 'tax-treatment-exempt' : ''}`}>{!(account.positions || []).some((r) => (r['ACCOUNT CURRENCY'] || account.currency) === currency) ? `No holdings in ${currency}` : !type ? 'Account type needed' : !holdings.length ? 'More information needed' : holdings.some((h) => h.projection.recoverable) ? 'Potential tax credit' : holdings.every((h) => h.projection.exempt) ? 'Treaty-exempt scenario' : 'Not recoverable'}</span><small>{holdings.length} modeled{gaps.length ? ` · ${gaps.length} not estimated` : ''}</small></td></tr>)}</tbody></table></div>}
      {summary.gaps.length > 0 && <details className="tax-details tax-coverage"><summary>What’s not included · {summary.gaps.length} holdings</summary><ul>{summary.gaps.map(({ row, reason }, i) => <li key={`${row.SYMBOL}:${i}`}><span>{row.SYMBOL}</span><span>{reason}</span></li>)}</ul></details>}
    </section>
    <div className="tax-main-grid"><WithholdingSimulator accounts={accounts} settings={settings} currency={currency} /><ContributionSection workspace={workspace} /><ConversionSection /><FeesSection ledger={ledger} year={year} /></div>
    <SalesSection ledger={ledger} />
    <footer className="tax-footer"><span>Estimates and recorded charges are shown separately. This page is not a tax return.</span><a href={TREATY} target="_blank" rel="noreferrer">Canada–US treaty · Articles X & XXI ↗</a></footer>
  </div>
}
