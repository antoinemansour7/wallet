import { useMemo, useState } from 'react'
import AccountIcon from '../AccountIcons'
import { accountTitle, accountTypeOf } from '../accountPresentation'
import { projectWithholding } from '../../../utils/withholdingTax'
import { summarizeFundFees } from '../../../utils/fundFees'
import { toMinorUnits } from '../../../utils/money'
import { conversionComparison } from '../../../utils/currencyConversion'
import { measureConversionCost } from '../../../utils/conversionCost'
import { ACCOUNT_TYPES, accountTypeLabel, contributionView, localTaxDate, money, saleReview, taxAccountType, taxOverview, validNumber } from './taxModel'
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

export function AccountTaxSection({ account, settings = {}, data = {}, onOpenTax }) {
  const currencies = [...new Set((account.positions || []).map((r) => r['ACCOUNT CURRENCY'] || account.currency).filter(Boolean))]
  const summaries = currencies.map((currency) => taxOverview([account], settings, currency, data))
  const covered = summaries.some((s) => s.covered)
  return <section className="tax-account-section" aria-label="Account withholding">
    <div><span>Dividend withholding</span><Badge>{summaries.every((s) => s.basis === 'measured') ? 'Recorded · 12 months' : 'Estimate'}</Badge></div>
    {covered ? <p className="tax-account-amount">{summaries.filter((s) => s.covered).map((s) => <span key={s.currency}>{money(s.annualMinor, s.currency)} <small>{s.currency} / year</small></span>)}</p> : <p className="tax-account-amount">Not estimated</p>}
    <p>{!taxAccountType(account, settings) ? 'Add the account’s registration type to estimate its withholding.' : covered ? 'Recorded figures require a full year of history. Estimates use resolved yields where available and label assumed yields on the Tax page.' : 'The current holdings need more listing or distribution information for a withholding estimate.'}</p>
    {onOpenTax && <button type="button" className="tax-text-button" onClick={onOpenTax}>Compare on the Tax page <AccountIcon name="arrow" size={14} /></button>}
  </section>
}

function WithholdingSimulator({ accounts, settings, currency, reference = {} }) {
  const eligible = accounts.flatMap((account) => (account.positions || []).filter((row) => (row['ACCOUNT CURRENCY'] || account.currency) === currency && reference[String(row.SYMBOL).toUpperCase()]?.exchange)
    .map((row, index) => ({ account, row, key: `${account.accountNumber}:${row.SYMBOL}:${index}` })))
  const [holdingKey, setHoldingKey] = useState('')
  const [leftKey, setLeftKey] = useState('')
  const [rightKey, setRightKey] = useState('')
  const [years, setYears] = useState(10)
  const holding = eligible.find((h) => h.key === holdingKey) || eligible[0]
  const typedAccounts = accounts.filter((a) => taxAccountType(a, settings))
  const left = typedAccounts.find((a) => a.accountNumber === leftKey) || typedAccounts.find((a) => a.accountNumber === holding?.account.accountNumber) || typedAccounts[0]
  const right = typedAccounts.find((a) => a.accountNumber === rightKey) || typedAccounts.find((a) => taxAccountType(a, settings) !== taxAccountType(left || {}, settings)) || typedAccounts[0]
  const projections = [left, right].map((account) => account && holding ? projectWithholding({ row: holding.row, securityReference: reference[String(holding.row.SYMBOL).toUpperCase()], accountType: taxAccountType(account, settings), assumptions: { yieldPct: settings.yieldPct ?? 1.3 } }) : null)
  const inFund = projections.some((p) => p?.treatment === 'IN_FUND')
  const comparable = projections.every(Boolean)
  const difference = comparable ? Math.abs(projections[0].annualWithheldMinor - projections[1].annualWithheldMinor) * years : null
  return <section className="tax-card tax-simulator" id="tax-simulator">
    <SectionHeading number="02 / COMPARE" title="Same holding. Different account." subtitle="Change the account, keeping the investment and yield the same." />
    {!holding || typedAccounts.length < 2 ? <div className="tax-empty"><AccountIcon name="bank" size={24} /><h3>A comparison needs two accounts</h3><p>Set the registration types above. Eligible holdings in {currency} will appear here.</p></div> : <>
      <Field label="Holding"><select value={holding.key} onChange={(e) => setHoldingKey(e.target.value)}>{eligible.map((h) => <option key={h.key} value={h.key}>{h.row.SYMBOL} · {h.account.accountNumber}</option>)}</select></Field>
      <div className="tax-comparison">
        {[left, right].map((account, index) => <div className="tax-comparison-option" key={index}>
          <Field label={index === 0 ? 'Account A' : 'Account B'}><select value={account.accountNumber} onChange={(e) => (index === 0 ? setLeftKey : setRightKey)(e.target.value)}>{typedAccounts.map((a) => <option key={a.accountNumber} value={a.accountNumber}>{accountTypeLabel(taxAccountType(a, settings))} · {a.accountNumber}</option>)}</select></Field>
          <small>Annual withholding</small><strong>{comparable ? money(projections[index].annualWithheldMinor, currency) : '—'}</strong>
          <p>{inFund ? 'Fund-level withholding · applies in either account' : projections[index]?.exempt ? 'Treaty-exempt in this scenario' : projections[index]?.recoverable ? 'Potential foreign tax credit' : projections[index] ? 'Withholding is not recoverable' : 'No direct US withholding modeled'}</p>
        </div>)}
      </div>
      <div className="tax-period"><label htmlFor="tax-years">Illustration over <strong>{years} years</strong></label><input id="tax-years" type="range" min="1" max="30" value={years} onChange={(e) => setYears(Number(e.target.value))} /></div>
      <div className="tax-comparison-result"><span>Difference in withholding<br /><small>Same value and yield each year, no compounding</small></span><strong>{money(difference, currency)} <small>{currency}</small></strong></div>
      <p className="tax-footnote">This compares dividend withholding only. It excludes Canadian income tax, contribution deductions, withdrawal tax and investment returns.</p>
    </>}
  </section>
}

