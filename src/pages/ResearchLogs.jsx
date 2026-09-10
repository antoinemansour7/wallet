import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import '../components/landing/tokens.css'
import './ResearchLogs.css'

const OUTCOME = {
  published: 'Published',
  accepted: 'Reviewed, not published',
  rejected: 'Rejected',
  not_reviewed: 'Not reviewed',
  board: 'On the board only',
}

const seconds = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : 'Unknown')
const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'Unknown')

function Stage({ stage }) {
  return <tr className={`logs-stage logs-stage-${stage.status}`}>
    <th scope="row">{stage.stage}</th>
    <td>{stage.status}</td>
    <td>{seconds(stage.durationMs)}</td>
    <td>{Object.entries(stage.metrics || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || '—'}</td>
    <td>{stage.error?.message || ''}</td>
  </tr>
}

function Candidate({ candidate }) {
  return <tr>
    <th scope="row">{candidate.ticker || candidate.securityId}</th>
    <td>{OUTCOME[candidate.outcome] || candidate.outcome}</td>
    <td>{candidate.reviewed ? 'Sent to the model' : 'Never sent'}</td>
    <td>{candidate.rank ? `#${candidate.rank}` : '—'}</td>
    <td>{Number.isFinite(candidate.finalScore) ? candidate.finalScore : '—'}</td>
    <td>{candidate.catalystVerified === undefined ? '—' : candidate.catalystVerified ? 'Verified' : 'Unverified'}</td>
    <td>{candidate.reason || ''}</td>
  </tr>
}

function Run({ run, ticker }) {
  const candidates = (run.candidates || []).filter((c) => !ticker || (c.ticker || '').toLowerCase().includes(ticker))
  return <section className="logs-run" aria-label={`${run.job} ${run.startedAt}`}>
    <div className="logs-run-head">
      <h2>{run.job}</h2>
      <span className={`logs-status logs-status-${run.status}`}>{run.status}</span>
      <span>{when(run.startedAt)}</span>
      <span>{seconds(run.durationMs)}</span>
    </div>
    <div className="logs-table-wrap"><table>
      <caption>Stages</caption>
      <thead><tr><th>Stage</th><th>Status</th><th>Duration</th><th>Counts</th><th>Error</th></tr></thead>
      <tbody>{(run.stages || []).map((s) => <Stage key={`${run.runId}:${s.stage}`} stage={s} />)}</tbody>
    </table></div>
    {candidates.length > 0 && <div className="logs-table-wrap"><table>
      <caption>Candidates</caption>
      <thead><tr><th>Ticker</th><th>Outcome</th><th>Model</th><th>Rank</th><th>Score</th><th>Catalyst</th><th>Reason</th></tr></thead>
      <tbody>{candidates.map((c) => <Candidate key={`${run.runId}:${c.ticker || c.securityId}`} candidate={c} />)}</tbody>
    </table></div>}
  </section>
}

const Eyebrow = () => <span className="logs-eyebrow">Private · Read only</span>

export default function ResearchLogs() {
  const { user } = useAuth()
  const [state, setState] = useState(null)
  const [ticker, setTicker] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        if (!user?.getIdToken) throw new Error('Owner sign-in required')
        const token = await user.getIdToken()
        const response = await fetch('/api/get-research?runs=1', {
          method: 'GET', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Run history is unavailable')
        if (!controller.signal.aborted) setState({ uid: user.uid, runs: data.runs || [] })
      } catch (error) {
        if (!controller.signal.aborted) setState({ uid: user?.uid, error: error.message })
      }
    }
    load()
    return () => controller.abort()
  }, [user])

  const current = state?.uid === user?.uid ? state : null
  const search = ticker.trim().toLowerCase()
  // A ticker filter that hid whole runs would answer "where is RKLB" with an
  // empty page. Runs stay; their candidate lists narrow.
  const runs = useMemo(() => (current?.runs || []).filter((run) => !search
    || (run.candidates || []).some((c) => (c.ticker || '').toLowerCase().includes(search))), [current, search])

  // A non-owner must never learn this page exists: no title, no "Private ·
  // Read only" framing, nothing while loading, and an immediate exit on
  // denial — the same redirect a truly unknown route would produce.
  if (!current) return null
  if (current.error) return <Navigate to="/portfolio" replace />

  return <div className="wallai-system research-logs">
    <header className="logs-head"><Eyebrow /><h1>Research logs</h1>
      <p className="logs-lede">What each research run did, how long each stage took, and why a candidate did or did not reach the board.</p>
      <div className="logs-filters">
        <label htmlFor="logs-ticker">Ticker</label>
        <input id="logs-ticker" value={ticker} onChange={(event) => setTicker(event.target.value)} placeholder="RKLB" />
      </div>
    </header>
    {current.runs.length === 0 && <p className="logs-empty">No research runs recorded yet. The next scheduled run will appear here.</p>}
    {current.runs.length > 0 && runs.length === 0 && <p className="logs-empty">No run in this history mentions that ticker.</p>}
    {runs.map((run) => <Run key={run.runId} run={run} ticker={search} />)}
  </div>
}
