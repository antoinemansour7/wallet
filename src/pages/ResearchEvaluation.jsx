import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import '../components/landing/tokens.css'
import './ResearchEvaluation.css'

const pct = (v) => Number.isFinite(v) ? `${v.toFixed(2)}%` : 'Unavailable'
const periodName = (p) => ({ development: 'Development · Preliminary', validation: 'Validation',
  'final-untouched': 'Untouched evaluation', 'embargo-1': 'Embargo', 'embargo-2': 'Embargo', 'post-study': 'Post-study' })[p] || p

function Results({ horizons }) {
  return <div className="evaluation-table-wrap"><table><thead><tr>
    <th>Horizon</th><th>Completed / pending</th><th>Unavailable</th><th>Mean / median</th><th>Net mean / median</th>
    <th>Benchmark relative</th><th>Sector relative</th><th>Sample</th><th>Status</th>
  </tr></thead><tbody>{horizons.map((h) => <tr key={h.horizon}>
    <th>{h.horizon} sessions</th><td>{h.completed} completed / {h.pending} pending</td><td>{h.unavailable}</td>
    <td>{pct(h.meanReturn)} / {pct(h.medianReturn)}</td><td>{pct(h.meanNetReturn)} / {pct(h.medianNetReturn)}</td>
    <td>{pct(h.benchmarkRelative)} <small>n={h.benchmarkSampleSize}</small></td>
    <td>{pct(h.sectorRelative)} <small>n={h.sectorSampleSize}</small></td><td>{h.sampleSize}</td>
    <td>{h.completed === 0 ? '0 completed — insufficient data' : h.status}</td>
  </tr>)}</tbody></table></div>
}

function Arm({ arm }) {
  return <section className="evaluation-arm" aria-label={arm.name}>
    <div className="evaluation-arm-title"><h2>{arm.name}</h2><span>{arm.cohort}</span></div>
    <p>{arm.observations} observations · {arm.accepted} accepted · {arm.rejected} rejected · {arm.version || 'Version recorded per decision'}</p>
    {!arm.cohorts.length && <Results horizons={arm.emptyHorizons} />}
    {arm.cohorts.map((c) => <div key={`${c.version}:${c.period}`}>
      <h3>{periodName(c.period)} · {c.version}</h3>
      {c.sealed ? <p>Untouched evaluation — outcomes sealed until the predeclared release date.</p> : <>
        <Results horizons={c.horizons} />
        <details><summary>Uncertainty, losses and execution stress</summary>
          <p>Selection turnover: {pct(c.turnover === null ? null : c.turnover * 100)}. Uncertainty groups excess returns by decision date.</p>
          {c.horizons.map((h) => <p key={h.horizon}>{h.horizon} sessions: {h.distinctDates} dates · uncertainty interval {pct(h.lowerBound)} to {pct(h.upperBound)}
            {' · '}wins / losses / flat: {h.wins ?? 'Unknown'} / {h.losses ?? 'Unknown'} / {h.flat ?? 'Unknown'}
            {' · '}worst return: {pct(h.worstLoss)}
            {' · '}net return at 20 / 50 / 100 bps: {[20, 50, 100].map((cost) => pct(h.stressReturns[cost])).join(' / ')}
            {' · '}net return with 25 bps worse fills per side: {pct(h.adverseFillNetReturn)}
          </p>)}
          {c.portfolio && <p>Portfolio drawdown: {pct(c.portfolio.drawdown)} · peak concurrent exposure: {pct(c.portfolio.concurrentExposure)}
            {' · '}peak sector concentration: {pct(c.portfolio.sectorConcentration)} · funded turnover: {pct(c.portfolio.turnover === null ? null : c.portfolio.turnover * 100)}</p>}
        </details>
      </>}
    </div>)}
  </section>
}

const Eyebrow = () => <span className="evaluation-eyebrow">Private · Read only</span>

function CurrentJob({ job }) {
  if (!job) return null
  if (job.status === 'failed') {
    return <p className="evaluation-alert" role="status">
      Evaluation: failed · Reason: {job.error || 'Unknown'} · Retry state: {job.retryState}
    </p>
  }
  return <p className="evaluation-alert" role="status">
    Evaluation: pending · Frozen at: {new Date(job.frozenAt).toLocaleString()} · Next step: scheduled evaluation job
  </p>
}