function ContributionCard({ type, record, disabled, onSave, accounts, workspace }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ amount: '', asOf: '' })
  const [planned, setPlanned] = useState('')
  const today = localTaxDate()
  const view = contributionView(type, record, accounts, workspace.ledger.transactions, workspace.settings, planned)
  const room = view.result
  const unavailable = workspace.ledger.loading || workspace.ledger.error || workspace.ledger.limited || view.missingFx
  const current = room && !room.stale && !unavailable
  const startEdit = () => { setDraft({ amount: Number.isFinite(record?.limitMinor) ? record.limitMinor / 100 : record?.room ?? '', asOf: record?.asOf || today }); setEditing(true) }
  const submit = async (e) => { e.preventDefault(); if (await onSave({ limitMinor: toMinorUnits(draft.amount), asOf: draft.asOf })) setEditing(false) }
  return <div className="tax-room-card">
    <div className="tax-room-title"><h3>{type}</h3><button type="button" className="tax-text-button" disabled={disabled} onClick={startEdit}>{record ? 'Edit figures' : 'Add room'} <AccountIcon name="plus" size={13} /></button></div>
    {editing ? <form onSubmit={submit} className="tax-room-form">
      <Field label={`${type} available room (CAD)`} hint="Room available on this date, before deposits made on or after it."><input type="number" min="0" step="0.01" required value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></Field>
      <Field label="Accurate as of"><input type="date" required max={today} value={draft.asOf} onChange={(e) => setDraft({ ...draft, asOf: e.target.value })} /></Field>
      <div className="tax-actions"><button className="tax-button" disabled={disabled} type="submit">{disabled ? 'Saving…' : 'Save figures'}</button><button className="tax-text-button" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
    </form> : <>
      <strong className={`tax-room-amount ${current && room.remainingMinor < 0 ? 'tax-negative' : ''}`}>{current ? money(room.remainingMinor) : room?.stale || view.needsMigration ? 'Needs an update' : record ? 'Not available' : 'Not entered'} <small>{current ? 'CAD remaining' : ''}</small></strong>
      <p>{current ? `Your room as of ${room.asOf}, less ${money(room.depositedMinor)} in recorded deposits across your ${type} accounts.` : room?.stale ? `Your last figure is from ${room.asOf}. Enter this year’s room before checking a contribution.` : view.needsMigration ? 'Confirm your saved room and date. Deposits now come from transaction history; the old manually entered contribution total is not deducted again.' : view.missingFx ? 'A deposit needs its historical exchange rate before room can be checked.' : record && unavailable ? 'Complete transaction history is needed to check this figure.' : `Use your own records and ${type === 'TFSA' ? 'CRA account' : 'latest notice of assessment'}. Room is shared across all ${type}s.`}</p>
      {current && <><Field label={`Check a planned ${type} contribution (CAD)`}><input type="number" min="0" step="0.01" placeholder="0.00" value={planned} onChange={(e) => setPlanned(e.target.value)} /></Field>{view.check && <p role="status" className={view.check.exceeds ? 'tax-notice tax-negative' : 'tax-notice'}>{view.check.exceeds ? `${money(view.check.excessMinor)} above the room you recorded.` : `${money(view.check.remainingAfterMinor)} would remain based on your records.`}</p>}</>}
      {room?.excludesTfsaRecontribution && <p className="tax-footnote">TFSA withdrawal and re-contribution adjustments are excluded.</p>}
    </>}
  </div>
}

