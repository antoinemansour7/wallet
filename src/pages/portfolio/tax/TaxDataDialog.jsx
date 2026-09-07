import { useState } from 'react'
import Modal, { ModalHeader } from '../../../components/Modal'

const percent = (value) => Number.isFinite(value) ? `${new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 }).format(value)}%` : '—'
const exchangeLabel = (value) => ({ NMS: 'Nasdaq', NGM: 'Nasdaq', NCM: 'Nasdaq', NYQ: 'NYSE', PCX: 'NYSE Arca', BTS: 'Cboe', TOR: 'TSX' })[value] || value || 'Listing unavailable'

const money = (minor, currency) => Number.isFinite(minor)
  ? `${new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ${currency || ''}`.trim()
  : '—'

export default function TaxDataDialog({ open, onClose, summary, workspace }) {
  const [yieldDraft, setYieldDraft] = useState(null)
  const { settings, update, loading, saving, loadFailed, error, data = {} } = workspace
  // Every figure on this page is derived from these rows, so when one is
  // missing the ledger is the only place the answer can be. Counts and
  // refusals describe it from the outside; this is the thing itself.
  const ledger = [...(data.transactions ?? [])]
    .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0))
  return <Modal open={open} onClose={onClose} labelledBy="tax-data-title" className="tax-data-dialog">
    <ModalHeader id="tax-data-title" title="Data & assumptions" onClose={onClose} />
    <div className="tax-data-body">
      <p className="tax-data-intro">The details behind your withholding estimate. Missing information is excluded, never treated as zero.</p>
      {summary.gaps.length > 0 && <section className="tax-data-gaps" aria-label="Excluded holdings">
        <h3>{summary.gaps.length} {summary.gaps.length === 1 ? 'holding' : 'holdings'} not included</h3>
        <ul>{summary.gaps.map(({ row, reason }, index) => <li key={`${row.SYMBOL}:${index}`}><strong>{row.SYMBOL}</strong><span>{reason}</span></li>)}</ul>
      </section>}
      <section className="tax-data-fallback" aria-label="Yield assumption">
        <div><h3>Fallback dividend yield</h3><p>Used only when a holding’s dividend yield is unavailable.</p></div>
        <form className="tax-yield-form" onSubmit={async (event) => { event.preventDefault(); if (await update({ yieldPct: Number(yieldDraft ?? settings.yieldPct ?? 1.3) })) setYieldDraft(null) }}>
          <label className="sr-only" htmlFor="tax-yield">Fallback yield (%)</label>
          <div className="tax-input-suffix"><input id="tax-yield" type="number" min="0" max="100" step="0.1" required value={yieldDraft ?? settings.yieldPct ?? 1.3} onChange={(event) => setYieldDraft(event.target.value)} /><span aria-hidden="true">%</span></div>
          <button type="submit" className="tax-button" disabled={loading || saving || loadFailed || yieldDraft === null}>{saving ? 'Saving…' : 'Apply'}</button>
        </form>
      </section>
      {error && <p className="tax-error" role="alert">{error}</p>}
      <section className="tax-data-references" aria-label="Holding references">
        <h3>Holding references</h3><p>Fund-level estimates assume US-source dividends and treaty rates. Yield figures below are rounded for display.</p>
        <div className="tax-reference-scroll"><table className="tax-reference-table"><thead><tr><th scope="col">Holding / source</th><th scope="col">Account</th><th scope="col">Yield</th></tr></thead><tbody>
          {summary.rows.flatMap(({ account, holdings }) => holdings.map(({ row, projection }, index) => <tr key={`${account.accountNumber}:${row.SYMBOL}:${index}`}>
            <th scope="row"><strong>{row.SYMBOL}</strong><small>{exchangeLabel(projection.provenance.exchange)} · {projection.provenance.resolvedAt?.slice(0, 10) || 'Reference date unavailable'}</small>{projection.treatment === 'IN_FUND' && <small>Fund-level estimate</small>}</th>
            <td>{account.accountNumber}</td><td><strong>{percent(projection.workings.yieldPct)}</strong><small>{projection.provenance.yieldBasis === 'assumed' ? 'Assumed' : 'Trailing yield'}</small></td>
          </tr>))}
        </tbody></table></div>
        {!summary.covered && <p className="tax-footnote">No holding references available for this estimate yet.</p>}
      </section>
      <section className="tax-data-ledger" aria-label="Transaction ledger">
        <h3>Transaction ledger</h3>
        <p>Every imported record. A currency conversion appears as two rows on one date — one leaving in CAD, one arriving in USD.</p>
        {ledger.length > 0 ? <div className="tax-reference-scroll"><table className="tax-reference-table">
          <thead><tr><th scope="col">Date</th><th scope="col">Action</th><th scope="col">Holding</th><th scope="col">Amount</th><th scope="col">Reference rate</th></tr></thead>
          <tbody>{ledger.map((row, index) => <tr key={`${row.id ?? index}`}>
            <td>{row.tradeDate}</td>
            <td>{row.action}</td>
            <td>{row.symbol || <span className="tax-footnote">Cash</span>}</td>
            <td>{money(row.amountMinor, row.currency)}</td>
            {/* Named rather than shown as a blank: a conversion cannot be
                priced without one, and its absence is the answer to why. */}
            <td>{Number.isFinite(Number(row.fxRate)) && Number(row.fxRate) > 0 ? Number(row.fxRate).toFixed(4) : <span className="tax-footnote">None</span>}</td>
          </tr>)}</tbody>
        </table></div> : <p className="tax-footnote">No transactions imported yet. Sync from the Tax page to load them.</p>}
      </section>
    </div>
  </Modal>
}
