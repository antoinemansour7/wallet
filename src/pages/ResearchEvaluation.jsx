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
    {arm.dataLimited > 0 && <p>{arm.dataLimited} decisions could not be allocated because trading volume or sector data was unavailable.</p>}
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
  if (job.status === 'started') return <p className="evaluation-alert" role="status">Evaluation: running · Review in progress.</p>
  return <p className="evaluation-alert" role="status">
    Evaluation: pending · Frozen at: {new Date(job.frozenAt).toLocaleString()} · Next step: scheduled evaluation job
  </p>
}

function ReviewFailures({ failures }) {
  if (!failures?.some(Boolean)) return null
  const outOfCredits = failures.some((failure) => /credit balance is too low/i.test(failure || ''))
  return <div className="evaluation-alert" role="status">
    <p>{outOfCredits
      ? 'This review was blocked because Anthropic credits ran out. Reviews now run on OpenAI, so the next one will not need them.'
      : 'Some comparisons could not complete their latest review.'} Existing results remain available.</p>
    <details><summary>Review failure details</summary>
      {failures.map((failure, index) => failure && <p key={index}>
        {index === 0 ? 'Frozen engine review' : 'Attention-blind review'}: {failure}
      </p>)}
    </details>
  </div>
}

export default function ResearchEvaluation() {
  const { user, isResearchOwner } = useAuth()
  const [state, setState] = useState(null)
  const [reload, setReload] = useState(0)
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
        if ([401, 403].includes(response.status)) {
          if (!controller.signal.aborted) setState({ uid: user.uid, denied: true })
          return
        }
        if (!response.ok) throw new Error(data.error || 'Evaluation data is unavailable')
        if (!controller.signal.aborted) setState({ uid: user.uid, data })
      } catch (error) {
        if (!controller.signal.aborted) setState({ uid: user?.uid, error: error.message })
      }
    }
    load()
    return () => controller.abort()
  }, [user, reload])
  const current = state?.uid === user?.uid ? state : null
  // A non-owner must never learn this page exists: no title, no "Private ·
  // Read only" framing, nothing while loading, and an immediate exit on
  // denial — the same redirect a truly unknown route would produce.
  if (!current) return isResearchOwner ? <div className="wallai-system research-evaluation"><p role="status">Loading evaluation summary…</p></div> : null
  if (current.denied || (current.error && !isResearchOwner)) return <Navigate to="/portfolio" replace />
  if (current.error) return <div className="wallai-system research-evaluation"><div className="evaluation-state">
    <h1>Research evaluation</h1><p role="alert">{current.error}</p>
    <button onClick={() => { setState(null); setReload((value) => value + 1) }}>Try again</button>
  </div></div>
  const data = current.data
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
      {data.generatedAt && <p>Summary updated {new Date(data.generatedAt).toLocaleString()}.</p>}
      {data.stale && <p className="evaluation-alert" role="status">This summary is more than 36 hours old. The last available results are shown while the next update is pending.</p>}
      <ReviewFailures failures={data.latestRun?.failures} />
    </header>
    <details><summary>Predeclared periods and methodology</summary>
      <p>The attention selection and scoring rules come from commit {data.definition?.baselineCommit || '0434948'}. New reviews use OpenAI and have separate version labels from the original Anthropic baseline. Adding fundamentals preserves the attention selections and scores. The attention-disabled comparison reviews the same intake without attention features. Every alternative is shadow.</p>
      <p>Fundamentals quiet condition: at most 2 attention signals and at most 3% absolute daily price change (fundamentals-quiet-v1). Missing measurements remain unknown.</p>
      <p>Portfolio: $100,000 starting capital, $10,000 orders, 50% allocation limit, 20% sector allocation limit, 20-session holds. Missing trading volume or sector data prevents allocation. The buy/sell spread is checked when known; the review runs overnight, when the free quote sources have none.</p>
      {data.definition?.periods.map((p) => <p key={p.id}>{periodName(p.id)}: {p.start.slice(0, 10)} to {p.end.slice(0, 10)}</p>)}
      <p>Untouched outcomes release: {data.definition?.finalReleaseAt?.slice(0, 10) || 'Scheduled when forward collection starts'}.</p>
    </details>
    {data.arms.map((a) => <Arm key={a.id} arm={a} />)}
  </div>
}