function ContributionSection({ workspace, accounts }) {
  const { settings, update, loading, saving, loadFailed } = workspace
  return <section className="tax-card" id="tax-room"><SectionHeading number="03 / CONTRIBUTIONS" title="Room to contribute" subtitle="Your starting room, adjusted for recorded deposits." aside={<Badge>CAD</Badge>} />
    {['TFSA', 'RRSP'].map((type) => <ContributionCard key={type} type={type} record={settings.room?.[type]} disabled={loading || saving || loadFailed} accounts={accounts} workspace={workspace}
      onSave={(record) => update({ room: { ...settings.room, [type]: record } })} />)}
    <p className="tax-footnote">Based on your entered room and the available ledger. Incoming transfers are counted as deposits; review transfers between registered accounts and contributions outside this app against your records. New-year room is not added automatically.</p>
    <div className="tax-source-links"><a href={CRA_TFSA} target="_blank" rel="noreferrer">TFSA rules ↗</a><a href={CRA_RRSP} target="_blank" rel="noreferrer">RRSP room ↗</a></div>
  </section>
}

function ConversionSection({ transactions = [] }) {
  // The measured half of #18. The scenario below prices a conversion someone
  // types in; this prices the ones they actually made, from the rate implied by
  // the two legs against the Bank of Canada mid rate already on each record.
  const measured = measureConversionCost({ transactions })
  const [amount, setAmount] = useState('10000')
  const [spread, setSpread] = useState('1.5')
  const [commission, setCommission] = useState('9.95')
  const [bidAsk, setBidAsk] = useState('0.1')
  const base = conversionComparison({ amountCad: validNumber(amount) })
  const valid = base && [spread, commission, bidAsk].every((v) => validNumber(v) !== null) && Number(spread) <= 100 && Number(bidAsk) <= 100
  const brokerMinor = valid ? Math.round(Number(amount) * Number(spread)) : null
  const gambitMinor = valid ? Math.round(Number(amount) * Number(bidAsk)) + Math.round(Number(commission) * 100) * 2 : null
  return <section className="tax-card" id="tax-conversion"><SectionHeading number="04 / CURRENCY" title="What does converting cost?" subtitle="Compare costs for a CAD-to-USD conversion." aside={<Badge>{measured ? 'Recorded' : 'Scenario'}</Badge>} />
    {measured && <div className="tax-measured-block">
      <div className="tax-cost-row"><span>What your conversions actually cost<small>{measured.conversions.length} recorded{measured.complete ? '' : ` · ${measured.unpricedCount} not priced`}</small></span><strong>{money(measured.totalCostMinor)} <small>CAD</small></strong></div>
      {measured.averageSpreadPct !== null && <p className="tax-notice">An average spread of {measured.averageSpreadPct}% on {money(measured.totalConvertedMinor)} converted. This is the rate implied by the amounts on each conversion, against the Bank of Canada rate for that day.</p>}
      {measured.conversions[0]?.couldHaveSavedMinor !== null && measured.conversions[0]?.couldHaveSavedMinor > 0 && <p className="tax-notice">The most recent, on {measured.conversions[0].tradeDate}, cost {money(measured.conversions[0].costMinor)} at {measured.conversions[0].spreadPct}%. Norbert’s Gambit would have cost about {money(measured.conversions[0].alternativeCostMinor)}.</p>}
      {!measured.complete && <p className="tax-notice">Conversions this could not pair into two legs are excluded from the total rather than estimated.</p>}
    </div>}
    <div className="tax-input-grid"><Field label="Amount to convert (CAD)"><input type="number" min="0" step="100" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="Broker FX spread (%)"><input type="number" min="0" max="100" step="0.01" value={spread} onChange={(e) => setSpread(e.target.value)} /></Field><Field label="Commission per trade (CAD)"><input type="number" min="0" step="0.01" value={commission} onChange={(e) => setCommission(e.target.value)} /></Field><Field label="Combined bid–ask cost (%)"><input type="number" min="0" max="100" step="0.01" value={bidAsk} onChange={(e) => setBidAsk(e.target.value)} /></Field></div>
    <div className="tax-cost-row"><span>Broker conversion</span><strong>{money(brokerMinor)} <small>CAD</small></strong></div><div className="tax-cost-row"><span>Norbert’s Gambit <small>Two commissions + bid–ask cost</small></span><strong>{money(gambitMinor)} <small>CAD</small></strong></div>
    {valid ? <div className="tax-scenario-difference"><span>Difference under these assumptions</span><strong>{money(brokerMinor - gambitMinor)} CAD</strong></div> : <p className="tax-notice">{validNumber(amount) !== null && Number(amount) < 5000 ? 'Enter at least $5,000 CAD to compare this approach.' : 'Enter valid amounts and percentages to compare costs.'}</p>}
    <details className="tax-details"><summary>How this comparison works</summary><p>Norbert’s Gambit uses a dual-currency security such as DLR / DLR.U: buy in CAD, journal to its USD listing, then sell in USD. Confirm eligibility, commissions and journalling steps with your broker. These are editable examples, not a quote from your brokerage. The exchange rate can move between trades; settlement and waiting costs are excluded.</p></details>
  </section>
}

