import { useId, useState } from 'react'

const bandFor = (score) => score >= 7 ? 'supportive' : score >= 5 ? 'mixed' : 'cautious'

export default function RegimeGauge({ regime, defaultOpen = false }) {
  const detailId = useId()
  const titleId = useId()
  const [open, setOpen] = useState(defaultOpen)
  const hasScore = regime?.score != null && Number.isFinite(Number(regime.score))
  if (!hasScore) return <section className="research-market" aria-labelledby={titleId}>
    <h2 id={titleId}>Market backdrop</h2>
    <p className="research-muted">Market context is unavailable. The research ideas are still available to review.</p>
  </section>

  const score = Number(regime.score)
  return <section className="research-market" aria-labelledby={titleId} data-band={bandFor(score)}>
    <div className="research-support-heading">
      <div>
        <h2 id={titleId}>Market backdrop</h2>
        <p className="research-market-score">{regime.label || 'Current conditions'} <span>· {score} / 10</span></p>
        {regime.drag && <p className="research-muted">Weakest factor: {regime.drag.label}</p>}
      </div>
      <button type="button" className="research-text-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={detailId}>{open ? 'Hide backdrop' : 'View backdrop'}<span aria-hidden="true">{open ? '↑' : '↓'}</span></button>
    </div>
    <div id={detailId} className="research-market-components" hidden={!open}>
      <div className="research-market-track" role="meter" aria-label="Market conditions score" aria-valuemin={0} aria-valuemax={10} aria-valuenow={score}><span style={{ width: `${Math.max(0, Math.min(100, score * 10))}%` }} /></div>
      <div className="research-market-scale" aria-hidden="true"><span>Cautious</span><span>Supportive</span></div>
      {regime.drag && <p className="research-market-drag"><span>Weakest part · {regime.drag.label}</span>{regime.drag.detail}</p>}
      {(regime.components ?? []).map((component) => <div className="research-market-component" key={component.key}>
        <div><h3>{component.label}</h3><span>{component.score ?? '—'}<small> / 10</small></span></div>
        <p>{component.detail}</p>{component.metric && <p className="research-market-metric">{component.metric}</p>}
      </div>)}
      <p className="research-market-note">This scores the market, not individual ideas. It is an experimental measure, not a proven forecast.</p>
    </div>
  </section>
}
