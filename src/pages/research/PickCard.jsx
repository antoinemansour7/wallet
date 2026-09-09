import { useId, useState } from 'react'
import CompanyLogo from '../../components/CompanyLogo'
import ChangedValue from '../../components/ChangedValue'

// ─── Labels ────────────────────────────────────────────────────────────────────

// The pipeline's setup names are trader shorthand. Each becomes a short phrase
// that says what the chart is doing, so the chip is readable without a glossary.
const SETUP_LABELS = {
  squeeze: 'Coiled tight', breakout: 'Breaking out', volume: 'Unusual volume',
  catalyst: 'Event coming', momentum: 'Trending up',
}

const TREND_LABELS = {
  uptrend: 'Rising', 'overbought-uptrend': 'Rising, looks stretched',
  recovery: 'Recovering', consolidating: 'Flat range', pullback: 'Pulling back',
  downtrend: 'Falling', 'oversold-downtrend': 'Falling, may be oversold',
  mixed: 'No clear direction',
}

// The raw source strings are internal identifiers. "exa-discovery" and
// "AVGO catalyst search" mean something to the pipeline and nothing to a reader.
function sourceLabel(source) {
  const s = String(source)
  if (s.startsWith('@')) return s
  if (s === 'finviz') return 'Stock screener'
  if (s === 'exa-discovery') return 'News coverage'
  if (s.endsWith('catalyst search')) return 'News search'
  if (s.endsWith('search')) return 'Web search'
  return s
}

const isHandle = (source) => String(source).startsWith('@')