export default function ResearchEvaluation() {
  const { user } = useAuth()
  const [state, setState] = useState(null)
  const [arm, setArm] = useState('all'), [status, setStatus] = useState('all'), [search, setSearch] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        if (!user?.getIdToken) throw new Error('Owner sign-in required')
        const token = await user.getIdToken()
        const response = await fetch('/api/get-research?evaluation=1', {
          method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Evaluation data is unavailable')
        if (!controller.signal.aborted) setState({ uid: user.uid, data })
      } catch (error) {
        if (!controller.signal.aborted) setState({ uid: user?.uid, error: error.message })
      }
    }
    load()
    return () => controller.abort()
  }, [user])
  const current = state?.uid === user?.uid ? state : null
  // A non-owner must never learn this page exists: no title, no "Private ·
  // Read only" framing, nothing while loading, and an immediate exit on
  // denial — the same redirect a truly unknown route would produce.
  if (!current) return null
  if (current.error) return <Navigate to="/portfolio" replace />
  const data = current.data
  const stocks = data.observations.filter((o) => (arm === 'all' || o.arm === arm) && (status === 'all' || o.status === status)
    && `${o.ticker} ${o.securityId} ${o.issuerId}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.decisionAt.localeCompare(a.decisionAt))
  return <div className="wallai-system research-evaluation">
    <header className="evaluation-head"><Eyebrow /><h1>Research evaluation</h1>
      <p className="evaluation-lede">Returns are hypothetical next-open fills. This experiment is collecting evidence; fundamentals has not proven itself.</p>
      <dl className="evaluation-run">
        <div><dt>Status</dt><dd>{data.status}</dd></div>
        <div><dt>Experiment</dt><dd>{data.experimentId}</dd></div>
        <div><dt>Variants tried</dt><dd>{data.variantsTried}</dd></div>
        <div><dt>Latest run</dt><dd>{data.latestRun ? new Date(data.latestRun.availableAt).toLocaleString() : 'No forward observations yet'}</dd></div>
      </dl>
      <CurrentJob job={data.currentJob} />
      {data.latestRun?.failures?.some(Boolean) && <p className="evaluation-alert" role="status">Some arms could not complete their review: {data.latestRun.failures.filter(Boolean).join(' · ')}</p>}
    </header>
    <details><summary>Predeclared periods and methodology</summary>
      <p>The attention engine is frozen at commit {data.definition?.baselineCommit || '0434948'}. Adding fundamentals preserves its attention selections and scores. The attention-disabled comparison reviews the same intake without attention features. Every alternative is shadow.</p>
      <p>Fundamentals quiet condition: at most 2 attention signals and at most 3% absolute daily price change (fundamentals-quiet-v1). Missing measurements remain unknown.</p>
      <p>Portfolio: $100,000 starting capital, $10,000 orders, 50% allocation limit, 20% sector allocation limit, 20-session holds. Missing spread, liquidity or sector data prevents allocation.</p>
      {data.definition?.periods.map((p) => <p key={p.id}>{periodName(p.id)}: {p.start.slice(0, 10)} to {p.end.slice(0, 10)}</p>)}
      <p>Untouched outcomes release: {data.definition?.finalReleaseAt?.slice(0, 10) || 'Scheduled when forward collection starts'}.</p>
    </details>
    {data.arms.map((a) => <Arm key={a.id} arm={a} />)}
    <section className="evaluation-arm" aria-label="Individual observations"><h2>Individual stocks and daily observations</h2>
      <div className="evaluation-filters">
        <label>Experiment<select value={arm} onChange={(e) => setArm(e.target.value)}><option value="all">All experiments</option>{data.arms.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.cohort}</option>)}</select></label>
        <label>Decision<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Accepted and rejected</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select></label>
        <label>Stock<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ticker or security ID" /></label>
      </div>
      <p className="evaluation-count">{stocks.length} matching observations</p>
      {stocks.map((o) => <details key={o.id} className="evaluation-stock"><summary>{o.ticker} · {o.decisionAt.slice(0, 10)} · {o.arm} · {o.cohort} · {o.status}</summary>
        <p>{o.securityId || 'Identity unavailable'} · {o.issuerId || 'Issuer unavailable'} · {o.strategyFamily} · {o.armVersion}</p>
        <p>Decision: {o.decisionAt} · horizons: {o.horizons.join(', ')} sessions · {periodName(o.period)}</p>
        <p>Score: {o.score ?? 'Unknown'} · rank: {o.rank ?? 'Unknown'} · decision price: {o.price ?? 'Unknown'} {o.currency} · sector: {o.sector || 'Unavailable'}</p>
        <p>{o.rejectionReason || o.reason || 'Delivered research decision'}</p>
        <p>Evidence IDs: {(o.evidenceIds || []).join(', ') || 'Unavailable'}</p>
        {o.outcomes.map((r) => <p key={r.horizon}>{r.horizon} sessions: {r.status} · return {pct(r.grossReturn)} · net {pct(r.netReturn)} · benchmark relative {pct(r.excessReturn)} · sector relative {pct(r.sectorExcessReturn)}{r.reason ? ` · ${r.reason}` : ''}</p>)}
      </details>)}
    </section>
  </div>
}
