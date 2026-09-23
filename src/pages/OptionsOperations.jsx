import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { OPTIONS_API, useOptionsResource } from './options/useOptionsResource'
import { timestamp, words } from './options/display'
import '../components/landing/tokens.css'
import './Options.css'

function Operations({ user }) {
  const { verified, denied, busy, data, error, reload } = useOptionsResource(user, `${OPTIONS_API}&view=operations`)
  if (denied) return <Navigate to="/portfolio" replace />
  if (!verified) return error ? <Navigate to="/portfolio" replace /> : null
  const report = data?.operations
  return <div className="wallai-system options-workspace"><header className="options-header"><div><span className="options-label">Private · Operations</span><h1>Options operations</h1><p>Archived diagnostics and quota monitoring.</p></div><Link to="/options">Morning opportunities ↗</Link></header>
    <div className="options-toolbar"><p>{words(report?.status)} · checked {timestamp(report?.checkedAt)}</p><button type="button" onClick={reload} disabled={busy}>{busy ? 'Loading…' : 'Reload diagnostics'}</button></div>
    {error && <p role="alert" className="options-notice">{error.message}{error.referenceId && <small>Reference: {error.referenceId}</small>}</p>}
    {report && <><p>Kill switch: {report.killSwitchEngaged == null ? 'Unknown' : report.killSwitchEngaged ? 'Engaged' : 'Not engaged'} · Trading date {report.tradingDate || 'Unavailable'}</p>
      {['scheduleHealth', 'stageTimings', 'watchlistCoverage', 'chainQuality', 'pricingResiduals', 'finalDecision', 'missingEvidence'].map((field) => <details className="options-operation" key={field}><summary>{words(field)}</summary><pre>{JSON.stringify(report[field] ?? 'Unavailable', null, 2)}</pre></details>)}
      <details className="options-operation"><summary>Storage and publication</summary><p>R2 uncompressed bytes: {report.r2UncompressedBytes ?? 'Unavailable'}</p><p>Manifest <code>{report.manifestId || 'Unavailable'}</code></p><pre>{JSON.stringify(report.publication ?? 'Unavailable', null, 2)}</pre></details></>}
  </div>
}
export default function OptionsOperations() {
  const { user } = useAuth()
  return <Operations key={user?.uid || 'signed-out'} user={user} />
}