function FeesSection({ accounts, reference = {}, loading }) {
  const rows = accounts.flatMap((a) => (a.positions || []).map((r) => ({ ...r, 'ACCOUNT CURRENCY': r['ACCOUNT CURRENCY'] || a.currency })))
  const currencies = [...new Set(rows.map((r) => r['ACCOUNT CURRENCY']).filter(Boolean))]
  const summaries = currencies.map((currency) => ({ currency, fees: summarizeFundFees(rows.filter((r) => r['ACCOUNT CURRENCY'] === currency), reference) })).filter((s) => s.fees)
  const unresolved = [...new Set(rows.filter((r) => !reference[String(r.SYMBOL).toUpperCase()]?.exchange).map((r) => r.SYMBOL))]
  return <section className="tax-card" id="tax-fees"><SectionHeading number="05 / FUND FEES" title="The cost of your funds" subtitle="Annual expenses at today’s holding values, using published expense ratios." aside={<Badge>Estimate</Badge>} />
    {loading ? <p className="tax-loading" role="status">Loading fund references…</p> : !summaries.length ? <div className="tax-empty"><AccountIcon name="file" size={25} /><h3>{unresolved.length ? 'Fund references needed' : 'No funds identified'}</h3><p>Individual stocks have no fund expense ratio. Unresolved securities are not counted as zero-cost funds.</p></div> : summaries.map(({ currency, fees }) => <div key={currency} className="tax-fee-currency">
      <div className="tax-fee-total"><span>{currency} / year</span><strong>{money(fees.holdings.length ? fees.annualFeeMinor : null, currency)}</strong></div>
      <p className="tax-footnote">{fees.weightedMerPct === null ? 'No priced funds' : `${fees.weightedMerPct.toFixed(3)}% weighted expense ratio · priced funds only`}</p>
      {fees.holdings.map((holding, i) => <div className="tax-cost-row" key={`${holding.symbol}:${i}`}><span>{holding.symbol}<small>{holding.expenseRatioPct}% expense ratio · reference {reference[holding.symbol]?.resolvedAt?.slice(0, 10) || 'date unavailable'}</small></span><strong>{money(holding.annualFeeMinor, currency)}</strong></div>)}
      {!fees.complete && <p className="tax-notice">Expense ratio unavailable: {fees.missingFeeData.join(', ')}. These funds are excluded from the total.</p>}
    </div>)}
    {unresolved.length > 0 && <p className="tax-notice">Security reference unavailable: {unresolved.join(', ')}.</p>}
    <p className="tax-footnote">Source: security reference fund profiles. Expenses are deducted within each fund; this is an annual estimate, not a recorded charge. Brokerage commissions, account fees and FX spreads are separate.</p>
  </section>
}

