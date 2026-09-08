import { useMemo, useState } from 'react'
import AccountIcon from '../AccountIcons'
import TaxDataDialog from './TaxDataDialog'
import Modal, { ModalClose } from '../../../components/Modal'
import { projectWithholding } from '../../../utils/withholdingTax'
import { summarizeFundFees } from '../../../utils/fundFees'
import { toMinorUnits } from '../../../utils/money'
import { measureConversionCost, estimateConversionCost, estimateWealthsimpleFxFees } from '../../../utils/conversionCost'
import { accountTypeLabel, contributionView, localTaxDate, money, saleReview, taxAccountType, taxOverview } from './taxModel'
import './Tax.css'

const CRA_TFSA = 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributing/before.html'
const CRA_RRSP = 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/contributing-a-rrsp-prpp.html'
const TREATY = 'https://www.canada.ca/en/department-finance/programs/tax-policy/tax-treaties/country/united-states-america-convention-consolidated-1980-1983-1984-1995-1997-2007.html'
const Field = ({ label, children, hint }) => <label className="tax-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
/** "Aug 12", the way a statement line reads. */
const formatConversionDate = (iso) => {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : iso
}

const SectionHeading = ({ title, subtitle, aside }) => <div className="tax-section-heading"><div><h2 id="tax-tool-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{aside}</div>
const countLabel = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`
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
  const [years, setYears] = useState(1)
  const holding = eligible.find((h) => h.key === holdingKey) || eligible[0]
  const typedAccounts = accounts.filter((a) => taxAccountType(a, settings))
  const left = typedAccounts.find((a) => a.accountNumber === leftKey) || typedAccounts.find((a) => a.accountNumber === holding?.account.accountNumber) || typedAccounts[0]
  const otherAccounts = typedAccounts.filter((a) => a.accountNumber !== left?.accountNumber)
  const right = otherAccounts.find((a) => a.accountNumber === rightKey) || otherAccounts.find((a) => taxAccountType(a, settings) !== taxAccountType(left || {}, settings)) || otherAccounts[0]
  const projections = [left, right].map((account) => account && holding ? projectWithholding({ row: holding.row, securityReference: reference[String(holding.row.SYMBOL).toUpperCase()], accountType: taxAccountType(account, settings), assumptions: { yieldPct: settings.yieldPct ?? 1.3 } }) : null)
  const inFund = projections.some((p) => p?.treatment === 'IN_FUND')
  const comparable = projections.every(Boolean)
  const difference = comparable ? Math.abs(projections[0].annualWithheldMinor - projections[1].annualWithheldMinor) * years : null
  return <section className="tax-card tax-simulator" id="tax-simulator">
    <SectionHeading title="Compare account types" subtitle="See how the same holding is treated in two accounts." />
    {!holding || typedAccounts.length < 2 ? <div className="tax-empty"><AccountIcon name="bank" size={24} /><h3>A comparison needs two accounts</h3><p>Add registration types in Accounts to compare holdings in {currency}.</p></div> : <>
      <Field label="Holding"><select value={holding.key} onChange={(e) => setHoldingKey(e.target.value)}>{eligible.map((h) => <option key={h.key} value={h.key}>{h.row.SYMBOL} · {h.account.accountNumber}</option>)}</select></Field>
      <div className="tax-comparison">
        {[left, right].map((account, index) => <div className="tax-comparison-option" key={index}>
          <Field label={index === 0 ? 'Account A' : 'Account B'}><select value={account.accountNumber} onChange={(e) => (index === 0 ? setLeftKey : setRightKey)(e.target.value)}>{(index === 0 ? typedAccounts : otherAccounts).map((a) => <option key={a.accountNumber} value={a.accountNumber}>{accountTypeLabel(taxAccountType(a, settings))} · {a.accountNumber}</option>)}</select></Field>
          <small>Annual withholding</small><strong>{comparable ? money(projections[index].annualWithheldMinor, currency) : '—'}</strong>
          <p>{inFund ? 'Fund-level withholding · applies in either account' : projections[index]?.exempt ? 'Treaty-exempt in this scenario' : projections[index]?.recoverable ? 'Potential foreign tax credit' : projections[index] ? 'Withholding is not recoverable' : 'Not enough information to compare'}</p>
        </div>)}
      </div>
      <details className="tax-details"><summary>Compare over several years</summary><div className="tax-period"><label htmlFor="tax-years">Illustration over <strong>{years} years</strong></label><input id="tax-years" type="range" min="1" max="30" value={years} onChange={(e) => setYears(Number(e.target.value))} /></div></details>
      <div className="tax-comparison-result"><span>Difference in withholding<br /><small>Same value and yield each year, no compounding</small></span><strong>{money(difference, currency)} <small>{currency}</small></strong></div>
      <p className="tax-footnote">This compares dividend withholding only. It excludes Canadian income tax, contribution deductions, withdrawal tax and investment returns.</p>
    </>}
  </section>
}

function ContributionCard({ type, record, disabled, onSave, accounts, workspace, editing, onEdit, onCancel }) {
  const [draft, setDraft] = useState({ amount: '', asOf: '' })
  const [planned, setPlanned] = useState('')
  const today = localTaxDate()
  const view = contributionView(type, record, accounts, workspace.ledger.transactions, workspace.settings, planned)
  const room = view.result
  const unavailable = workspace.ledger.loading || workspace.ledger.error || workspace.ledger.limited || view.missingFx || view.unreviewedTransfers.length > 0
  const current = room && !room.stale && !unavailable
  const startEdit = () => { setDraft({ amount: Number.isFinite(record?.limitMinor) ? record.limitMinor / 100 : record?.room ?? '', asOf: record?.asOf || today }); onEdit() }
  const submit = async (e) => { e.preventDefault(); if (await onSave({ limitMinor: toMinorUnits(draft.amount), asOf: draft.asOf })) onCancel() }
  return <div className="tax-room-card">
    <div className="tax-room-title"><h3>{type}</h3><button type="button" className="tax-text-button" disabled={disabled} onClick={startEdit}>{record ? 'Edit figures' : 'Add room'} <AccountIcon name="plus" size={13} /></button></div>
    {editing ? <form onSubmit={submit} className="tax-room-form">
      <Field label={`${type} available room (CAD)`} hint="Room available on this date, before deposits made on or after it."><input type="number" min="0" step="0.01" required value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></Field>
      <Field label="Accurate as of"><input type="date" required max={today} value={draft.asOf} onChange={(e) => setDraft({ ...draft, asOf: e.target.value })} /></Field>
      <div className="tax-actions"><button className="tax-button" disabled={disabled} type="submit">{disabled ? 'Saving…' : 'Save figures'}</button><button className="tax-text-button" type="button" onClick={onCancel}>Cancel</button></div>
    </form> : <>
      <strong className={`tax-room-amount ${!record ? 'tax-room-amount-empty' : ''} ${current && room.remainingMinor < 0 ? 'tax-negative' : ''}`}>{current ? money(room.remainingMinor) : room?.stale || view.needsMigration ? 'Needs an update' : record ? 'Not available' : 'Not set'} <small>{current ? 'CAD remaining' : ''}</small></strong>
      <p>{current ? `Your room as of ${room.asOf}, less ${money(room.depositedMinor)} in recorded deposits across your ${type} accounts.` : room?.stale ? `Your last figure is from ${room.asOf}. Enter this year’s room before checking a contribution.` : view.needsMigration ? 'Confirm your saved room and date. Deposits now come from transaction history; the old manually entered contribution total is not deducted again.' : view.unreviewedTransfers.length ? 'An incoming transfer needs review against your statement before contribution room can be calculated.' : view.missingFx ? 'A deposit needs its historical exchange rate before room can be checked.' : record && unavailable ? 'Complete transaction history is needed to check this figure.' : `Enter the available room from your ${type === 'TFSA' ? 'CRA account' : 'notice of assessment'}.`}</p>
      {current && <details className="tax-details"><summary>Check a contribution</summary><Field label={`Check a planned ${type} contribution (CAD)`}><input type="number" min="0" step="0.01" placeholder="0.00" value={planned} onChange={(e) => setPlanned(e.target.value)} /></Field>{view.check && <p role="status" className={view.check.exceeds ? 'tax-notice tax-negative' : 'tax-notice'}>{view.check.exceeds ? `${money(view.check.excessMinor)} above the room you recorded.` : `${money(view.check.remainingAfterMinor)} would remain based on your records.`}</p>}</details>}
      {type === 'TFSA' && room?.excludesTfsaRecontribution && <p className="tax-footnote">Withdrawals do not add room in this estimate.</p>}
    </>}
  </div>
}

function ContributionSection({ workspace, accounts }) {
  const { settings, update, loading, saving, loadFailed } = workspace
  const [editingType, setEditingType] = useState(null)
  return <section className="tax-card" id="tax-room"><SectionHeading title="Contribution room" subtitle="Across your TFSA and RRSP accounts." aside={<Badge>CAD</Badge>} />
    <div className="tax-room-grid">{['TFSA', 'RRSP'].map((type) => <ContributionCard editing={editingType === type} onEdit={() => setEditingType(type)} onCancel={() => setEditingType((current) => current === type ? null : current)} key={type} type={type} record={settings.room?.[type]} disabled={loading || saving || loadFailed} accounts={accounts} workspace={workspace}
      onSave={(record) => update({ room: { ...settings.room, [type]: record } })} />)}</div>
    <details className="tax-details"><summary>How room is calculated</summary><p className="tax-footnote">Based on your entered room and the available ledger. Broker deposits count as contributions. Other incoming transfers require statement review; direct transfers between registered accounts may not use room. New-year room is not added automatically.</p>
    <div className="tax-source-links"><a href={CRA_TFSA} target="_blank" rel="noreferrer">TFSA rules ↗</a><a href={CRA_RRSP} target="_blank" rel="noreferrer">RRSP room ↗</a></div></details>
  </section>
}

/** A Plaid account id as something a person can match to a connection. */
const accountLabelIn = (accounts = []) => (id) => {
  const account = accounts.find((a) => a.accountNumber === id || a.positions?.some((r) => r.__plaidAccountId === id))
  return account?.accountNumber || (id ? `Account ${String(id).slice(-8)}` : 'Account unavailable')
}

function ConversionSection({ measured, estimate, brokerEstimate, accounts, year, hasUsdActivity, unavailable }) {
  const conversions = measured?.conversions ?? []
  const accountLabel = accountLabelIn(accounts)
  return <section className="tax-card" id="tax-conversion" aria-label="Currency conversion">
    <SectionHeading title="Currency conversion" subtitle={brokerEstimate && !conversions.length ? `Estimated fees on your ${year} USD purchases.` : `Your ${year} activity, compared with the daily reference rate.`} aside={<Badge>CAD · {year}</Badge>} />
    {unavailable ? <div className="tax-empty"><h3>Transaction history unavailable</h3><p>Load complete history to review currency conversions.</p></div> : conversions.length > 0 ? <>
      <div className="tax-fx-total">
        <div><span>{measured.totalCostMinor < 0 ? 'Below daily reference' : 'FX cost vs daily reference'}</span><strong>{money(measured.totalCostMinor, 'CAD')} <small>CAD</small></strong></div>
        <p>{countLabel(conversions.length, 'measured conversion')}<span>{money(measured.totalConvertedMinor, 'CAD')} CAD converted</span></p>
      </div>
      <ul className="tax-conversion-list">
        {conversions.map((c, index) => <li key={`${c.accountId}:${c.transactionId ?? index}`} className="tax-conversion"><details>
          <summary className="tax-conversion-head">
            <span className="tax-conversion-icon" aria-hidden="true">↔</span>
            <span className="tax-conversion-identity"><strong>{c.symbol ? `${c.symbol} · Currency conversion` : 'Currency conversion'}</strong><small>{formatConversionDate(c.tradeDate)} · {accountLabel(c.accountId)}</small></span>
            <span className="tax-conversion-value"><strong>{money(c.costMinor, 'CAD')} <small>CAD</small></strong><small>{c.costMinor < 0 ? 'Below reference' : c.costMinor > 0 ? 'Above reference' : 'At reference'}</small></span>
            <AccountIcon name="chevron" size={14} />
          </summary>
          <div className="tax-conversion-body"><dl className="tax-conversion-detail">
            <div><dt>CAD amount</dt><dd>{money(c.fromAmountMinor, 'CAD')}</dd></div>
            <div><dt>USD amount</dt><dd>{money(c.toAmountMinor, 'USD')}</dd></div>
            <div><dt>Daily reference rate</dt><dd>{c.midRate.toFixed(4)}</dd></div>
            <div><dt>Effective broker rate</dt><dd>{c.chargedRate.toFixed(4)}</dd></div>
          </dl><p className="tax-footnote">Rates are CAD per USD. {c.source === 'trade-embedded' ? 'Derived from the trade’s verified currency amounts and recorded USD balance; assumes no cash before the available history.' : 'Based on paired CAD and USD FX records in this account on the same date.'} This comparison uses a daily reference, not an intraday execution quote.</p></div>
        </details></li>)}
      </ul>
    </> : brokerEstimate ? null : <div className="tax-empty"><span className="tax-empty-symbol" aria-hidden="true">↔</span><h3>No measured FX conversions yet</h3><p>{measured?.unpricedCount ? 'Some transactions need currency details before their FX cost can be measured.' : hasUsdActivity ? 'We found USD activity, but do not have enough information to determine the actual currency conversion cost.' : 'No conversions recorded.'}</p></div>}
    {!unavailable && brokerEstimate && <div className="tax-fx-estimate">
      <div className="tax-fx-total"><div><span>Estimated conversion fees</span><strong>{money(brokerEstimate.totalCostMinor, 'CAD')} <small>CAD</small></strong></div><p>{countLabel(brokerEstimate.purchases.length, 'USD purchase')}<span>If funded from CAD · 1.5% fee</span></p></div>
      <p className="tax-footnote">A fee estimate, not a measured loss. Your trade confirmation supplies the exact CAD charge and broker rate.</p>
      <ul className="tax-conversion-list">{brokerEstimate.purchases.map((p) => <li key={p.transactionId} className="tax-conversion"><details>
        <summary className="tax-conversion-head"><span className="tax-conversion-icon" aria-hidden="true">↔</span><span className="tax-conversion-identity"><strong>{p.symbol || 'USD purchase'}</strong><small>{formatConversionDate(p.tradeDate)} · {accountLabel(p.accountId)}</small></span><span className="tax-conversion-value"><strong>{money(p.estimatedCostMinor, 'CAD')} <small>CAD</small></strong><small>Estimated fee</small></span><AccountIcon name="chevron" size={14} /></summary>
        <div className="tax-conversion-body"><dl className="tax-conversion-detail"><div><dt>Purchase amount</dt><dd>{money(p.usdMinor, 'USD')} USD</dd></div><div><dt>Daily reference rate</dt><dd>{p.midRate.toFixed(4)}</dd></div></dl><p className="tax-footnote">Assumes the full purchase was converted from CAD. The broker’s actual exchange rate is unavailable.</p></div>
      </details></li>)}</ul>
      <details className="tax-details"><summary>How this estimate works</summary><p>{brokerEstimate.assumption}</p><a href={brokerEstimate.sourceUrl} target="_blank" rel="noreferrer">Wealthsimple fee schedule ↗</a></details>
    </div>}
    {!unavailable && estimate && !brokerEstimate && <details className="tax-details tax-fx-scenario"><summary>What if these purchases needed currency conversion?</summary>
      <p>{estimate.assumption}</p><div className="tax-fx-total"><div><span>Scenario · {estimate.spreadPct}% assumed spread</span><strong>{money(estimate.totalCostMinor, 'CAD')} <small>CAD</small></strong></div><p>{countLabel(estimate.purchases.length, 'USD purchase')}<span>Not a recorded cost</span></p></div>
    </details>}
    {!unavailable && measured?.unpricedCount > 0 && <details className="tax-details tax-fx-incomplete"><summary>{countLabel(measured.unpricedCount, 'record')} not priced</summary><p>Excluded from the total. A conversion needs both currency amounts and a reference rate.</p>{measured.unpriced?.length > 0 && <ul>{measured.unpriced.map((row, index) => <li key={`${row.accountId}:${row.transactionId}:${index}`}><strong>{row.symbol || 'Transaction'}</strong> · {formatConversionDate(row.tradeDate)} · {accountLabel(row.accountId)}<span>{row.reason === 'unverified-price-currency' ? 'Unit-price currency is unverified; a USD amount cannot be established.' : row.reason === 'insufficient-history' ? 'Earlier cash history is needed.' : 'Daily reference rate is missing.'}</span></li>)}</ul>}</details>}
  </section>
}

function FeesSection({ accounts, reference = {}, loading }) {
  const rows = accounts.flatMap((a) => (a.positions || []).map((r) => ({ ...r, 'ACCOUNT CURRENCY': r['ACCOUNT CURRENCY'] || a.currency })))
  const currencies = [...new Set(rows.map((r) => r['ACCOUNT CURRENCY']).filter(Boolean))]
  const summaries = currencies.map((currency) => ({ currency, fees: summarizeFundFees(rows.filter((r) => r['ACCOUNT CURRENCY'] === currency), reference) })).filter((s) => s.fees)
  const unresolved = [...new Set(rows.filter((r) => !reference[String(r.SYMBOL).toUpperCase()]?.exchange).map((r) => r.SYMBOL))]
  return <section className="tax-card" id="tax-fees"><SectionHeading title="Fund fee breakdown" subtitle="Annual expenses at today’s holding values, using published expense ratios." aside={<Badge>Estimate</Badge>} />
    {loading ? <p className="tax-loading" role="status">Loading fund references…</p> : !summaries.length ? <div className="tax-empty"><AccountIcon name="file" size={25} /><h3>{unresolved.length ? 'Fund references needed' : 'No funds identified'}</h3><p>Individual stocks have no fund expense ratio. Unresolved securities are not counted as zero-cost funds.</p></div> : summaries.map(({ currency, fees }) => <div key={currency} className="tax-fee-currency">
      <div className="tax-fee-total"><span>{currency} / year</span><strong>{money(fees.holdings.length ? fees.annualFeeMinor : null, currency)}</strong></div>
      <p className="tax-footnote">{fees.weightedMerPct === null ? 'No priced funds' : `${fees.weightedMerPct.toFixed(3)}% weighted expense ratio · priced funds only`}</p>
      {fees.holdings.map((holding, i) => <div className="tax-cost-row" key={`${holding.symbol}:${i}`}><span>{holding.symbol}<small>{Number(holding.expenseRatioPct).toLocaleString('en-CA', { maximumFractionDigits: 3 })}% expense ratio · reference {reference[holding.symbol]?.resolvedAt?.slice(0, 10) || 'date unavailable'}</small></span><strong>{money(holding.annualFeeMinor, currency)}</strong></div>)}
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
  return <section className="tax-card" id="tax-sales"><SectionHeading title="After a sale" subtitle="Your net proceeds compared with the value of those shares today." aside={<Badge>CAD · price comparison</Badge>} />
    {unavailable || prices.loading ? <p className="tax-loading">{ledger.loading || prices.loading ? 'Loading sale history and comparison prices…' : 'Complete transaction history is needed before comparing sales.'}</p> : <>
      {prices.error && <p className="tax-error" role="alert">{prices.error}</p>}
      {!review.comparisons.length && <div className="tax-empty tax-empty-wide"><AccountIcon name="file" size={24} /><div><h3>No sales ready to compare</h3><p>Comparisons appear when a taxable sale has enough purchase history and a current price. Registered-account sales are excluded.</p></div></div>}
      {review.comparisons.map((sale) => <article className="tax-sale-record" key={sale.transactionId}>
        <h3>{sale.symbol} <small>· {sale.quantity} shares · {sale.tradeDate}</small></h3>
        <div className="tax-sale-comparison"><div><span>Net sale proceeds</span><strong>{money(sale.proceedsMinor)}</strong><small>CAD · after recorded fees</small></div><div><span>Value if held</span><strong>{money(sale.wouldBeWorthMinor)}</strong><small>CAD · latest available quote</small></div><div><span>{sale.differenceMinor > 0 ? 'Holding would be worth more' : sale.differenceMinor < 0 ? 'Selling was worth more' : 'No price difference'}</span><strong>{money(Math.abs(sale.differenceMinor))}</strong><small>CAD · price difference</small></div></div>
        <p className="tax-footnote">Price comparison only. Excludes dividends, tax and reinvestment.</p>
        <details className="tax-details"><summary>Calculation details</summary><dl className="tax-conversion-detail"><div><dt>History</dt><dd>{sale.provenance}</dd></div><div><dt>Security match</dt><dd>{sale.securityKeyBasis || 'Unavailable'}</dd></div><div><dt>Quote</dt><dd>{sale.quote.currency} {Number(sale.quote.price).toLocaleString('en-CA', { maximumFractionDigits: 2 })}</dd></div><div><dt>Updated</dt><dd>{sale.quote.marketTime ? new Date(sale.quote.marketTime * 1000).toLocaleDateString('en-CA') : 'Date unavailable'}</dd></div></dl><p>Subsequent corporate actions are not modeled.</p></details>
      </article>)}
      {review.unpriced > 0 && <p className="tax-notice">{countLabel(review.unpriced, 'sale')} need a usable quote or exchange rate.</p>}
      {incomplete.length > 0 && <details className="tax-details"><summary>Incomplete cost-base pools · {incomplete.length}</summary><ul>{incomplete.map((pool) => <li key={pool.securityKey}>{pool.symbol}: {pool.incompleteReasons.join(', ')}</li>)}</ul></details>}
    </>}
  </section>
}

export default function TaxView({ accounts, workspace, onAddAccount }) {
  const { settings, loading, error, ledger, data = {}, prices, referenceLoading, syncState = {} } = workspace
  const currencies = [...new Set(accounts.flatMap((a) => [a.currency, ...(a.positions || []).map((r) => r['ACCOUNT CURRENCY'])]).filter(Boolean))].sort()
  const [chosenCurrency, setCurrency] = useState('CAD')
  const currency = currencies.includes(chosenCurrency) ? chosenCurrency : currencies[0] || 'CAD'
  const summary = useMemo(() => taxOverview(accounts, settings, currency, data), [accounts, settings, currency, data])
  const feeRows = accounts.flatMap((a) => (a.positions || []).filter((r) => (r['ACCOUNT CURRENCY'] || a.currency) === currency))
  const fees = summarizeFundFees(feeRows, data.reference)
  const unresolvedFees = feeRows.filter((r) => !data.reference?.[String(r.SYMBOL).toUpperCase()]?.exchange).map((r) => String(r.SYMBOL).toUpperCase())
  const feeGapCount = new Set([...unresolvedFees, ...(fees?.missingFeeData || [])]).size
  const [tool, setSelectedTool] = useState(null)
  const [toolOpen, setToolOpen] = useState(false)
  const openTool = (id) => { setSelectedTool(id); setToolOpen(true) }
  const historyUnavailable = ledger.loading || ledger.error || ledger.limited
  // Summary and report share the same period and measurement.
  const asOf = localTaxDate()
  const taxYear = Number(asOf.slice(0, 4))
  const fx = useMemo(
    () => measureConversionCost({ transactions: data.transactions, historyStarts: data.historyStarts, year: taxYear, asOf }),
    [data.transactions, data.historyStarts, taxYear, asOf],
  )
  // An optional what-if illustration, never a substitute for measured history.
  const fxEstimate = useMemo(
    () => estimateConversionCost({ transactions: data.transactions, year: taxYear, spreadPct: settings.brokerSpreadPct, measured: fx, asOf }),
    [data.transactions, taxYear, settings.brokerSpreadPct, fx, asOf],
  )
  const brokerEstimate = useMemo(() => estimateWealthsimpleFxFees({ transactions: data.transactions, year: taxYear, asOf, measured: fx }), [data.transactions, taxYear, asOf, fx])
  const showBrokerEstimate = !fx?.conversions.length && !!brokerEstimate
  const hasUsdActivity = (data.transactions ?? []).some((t) => String(t?.currency ?? '').toUpperCase() === 'USD')
  const [dataOpen, setDataOpen] = useState(false)
  return <div className="tax-page">
    <header className="tax-header">
      <div><h1>Tax & costs<span className="tax-year">{new Date().getFullYear()}</span></h1><p>Withholding, fund fees and contribution room.</p></div>
      <button type="button" className="tax-sync-button" onClick={workspace.sync} disabled={syncState.loading}><AccountIcon name="link" size={16} />{syncState.loading ? 'Syncing…' : 'Sync transactions'}</button>
    </header>
    <div className="tax-summary-heading"><h2>Your costs at a glance</h2>{currencies.length > 1 && <div className="tax-currency-control" role="group" aria-label="Tax display currency">{currencies.map((value) => <button type="button" key={value} aria-pressed={currency === value} onClick={() => setCurrency(value)}>{value}</button>)}</div>}</div>
    {workspace.referenceError && <p className="tax-error" role="alert">{workspace.referenceError}</p>}
    {error && <p className="tax-error" role="alert">{error}</p>}
    {ledger.error && <p className="tax-error" role="alert">{ledger.error} <button type="button" className="tax-text-button" onClick={workspace.retry}>Try again</button></p>}
    {ledger.limited && <p className="tax-notice">Transaction history is incomplete. Contribution and sale calculations are unavailable until full history is loaded.</p>}
    {syncState.error && <p className="tax-error" role="alert">{syncState.error}</p>}
    {syncState.result && <div className="tax-notice" role="status">
      <p>{syncState.result.written} transactions synced.{syncState.result.skipped > 0 ? ` ${syncState.result.skipped} records skipped.` : ''}</p>
      {(syncState.result.pruned > 0 || Object.keys(syncState.result.skippedReasons ?? {}).length > 0) && <details className="tax-details"><summary>Sync details</summary>{syncState.result.pruned > 0 && <p>{countLabel(syncState.result.pruned, 'record')} removed from disconnected accounts.</p>}<ul>{Object.entries(syncState.result.skippedReasons || {}).map(([reason, count]) => <li key={reason}>{count} · {reason}</li>)}</ul></details>}
    </div>}

    <div className="tax-summary">
      {accounts.length === 0 && <div className="tax-empty"><AccountIcon name="bank" size={24} /><h3>Add your first account</h3><p>See what withholding, fund fees and currency conversion actually cost you.</p>{onAddAccount && <button type="button" className="tax-button" onClick={onAddAccount}>Add an account</button>}</div>}
      <div className="tax-at-a-glance">
        <section className="tax-metric tax-hero" aria-label="Portfolio withholding summary">
          <div className="tax-hero-label">Dividend withholding <Badge>{summary.basis === 'measured' ? 'Recorded · 12 months' : 'Annual estimate'}</Badge></div>
          <div className={`tax-hero-amount ${!summary.covered ? 'tax-amount-empty' : ''}`}>{loading || referenceLoading ? '—' : summary.covered ? money(summary.annualMinor, currency) : 'Not estimated'}</div>
          <span className="tax-metric-unit">{currency} / year</span>
          <p>{summary.covered ? `${countLabel(summary.covered, 'holding')} · ${summary.assumedYield ? 'Includes assumed yields' : 'Resolved dividend yields'}` : 'Account types and listing details are needed.'}{summary.gaps.length > 0 && <span className="tax-inline-gap">{countLabel(summary.gaps.length, 'holding')} not included</span>}</p>
          <div className="tax-metric-note">Potential foreign tax credit <strong>{summary.covered ? money(summary.creditMinor, currency) : '—'} {currency}</strong></div>
          <div className="tax-metric-footer"><button type="button" className="tax-text-button" onClick={() => setDataOpen(true)}>Review estimate <AccountIcon name="arrow" size={14} /></button></div>
        </section>
        <section className="tax-metric" aria-label="Annual fund fee summary">
          <div className="tax-hero-label">Fund expenses <Badge>Annual estimate</Badge></div>
          <div className={`tax-hero-amount ${!fees?.holdings.length ? 'tax-amount-empty' : ''}`}>{referenceLoading ? '—' : fees?.holdings.length ? money(fees.annualFeeMinor, currency) : fees || unresolvedFees.length ? 'Not estimated' : 'No funds identified'}</div>
          <span className="tax-metric-unit">{currency} / year</span>
          <p>{fees?.weightedMerPct != null ? `${fees.weightedMerPct.toFixed(3)}% weighted expense ratio · priced funds only` : 'Expense ratios apply to funds, not individual stocks.'}{feeGapCount > 0 && <span className="tax-inline-gap">{countLabel(feeGapCount, 'holding')} {feeGapCount === 1 ? 'needs' : 'need'} fee data</span>}</p>
          <div className="tax-metric-note">Deducted within your funds</div>
          <div className="tax-metric-footer"><button type="button" className="tax-text-button" onClick={() => openTool('fees')}>View breakdown<AccountIcon name="chevron" size={14} /></button></div>
        </section>
        <section className="tax-metric" aria-label="FX conversion cost summary" id="tax-fx-summary">
          <div className="tax-hero-label">FX conversion costs <Badge>{historyUnavailable ? 'Unavailable' : showBrokerEstimate ? 'Estimated fee' : fx?.conversions.length ? 'Measured' : 'Not measured'}</Badge></div>
          <div className={`tax-hero-amount ${(!fx?.conversions.length && !showBrokerEstimate) || historyUnavailable ? 'tax-amount-empty' : ''}`}>{historyUnavailable ? 'Unavailable' : fx?.conversions.length ? money(fx.totalCostMinor, 'CAD') : showBrokerEstimate ? money(brokerEstimate.totalCostMinor, 'CAD') : 'Not measured'}</div>
          <span className="tax-metric-unit">CAD · {taxYear} to date</span>
          <p>{historyUnavailable ? 'Complete transaction history is needed.' : fx?.conversions.length ? `${countLabel(fx.conversions.length, 'measured conversion')}${fx.complete ? '' : ` · ${fx.unpricedCount} records not priced`}` : showBrokerEstimate ? `${countLabel(brokerEstimate.purchases.length, 'USD purchase')} · If funded from CAD` : fx?.unpricedCount ? 'Some records need currency details.' : hasUsdActivity ? 'USD purchases alone do not establish a conversion.' : 'No conversions recorded.'}</p>
          <div className="tax-metric-note">{showBrokerEstimate ? '1.5% published fee · Exact FX cost unavailable' : fx?.totalCostMinor < 0 ? 'Below the daily reference rate' : 'Compared with the daily reference rate'}</div>
          <div className="tax-metric-footer"><button type="button" className="tax-text-button" onClick={() => openTool('currency')}>View conversions <AccountIcon name="arrow" size={14} /></button></div>
        </section>
      </div>
      <div className="tax-data-link"><span>{summary.gaps.length || feeGapCount ? 'Some holdings are excluded where data is missing.' : 'Based on your holdings and available records.'}</span><button type="button" className="tax-text-button" onClick={() => setDataOpen(true)}>Data & assumptions <AccountIcon name="arrow" size={14} /></button></div>
    </div>
    <section className="tax-tool-list" aria-label="Tax tools"><h2>Plan & review</h2>
      {[
        ['room', 'Contribution room', 'Add or update your TFSA and RRSP room.', 'bank'],
        ['accounts', 'Compare accounts', 'See how account type changes dividend withholding.', 'shield'],
        ['sales', 'Review sales', 'Compare a sale with the value of those shares today.', 'file'],
      ].map(([id, title, description, icon]) => <button type="button" className="tax-tool-row" key={id} onClick={() => openTool(id)}><span className="tax-tool-icon"><AccountIcon name={icon} size={20} /></span><span><strong>{title}</strong><small>{description}</small></span><AccountIcon name="chevron" size={16} /></button>)}
    </section>
    <TaxDataDialog open={dataOpen} onClose={() => setDataOpen(false)} summary={summary} workspace={workspace} />
    <Modal open={toolOpen} onClose={() => setToolOpen(false)} labelledBy="tax-tool-title" className="tax-tool-dialog"><ModalClose onClose={() => setToolOpen(false)} /><div className="tax-tool-body">
      {tool === 'room' && <ContributionSection workspace={workspace} accounts={accounts} />}
      {tool === 'accounts' && <WithholdingSimulator accounts={accounts} settings={settings} currency={currency} reference={data.reference} />}
      {tool === 'fees' && <FeesSection accounts={accounts} reference={data.reference} loading={referenceLoading} />}
      {tool === 'currency' && <ConversionSection brokerEstimate={brokerEstimate} measured={fx} estimate={fxEstimate} accounts={accounts} year={taxYear} hasUsdActivity={hasUsdActivity} unavailable={historyUnavailable} />}
      {tool === 'sales' && <SalesSection ledger={ledger} prices={prices} />}
    </div></Modal>
    <footer className="tax-footer"><span>Estimates, not a tax return.</span><div><button type="button" onClick={workspace.retry}>Refresh data</button><a href={TREATY} target="_blank" rel="noreferrer">Canada–US treaty ↗</a></div></footer>
  </div>
}
