import { useState } from 'react'
import { number, percent, timestamp, words } from './display'

export default function Step1Experiments({ data }) {
  const [selectedArm, setSelectedArm] = useState('current15')
  if (!data) return null
  const latest = data.latest
  const arm = latest?.arms.find((item) => item.id === selectedArm)
  return <section className="options-summary" aria-label="Step 1 experiments">
    <h2>Step 1 experiments</h2>
    <p>Separate 9:36–9:50 scan · primary exit: close three sessions later · indicative ask → observed bid after costs.</p>
    {!data.summaries.length ? <p>Waiting for the first experiment scan. The controls and new signals will be frozen together after the live scan.</p> : <>
      <div className="options-table-wrap" role="region" tabIndex={0} aria-label="Step 1 experiment comparison"><table>
        <caption>Terminal returns, not intraday target hits. Unknown outcomes are excluded from returns and shown separately.</caption>
        <thead><tr>{['Experiment', 'Observed / selected', 'Unknown · pending', 'Median', 'Mean', 'Mean without top 5', 'Worst', 'Exit ≥ +25%', 'Paired change vs control'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{data.summaries.map((row) => <tr key={`${row.policyVersion}:${row.id}`}>
          <th scope="row">{row.label}<small>{row.sessions} sessions · {row.completeSessions} fully observed</small></th>
          <td>{row.observed} / {row.selected}<small>{row.ineligible} ineligible · {row.unavailable} unavailable</small></td>
          <td>{row.unknown} · {row.pending}</td><td>{percent(row.medianReturnPct)}</td><td>{percent(row.meanReturnPct)}</td>
          <td>{percent(row.meanWithoutTop5Pct)}</td><td>{percent(row.worstReturnPct)}</td><td>{percent(row.terminal25Pct)}</td>
          <td>{row.control ? <>{row.pairedDeltaPct == null ? 'Waiting for complete pairs' : `${number(row.pairedDeltaPct, 2)} percentage points`}
            <small>{row.pairedSessions} paired sessions · {data.definitions.find((item) => item.id === row.control)?.label}</small></> : 'Control'}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="options-muted">A high average with a weak median can reflect a few outsized winners. Paired changes use only sessions with complete outcomes in both arms. These overlapping experiments are not independent evidence.</p>
    </>}
    {latest && <details className="options-operation"><summary>Latest frozen experiment · {latest.tradingDate} · {words(latest.status)}</summary>
      <p>Captured {timestamp(latest.availableAt)} · {latest.attempts > 1 ? `finished on attempt ${latest.attempts}, last run` : 'scan'} {number(latest.elapsedMs / 1000, 1)} seconds.</p>
      <label>Experiment <select value={selectedArm} onChange={(event) => setSelectedArm(event.target.value)}>
        {data.definitions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      {arm && <>
        <p>Signal coverage: {arm.signalCoverage.withGap} gap · {arm.signalCoverage.withVolume} prior-session volume · {arm.signalCoverage.withNews} news · {arm.signalCoverage.withAllSignals} combined, out of {arm.signalCoverage.eligibleStocks} eligible stocks.</p>
        {!arm.rows.length ? <p>No qualifying selections. Missing signal coverage does not count as a failed trade.</p> : <div className="options-table-wrap"><table>
          <caption>Frozen selections and three-session outcomes</caption>
          <thead><tr>{['Stock', 'Direction', 'Status', 'Return', 'Stock move', 'Absolute move / IV estimate'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{arm.rows.map((row) => <tr key={`${row.securityId}:${row.direction}`}>
            <th scope="row">{row.ticker}</th><td>{words(row.direction)}</td><td>{words(row.reason || row.outcome?.status || row.status)}</td>
            <td>{percent(row.outcome?.returnPct)}</td><td>{percent(row.outcome?.stockMovePct)}</td><td>{Number.isFinite(row.outcome?.absoluteMoveVsImplied) ? `${number(row.outcome.absoluteMoveVsImplied, 2)}×` : 'Unknown'}</td>
          </tr>)}</tbody>
        </table></div>}
      </>}
    </details>}
    <details className="options-operation"><summary>Experiment design and limits</summary>
      <ul>{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      <p>The 60-day trend is a low-confidence directional hypothesis. Calendar estimates alone never qualify as a verified earnings release.</p>
      <p>Policy {data.policy.version}. New policy versions are summarized separately.</p>
    </details>
  </section>
}
