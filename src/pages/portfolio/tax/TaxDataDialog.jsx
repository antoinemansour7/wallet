import { useState } from 'react'
import Modal, { ModalHeader } from '../../../components/Modal'

const percent = (value) => Number.isFinite(value) ? `${new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 }).format(value)}%` : '—'
const exchangeLabel = (value) => ({ NMS: 'Nasdaq', NGM: 'Nasdaq', NCM: 'Nasdaq', NYQ: 'NYSE', PCX: 'NYSE Arca', BTS: 'Cboe', TOR: 'TSX' })[value] || value || 'Listing unavailable'

const money = (minor, currency) => Number.isFinite(minor)
  ? `${new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ${currency || ''}`.trim()
  : '—'

export default function TaxDataDialog({ open, onClose, summary, workspace }) {
  const [yieldDraft, setYieldDraft] = useState(null)
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(20)
  const { settings, update, loading, saving, loadFailed, error, data = {} } = workspace
  const ledger = [...(workspace.ledger?.transactions ?? data.transactions ?? [])]
    .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0))
  const filtered = ledger.filter((row) => [row.tradeDate, row.action, row.symbol, row.accountId, row.currency].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  const ledgerUnavailable = workspace.ledger?.loading || workspace.ledger?.error
  return <Modal open={open} onClose={onClose} labelledBy="tax-data-title" className="tax-data-dialog">
    <ModalHeader id="tax-data-title" title="Data & assumptions" onClose={onClose} />
    <div className="tax-data-body">
      <p className="tax-data-intro">The details behind your withholding estimate. Missing information is excluded, never treated as zero.</p>
      {summary.gaps.length > 0 && <section className="tax-data-gaps" aria-label="Excluded holdings">
        <h3>{summary.gaps.length} {summary.gaps.length === 1 ? 'holding' : 'holdings'} not included</h3>
        <ul>{summary.gaps.map(({ row, reason }, index) => <li key={`${row.SYMBOL}:${index}`}><strong>{row.SYMBOL}</strong><span>{reason}</span></li>)}</ul>
      </section>}
      <details className="tax-data-assumption"><summary>Adjust the assumed dividend yield</summary><section className="tax-data-fallback" aria-label="Yield assumption">
        <div><h3>Fallback dividend yield</h3><p>Used only when a holding’s dividend yield is unavailable.</p></div>
        <form className="tax-yield-form" onSubmit={async (event) => { event.preventDefault(); if (await update({ yieldPct: Number(yieldDraft ?? settings.yieldPct ?? 1.3) })) setYieldDraft(null) }}>
          <label className="sr-only" htmlFor="tax-yield">Fallback yield (%)</label>
          <div className="tax-input-suffix"><input id="tax-yield" type="number" min="0" max="100" step="0.1" required value={yieldDraft ?? settings.yieldPct ?? 1.3} onChange={(event) => setYieldDraft(event.target.value)} /><span aria-hidden="true">%</span></div>
          <button type="submit" className="tax-button" disabled={loading || saving || loadFailed || yieldDraft === null}>{saving ? 'Saving…' : 'Apply'}</button>
        </form>
      </section></details>
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
      <details className="tax-data-ledger"><summary>Imported transactions <span>{ledger.length}</span></summary>
        <p>Search your imported records by holding, account, date or action.</p>
        {ledgerUnavailable ? <p className="tax-footnote">{workspace.ledger.loading ? 'Loading transaction history…' : 'Transaction history is unavailable. Retry from the Tax page.'}</p> : <>
          {workspace.ledger?.limited && <p className="tax-notice">Showing a limited history. These records are not a complete account statement.</p>}
          {ledger.length > 0 ? <><label className="tax-ledger-search">Find a transaction<input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setVisibleCount(20) }} placeholder="Holding, account or date" /></label>
            <div className="tax-reference-scroll"><table className="tax-reference-table tax-ledger-table"><caption className="sr-only">Imported transactions</caption><thead><tr><th scope="col">Transaction</th><th scope="col">Account</th><th scope="col">Amount</th></tr></thead><tbody>
              {filtered.slice(0, visibleCount).map((row, index) => <tr key={`${row.accountId}:${row.id ?? index}`}><th scope="row"><strong>{row.symbol || 'Cash'} · {String(row.action || 'Unknown').toLowerCase().replaceAll('_', ' ')}</strong><small>{row.tradeDate}</small></th><td>{row.accountId ? String(row.accountId).slice(-8) : 'Unavailable'}</td><td>{money(row.amountMinor, row.currency)}<small>{row.currency === 'CAD' ? 'CAD amount' : Number(row.fxRate) > 0 ? `CAD rate ${Number(row.fxRate).toFixed(4)}` : 'FX rate unavailable'}</small></td></tr>)}
            </tbody></table></div><p className="tax-footnote">Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} matching records.</p>{filtered.length > visibleCount && <button type="button" className="tax-text-button" onClick={() => setVisibleCount((count) => count + 20)}>Show 20 more</button>}
          </> : <p className="tax-footnote">No transactions imported yet. Use Sync transactions to load them.</p>}
        </>}
      </details>
    </div>
  </Modal>
}