function SalesSection({ ledger, prices = {} }) {
  const review = useMemo(() => saleReview(ledger.transactions, ledger.historyStarts || {}, prices.quotes, prices.usdCadRate), [ledger.transactions, ledger.historyStarts, prices.quotes, prices.usdCadRate])
  const unavailable = ledger.loading || ledger.error || ledger.limited
  const incomplete = review.pools.bySecurity.filter((p) => p.provenance === 'incomplete')
  return <section className="tax-card" id="tax-sales"><SectionHeading number="06 / YOUR DECISIONS" title="After a sale" subtitle="Completed taxable-account disposals, compared with the same shares at the latest available price." aside={<Badge>CAD · price comparison</Badge>} />
    {unavailable || prices.loading ? <p className="tax-loading">{ledger.loading || prices.loading ? 'Loading sale history and comparison prices…' : 'Complete transaction history is needed before comparing sales.'}</p> : <>
      {prices.error && <p className="tax-error" role="alert">{prices.error}</p>}
      {!review.comparisons.length && <div className="tax-empty tax-empty-wide"><AccountIcon name="file" size={24} /><div><h3>No complete sale comparisons yet</h3><p>Sales need a supported cost-base pool, transaction history and a current quote with currency conversion. Registered-account trades are excluded.</p></div></div>}
      {review.comparisons.map((sale) => <article className="tax-sale-record" key={sale.transactionId}>
        <h3>{sale.symbol} <small>· {sale.quantity} shares · {sale.tradeDate}</small></h3>
        <div className="tax-sale-comparison"><div><span>Net sale proceeds</span><strong>{money(sale.proceedsMinor)}</strong><small>CAD · after recorded fees</small></div><div><span>Value if held</span><strong>{money(sale.wouldBeWorthMinor)}</strong><small>CAD · latest available quote</small></div><div><span>{sale.differenceMinor > 0 ? 'Holding would be worth more' : sale.differenceMinor < 0 ? 'Selling was worth more' : 'No price difference'}</span><strong>{money(Math.abs(sale.differenceMinor))}</strong><small>CAD · price difference</small></div></div>
        <p className="tax-footnote">{sale.provenance} from the transaction pool · security match: {sale.securityKeyBasis || 'unavailable'} · quote {sale.quote.currency} {sale.quote.price}{sale.quote.marketTime ? ` at ${new Date(sale.quote.marketTime * 1000).toLocaleString()}` : ''}. {review.summary?.excludesReinvestment && 'Excludes reinvestment of the sale proceeds.'} Dividends, tax and subsequent corporate actions are not modeled.</p>
      </article>)}
      {review.unpriced > 0 && <p className="tax-notice">{review.unpriced} disposal(s) need a usable quote or exchange rate.</p>}
      {incomplete.length > 0 && <details className="tax-details"><summary>Incomplete cost-base pools · {incomplete.length}</summary><ul>{incomplete.map((pool) => <li key={pool.securityKey}>{pool.symbol}: {pool.incompleteReasons.join(', ')}</li>)}</ul></details>}
    </>}
  </section>
}