// Number(null) is 0, and 0 is finite — so a plain isFinite check waved null stop
// and target values straight through and rendered a trade plan reading
// "STOP $0.00 / TARGET $0.00". Absent has to stay absent.
function num(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const CURRENCY = { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }

function money(value) {
  if (!Number.isFinite(value)) return null
  return value.toLocaleString('en-US', CURRENCY)
}

function ScoreMeter({ score, max = 10, tone = 'conviction' }) {
  const value = num(score)
  return <div className={`research-score research-score-${tone}`}>
    <span className="research-micro">{tone === 'risk' ? 'Risk' : 'Conviction'}</span>
    <span className="research-score-value">{value ?? '—'}<small> / {max}</small></span>
    {value != null && <span className="research-score-track" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, value / max * 100))}%` }} /></span>}
  </div>
}

function Section({ label, trailing, children, className = '' }) {
  return <section className={`research-detail ${className}`}>
    <div className="research-detail-heading"><h4>{label}</h4>{trailing}</div>
    {children}
  </section>
}

/** When the overnight run happened, said the way a person would say it. */
function runLabel(generatedAt) {
  const ms = Date.parse(String(generatedAt ?? ''))
  if (!Number.isFinite(ms)) return 'the last run'

  const hours = Math.floor((Date.now() - ms) / 3600000)
  if (hours < 1) return 'this run'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export default function PickCard({ pick, rank, defaultOpen = false, featured = false, live, generatedAt }) {
  const [open, setOpen] = useState(defaultOpen)
  const detailId = useId()
  const {
    ticker, conviction, reason, setupType, sources = [], themes = [],
    signalCount, technicals, bearCase, riskScore, quoteVerified,
    catalystVerified, catalystDetail, catalystTimeline, catalystPricedIn,
    price, stopLoss, target, technicalAgreement, disagreementNote,
    coverageAcceleration, coverageToday, coveragePriorAverage,
  } = pick

  // Say what changed in counts a reader can check, not "coverage accelerating".
  // Only worth a line when it actually moved: a steady or brand-new ticker has
  // nothing to report, and "new" in particular means there is no history to
  // compare against rather than that attention jumped.
  const coverageNote = (() => {
    if (!Number.isFinite(coverageToday) || !Number.isFinite(coveragePriorAverage)) return null
    const before = Math.round(coveragePriorAverage)
    // "New" is load-bearing: a post already counted on an earlier day is not
    // counted again, so these are genuinely per-day figures rather than two
    // overlapping trailing windows being differenced.
    if (coverageAcceleration === 'accelerating') {
      return `New mentions jumped to ${coverageToday} today, against about ${before} a day recently.`
    }
    if (coverageAcceleration === 'decelerating') {
      return `New mentions fell to ${coverageToday} today, against about ${before} a day recently.`
    }
    return null
  })()

  // The live quote wins where there is one. The stored figures were captured
  // when the pipeline ran and are what the ranking was built on — right for
  // scoring, wrong to show, because a card rendering them looked current while
  // being up to a day old. That is why every pick read 0.00%.
  const priceIsLive = num(live?.price) > 0
  const entry = priceIsLive ? num(live.price) : num(price) > 0 ? num(price) : null
  const change = priceIsLive ? num(live.changePercent) : null
  const stop = num(stopLoss)
  const tgt = num(target)
  const priceLabel = money(entry)
  // A plan needs all three legs at real levels — a zero stop is not a stop.
  const hasPlan = entry > 0 && stop > 0 && tgt > 0

  const hasTechnicals = technicals && ['trend', 'rsi', 'pctFrom52wHigh', 'relativeVolume'].some((key) => technicals[key] != null)
  const hasCatalyst = catalystVerified != null || catalystDetail || catalystTimeline || catalystPricedIn
  const independentSources = num(pick.sourceCount) ?? sources.length

  return (
    <article className={`research-idea ${featured ? 'research-idea-featured' : ''}`} aria-label={ticker} data-open={open}>
      {featured && <p className="research-leading-label"><span /> Leading idea <span className="research-leading-note">First in the research ranking</span></p>}
      <header className="research-idea-heading">
        <div className="research-identity">
          <span className="research-rank" aria-label={`Rank ${rank}`}>{String(rank).padStart(2, '0')}</span>
          <CompanyLogo symbol={ticker} size={40} />
          <div><h3>{ticker}</h3>{setupType && <span className="research-setup">{SETUP_LABELS[setupType] || setupType}</span>}</div>
        </div>
        <ChangedValue as="div" value={`${entry}:${change}`} className="research-price">
          <span className="research-micro">{priceIsLive ? 'Live price' : 'Run price'} · USD</span>
          <strong>{priceLabel || '—'}</strong>
          <span className={`research-change ${change > 0 ? 'research-positive' : change < 0 ? 'research-negative' : ''}`} aria-label={change == null ? 'Daily change unknown' : undefined}>
            {change == null ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`}<small>{change != null ? ' today' : ' change unavailable'}</small>
          </span>
        </ChangedValue>
        <ScoreMeter score={conviction} />
        <button type="button" className="research-expand" aria-expanded={open} aria-controls={detailId} aria-label={`${open ? 'Hide' : 'Read'} research for ${ticker}`} onClick={() => setOpen((value) => !value)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={open ? 'M5 12h14' : 'M5 12h14M12 5v14'} /></svg>
        </button>
      </header>
      {!open && <div className="research-idea-preview">
        {reason && <p>{reason}</p>}
        <div className="research-preview-sources">{sources.slice(0, 3).map((source, i) => <span key={`${source}-${i}`}>{sourceLabel(source)}</span>)}{sources.length > 3 && <span>+{sources.length - 3} more</span>}</div>
      </div>}
      {open && <div className="research-idea-body" id={detailId}>
        <Section label="Why this one" className="research-thesis"><p>{reason || 'A written thesis was not included in this run.'}</p></Section>
        <div className="research-evidence-grid">
          <div className="research-evidence-column">
            {hasCatalyst && <Section label="The catalyst">
              <p className="research-verification"><span aria-hidden="true">{catalystVerified ? '✓' : '○'}</span>{catalystVerified === true ? 'We confirmed this event' : catalystVerified === false ? "We couldn't confirm this event" : 'Verification not available'}</p>
              {catalystTimeline && <p className="research-catalyst-time">{catalystTimeline}</p>}
              {catalystDetail && <p>{catalystDetail}</p>}
              {catalystPricedIn && <p className="research-inline-note">Market likely expects it · May already be priced in</p>}
            </Section>}
            {hasTechnicals && <Section label="What the chart shows">
              <dl className="research-technical-list">
                {technicals.trend && <div><dt>Direction</dt><dd>{TREND_LABELS[technicals.trend] || technicals.trend}</dd></div>}
                {num(technicals.rsi) != null && <div><dt>RSI <span>{technicals.rsi}</span></dt><dd>{technicals.rsi >= 70 ? 'Possibly overbought' : technicals.rsi <= 30 ? 'Possibly oversold' : 'Neither overbought nor oversold'}</dd></div>}
                {num(technicals.pctFrom52wHigh) != null && <div><dt>12-month high</dt><dd>{Math.abs(technicals.pctFrom52wHigh)}% {technicals.pctFrom52wHigh > 0 ? 'above' : 'below'} the high</dd></div>}
                {num(technicals.relativeVolume) != null && <div><dt>Volume</dt><dd>{technicals.relativeVolume}× normal</dd></div>}
              </dl>
            </Section>}
            {coverageNote && <Section label="How much it is being talked about"><p>{coverageNote}</p></Section>}
          </div>
          <div className="research-risk-column">
            <Section label="What could go wrong" trailing={riskScore != null && <ScoreMeter score={riskScore} tone="risk" />}>
              <p>{bearCase || 'A bear case was not included in this run.'}</p>
            </Section>
            {technicalAgreement === 'conflict' && disagreementNote && <Section label="The chart disagrees" className="research-disagreement"><p>{disagreementNote}</p></Section>}
          </div>
        </div>
        {hasPlan && <Section label="Trade plan" className="research-plan-section">
          <dl className="research-plan">{[
            ['Buy near', money(entry), ''], ['Cut losses at', money(stop), 'research-negative'], ['Take profit at', money(tgt), 'research-positive'],
          ].map(([label, value, tone]) => <div key={label}><dt>{label}</dt><dd className={tone}>{value}</dd></div>)}</dl>
        </Section>}
        <footer className="research-idea-foot">
          <div className="research-evidence-count"><span>{independentSources} independent source{independentSources === 1 ? '' : 's'}</span>{signalCount != null && <span>{signalCount} mention{signalCount === 1 ? '' : 's'}</span>}</div>
          {sources.length > 0 && <ul className="research-source-tags" aria-label={`Sources for ${ticker}`}>{sources.map((source, i) => <li key={`${source}-${i}`} data-handle={isHandle(source)}>{sourceLabel(source)}</li>)}</ul>}
          {themes.length > 0 && <p>About: {themes.join(', ')}</p>}
          <p className="research-provenance">{priceIsLive ? 'Price live' : entry > 0 ? `Price from ${runLabel(generatedAt)}${quoteVerified ? '' : ' · Not verified'}` : 'Price unavailable'}{priceIsLive && live.at ? ` · Updated ${new Date(live.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</p>
        </footer>
      </div>}
    </article>
  )
}