export default function TaxView({ accounts, workspace, onOpenAccount, onAddAccount }) {
  const { settings, loading, saving, error, loadFailed, update, ledger, data = {}, prices, referenceLoading, syncState = {} } = workspace
  const currencies = [...new Set(accounts.flatMap((a) => [a.currency, ...(a.positions || []).map((r) => r['ACCOUNT CURRENCY'])]).filter(Boolean))].sort()
  const [chosenCurrency, setCurrency] = useState('CAD')
  const currency = currencies.includes(chosenCurrency) ? chosenCurrency : currencies[0] || 'CAD'
  const summary = useMemo(() => taxOverview(accounts, settings, currency, data), [accounts, settings, currency, data])
  const [yieldDraft, setYieldDraft] = useState(null)
  const year = new Date().getFullYear()
  const changeType = (accountNumber, type) => update({ accountTypes: { ...settings.accountTypes, [accountNumber]: type } })
  return <div className="tax-page">
    <header className="tax-header"><div><div className="tax-overline">YOUR PORTFOLIO / {year}</div><h1>Tax & costs</h1><p>The whole picture, across all your accounts.</p></div><div className="tax-currency-control" role="group" aria-label="Tax display currency">{currencies.map((value) => <button type="button" key={value} aria-pressed={currency === value} onClick={() => setCurrency(value)}>{value}</button>)}</div></header>
    {error && <p className="tax-error" role="alert">{error}</p>}{ledger.error && <p className="tax-error" role="alert">{ledger.error}</p>}{ledger.limited && <p className="tax-notice">The ledger reached its 2,000-record limit. Contribution and sale calculations are withheld until full history is available.</p>}
    <div className="tax-sync-row"><span>Transaction ledger · {ledger.transactions.length} records</span><button type="button" className="tax-button" onClick={workspace.sync} disabled={syncState.loading}>{syncState.loading ? 'Syncing transactions…' : 'Sync transactions'}</button><button type="button" className="tax-text-button" onClick={workspace.retry}>Refresh data</button></div>
    {syncState.error && <p className="tax-error" role="alert">{syncState.error}</p>}{syncState.result && <p className="tax-notice" role="status">Sync returned {syncState.result.fetched} transactions; {syncState.result.written} written to the ledger.{syncState.result.skipped > 0 ? ` ${syncState.result.skipped} records skipped.` : ''}</p>}
    <section className="tax-hero" aria-label="Portfolio withholding summary"><div className="tax-hero-main"><div className="tax-hero-label">Annual withholding <Badge>{summary.basis === 'measured' ? 'Recorded · past 12 months' : 'Estimate'}</Badge></div><div className="tax-hero-amount">{loading ? '—' : summary.covered ? money(summary.annualMinor, currency) : 'Not estimated'} <span>{summary.covered ? `${currency} / year` : ''}</span></div><p>{summary.covered ? `On ${money(summary.coveredValueMinor, currency)} of modeled holdings.` : 'Confirm account types and listing details to build your estimate.'}</p></div><div className="tax-hero-details"><div><span>Potential foreign tax credit</span><strong>{summary.covered ? money(summary.creditMinor, currency) : '—'} <small>{currency}</small></strong></div><div><span>Holdings included</span><strong>{summary.covered} <small>in {currency}</small></strong></div><div><span>Need more information</span><strong>{summary.gaps.length} <small>holdings</small></strong></div></div></section>
    <div className="tax-assumption-line"><span>Uses resolved listings, yields and fund composition. The fallback yield applies only when a yield is unavailable. Fund-level estimates assume US-source dividends and treaty rates.</span><form onSubmit={async (e) => { e.preventDefault(); if (await update({ yieldPct: Number(yieldDraft ?? settings.yieldPct ?? 1.3) })) setYieldDraft(null) }}><label htmlFor="tax-yield">Fallback yield</label><input id="tax-yield" type="number" min="0" max="100" step="0.1" required value={yieldDraft ?? settings.yieldPct ?? 1.3} onChange={(e) => setYieldDraft(e.target.value)} /><span>%</span><button type="submit" disabled={loading || saving || loadFailed || yieldDraft === null}>Apply</button></form></div>
    <nav className="tax-section-nav" aria-label="Tax sections">{[['tax-accounts', 'Accounts'], ['tax-simulator', 'Compare'], ['tax-room', 'Contribution room'], ['tax-conversion', 'Currency'], ['tax-fees', 'Fees'], ['tax-sales', 'Sales']].map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
    <section className="tax-card tax-accounts" id="tax-accounts"><SectionHeading number="01 / ACROSS YOUR ACCOUNTS" title="Where withholding happens" subtitle="Account registration changes the treatment. Currency totals stay separate." />
      {accounts.length === 0 && <div className="tax-empty"><AccountIcon name="bank" size={24} /><h3>Bring your accounts together</h3><p>Add an account to see withholding and compare its treatment. You can enter contribution room below at any time.</p>{onAddAccount && <button type="button" className="tax-text-button" onClick={onAddAccount}>Add an account <AccountIcon name="plus" size={14} /></button>}</div>}
      {accounts.length > 0 && <div className="tax-table-wrap"><table className="tax-account-table"><thead><tr><th>Account</th><th>Registration</th><th>Annual withholding</th><th>Treatment & coverage</th></tr></thead><tbody>{summary.rows.map(({ account, type, annualMinor, holdings, gaps, result }) => <tr key={account.accountNumber}><th><button type="button" onClick={() => onOpenAccount?.(account)}>{accountTitle(account)}<span>{account.accountNumber} <AccountIcon name="arrow" size={12} /></span></button></th><td>{ACCOUNT_TYPES.includes(String(accountTypeOf(accounts.find((a) => a.accountNumber === account.accountNumber))).toUpperCase().replace(/[ -]/g, '_')) ? <Badge>{accountTypeLabel(type)}</Badge> : <select aria-label={`Registration for ${account.accountNumber}`} value={type || ''} disabled={loading || saving || loadFailed} onChange={(e) => changeType(account.accountNumber, e.target.value)}><option value="">Choose type</option>{ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{accountTypeLabel(type)}</option>)}</select>}</td><td className="tax-numeric"><strong>{holdings.length ? money(annualMinor, currency) : '—'}</strong><small>{holdings.length ? `${currency} / year` : 'Not estimated'}</small></td><td><span className={`tax-treatment ${holdings.length && holdings.every((h) => h.projection.exempt) ? 'tax-treatment-exempt' : ''}`}>{!(account.positions || []).some((r) => (r['ACCOUNT CURRENCY'] || account.currency) === currency) ? `No holdings in ${currency}` : !type ? 'Account type needed' : !holdings.length ? gaps.length ? 'More information needed' : 'No modeled US withholding' : holdings.some((h) => h.projection.recoverable) ? 'Potential tax credit' : holdings.every((h) => h.projection.exempt) ? 'Treaty-exempt scenario' : 'Not recoverable'}</span><small>{!holdings.length ? 'No projection' : result?.basis === 'measured' ? 'Recorded · 12 months' : result?.yieldIsReal ? 'Resolved dividend yields' : 'Assumed yield included'} · {holdings.length} modeled{gaps.length ? ` · ${gaps.length} not estimated` : ''}</small></td></tr>)}</tbody></table></div>}
      {summary.covered > 0 && <details className="tax-details"><summary>Sources and assumptions for these figures</summary><ul>{summary.rows.flatMap(({ account, holdings }) => holdings.map(({ row, projection }, i) => <li key={`${account.accountNumber}:${row.SYMBOL}:${i}`}>{row.SYMBOL} · {account.accountNumber}: {projection.workings.yieldPct}% {projection.provenance.yieldBasis === 'assumed' ? 'assumed yield' : 'trailing dividend yield'} · {projection.provenance.exchange} · reference {projection.provenance.resolvedAt?.slice(0, 10) || 'date unavailable'}{projection.treatment === 'IN_FUND' ? ' · fund-level approximation; US-source dividend mix is assumed' : ''}.</li>))}</ul></details>}
      {summary.gaps.length > 0 && <details className="tax-details tax-coverage"><summary>What’s not included · {summary.gaps.length} holdings</summary><ul>{summary.gaps.map(({ row, reason }, i) => <li key={`${row.SYMBOL}:${i}`}><span>{row.SYMBOL}</span><span>{reason}</span></li>)}</ul></details>}
    </section>
    <div className="tax-main-grid"><WithholdingSimulator accounts={accounts} settings={settings} currency={currency} reference={data.reference} /><ContributionSection workspace={workspace} accounts={accounts} /><ConversionSection transactions={data.transactions} /><FeesSection accounts={accounts} reference={data.reference} loading={referenceLoading} /></div>
    <SalesSection ledger={ledger} prices={prices} />
    <footer className="tax-footer"><span>Reference-based estimates and ledger-derived figures carry separate labels. This page is not a tax return.</span><a href={TREATY} target="_blank" rel="noreferrer">Canada–US treaty · Articles X & XXI ↗</a></footer>
  </div>
}
