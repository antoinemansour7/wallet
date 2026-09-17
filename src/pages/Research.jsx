import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { loadLocalPortfolio } from '../utils/portfolioStorage'
import { IS_PREVIEW, PREVIEW_RESEARCH } from '../preview/mockMode'
import { flattenAccountRows } from '../utils/accountPortfolio'
import RegimeGauge from './research/RegimeGauge'
import PickCard from './research/PickCard'
import ResearchSources from './research/ResearchSources'
import '../components/landing/tokens.css'
import './Research.css'

// Picks below this are kept off the main list. They are still shown on request
// rather than hidden outright — the header used to read "2 picks" on a night the
// pipeline produced four, which looks like a thinner run than actually happened.
const CONVICTION_THRESHOLD = 6

function formatTime(dateStr) {
  if (!dateStr || !Number.isFinite(Date.parse(dateStr))) return null
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch {
    return null
  }
}

export default function Research() {
  const [research, setResearch] = useState(null)
  const [loadingResearch, setLoadingResearch] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showBelow, setShowBelow] = useState(false)
  const [horizon, setHorizon] = useState(5)
  const priceRequest = useRef(0)
  const sizingRequest = useRef(0)
  const [livePrices, setLivePrices] = useState({})
  const [sizing, setSizing] = useState(null)
  const [sizingLoading, setSizingLoading] = useState(false)
  const { user } = useAuth()

  async function loadResearch() {
    setLoadingResearch(true)
    setLoadError(false)
    // /api/get-research needs the nightly pipeline behind it. In preview the
    // page would otherwise sit on its empty state, which is the one view that
    // shows nothing about how the copy reads.
    if (IS_PREVIEW) { setResearch(PREVIEW_RESEARCH); setLoadingResearch(false); return }
    try {
      // Two routes as of #68 — market conditions used to be bundled into
      // get-research's response because there was nowhere else to put them.
      // Fetched together, same as they were computed together server-side
      // before the split; a failed regime fetch shouldn't cost the picks,
      // so it's caught on its own rather than failing the whole load.
      const [researchRes, regimeRes] = await Promise.all([
        fetch('/api/get-research'),
        fetch('/api/market-regime').catch(() => null),
      ])
      if (!researchRes.ok) throw new Error(`HTTP ${researchRes.status}`)
      const data = await researchRes.json()
      const regimeData = regimeRes?.ok ? await regimeRes.json().catch(() => null) : null
      const regime = regimeData?.regime ?? null
      setResearch({ ...data, regime })
    } catch (err) {
      console.error('[Research] failed to load research:', err.message)
      setLoadError(true)
    } finally {
      setLoadingResearch(false)
    }
  }

  /**
   * Prices for the picks, taken now rather than read back out of the payload.
   *
   * The pipeline captures a price and a day change when it runs and stores them
   * beside the pick. The page used to render those straight back, so a figure
   * could be a full day old and the change was whatever was true at the moment
   * the pipeline happened to ask — which is why every card showed 0.00% and a
   * price that never moved.
   *
   * The stored figures are kept, because the ranking is built on what was true
   * when the pick was made. They are just the wrong thing to show.
   */
  async function loadLivePrices(picksToPrice) {
    const request = ++priceRequest.current
    const symbols = [...new Set(picksToPrice.map((p) => p.ticker).filter(Boolean))]
    if (symbols.length === 0) return

    try {
      const res = await fetch('/api/live-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      })
      if (!res.ok) { if (request === priceRequest.current) setLivePrices({}); return }

      const data = await res.json()
      const at = new Date().toISOString()
      const next = {}
      for (const quote of data.quotes ?? []) {
        const symbol = quote.requestedSymbol ?? quote.symbol
        const price = Number(quote.price ?? quote.regularMarketPrice)
        if (!symbol || !Number.isFinite(price) || price <= 0 || quote.cacheStatus === 'stale') continue
        next[symbol] = {
          price,
          changePercent: quote.changePercent != null && quote.changePercent !== '' && Number.isFinite(Number(quote.changePercent)) ? Number(quote.changePercent) : null,
          at,
        }
      }
      if (request === priceRequest.current) setLivePrices(next)
    } catch {
      if (request === priceRequest.current) setLivePrices({})
      // A failed refresh leaves the stored figures showing, and the card says
      // when they were taken. Silence is fine; a wrong number is not.
    }
  }

  async function loadPositionSizing(picksToSize) {
    if (!user?.uid) return
    const request = ++sizingRequest.current
    setSizingLoading(true)
    try {
      const saved = loadLocalPortfolio(user.uid)
      if (!saved) { setSizing({ error: 'Upload your portfolio first' }); return }
      const portfolioRows = saved.rows?.length > 0 ? saved.rows : flattenAccountRows(saved.accounts)
      if (!portfolioRows.length) { setSizing({ error: 'No holdings found in portfolio' }); return }
      const res = await fetch('/api/position-sizing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picks: picksToSize, portfolioRows }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = await res.json()
      if (request === sizingRequest.current) setSizing(result)
    } catch (err) {
      console.error('[Research] position sizing failed:', err.message)
      if (request === sizingRequest.current) setSizing({ error: 'Failed to analyze positions' })
    } finally {
      if (request === sizingRequest.current) setSizingLoading(false)
    }
  }

  useEffect(() => { loadResearch() }, [])

  // Priced on arrival, then every five minutes, matching the portfolio.
  useEffect(() => {
    const all = research?.picksByHorizon?.[horizon] ?? (horizon === 5 ? research?.picks ?? [] : [])
    if (all.length === 0) return undefined

    loadLivePrices(all)
    const id = window.setInterval(() => loadLivePrices(all), 5 * 60 * 1000)
    // Retiring the sequence on teardown matters when the next horizon has no
    // picks: the effect returns early without issuing a request, so nothing
    // else would invalidate a reply still in flight for the previous one.
    const sequence = priceRequest
    return () => { window.clearInterval(id); sequence.current++ }
  }, [research, horizon])

  const { picks, below } = useMemo(() => {
    // The server order includes technicals, verified events, risk and premarket checks.
    const all = research?.picksByHorizon?.[horizon] ?? (horizon === 5 ? research?.picks ?? [] : [])
    // Disclosure review has its own acceptance policy and 0–100 priority score.
    // The attention strategy's conviction gate must not hide accepted filings.
    if (horizon !== 5) return { picks: all, below: [] }
    return {
      picks: all.filter((p) => p.conviction >= CONVICTION_THRESHOLD),
      below: all.filter((p) => !(p.conviction >= CONVICTION_THRESHOLD)),
    }
  }, [research, horizon])

  const timeLabel = formatTime(research?.generatedAt)
  const hasAnything = picks.length + below.length > 0

  const allPicks = research?.picksByHorizon?.[horizon] ?? (horizon === 5 ? research?.picks ?? [] : [])
  const rankFor = (pick) => allPicks.indexOf(pick) + 1
  const hasRun = Boolean(research?.generatedAt)

  function selectHorizon(value) {
    priceRequest.current++
    sizingRequest.current++
    setHorizon(value)
    setShowBelow(false)
    setLivePrices({})
    setSizing(null)
    setSizingLoading(false)
  }

  return (
    <div className="wallai-system research-workspace">
      <header className="research-briefing">
        <div className="research-container">
          <div className="research-briefing-meta"><p className="research-eyebrow"><span /> Research</p><span className="research-run-date">{loadingResearch ? 'Opening your briefing…' : timeLabel ? <><span className="research-status-dot" />Last run · <time dateTime={research.generatedAt}>{timeLabel}</time></> : loadError ? 'Briefing unavailable' : 'Awaiting first run'}</span></div>
          <div className="research-briefing-heading"><div><h1>Your research briefing.</h1><p>{loadingResearch ? 'Bringing the ideas and evidence together.' : loadError ? 'Your latest research could not be loaded.' : picks.length ? `${picks.length} idea${picks.length === 1 ? '' : 's'} worth a closer look.` : hasRun ? 'A completed scan. A selective shortlist.' : 'A closer look at what’s moving the market.'}</p></div></div>
        </div>
      </header>

      <div className="research-container">
        <div className="research-layout">
          <section id="research-ideas" className="research-ideas" aria-label="Research ideas" aria-busy={loadingResearch}>
            {research?.picksByHorizon && <div className="research-horizons">
              <div role="group" aria-label="Research horizon">{[[5, 'Follow-through'], [20, 'Repricing'], [60, 'Business change']].map(([value, label]) =>
                <button key={value} type="button" aria-pressed={horizon === value} onClick={() => selectHorizon(value)}><strong>{value} sessions</strong><span>{label}</span></button>,
              )}</div>
              <p>{horizon === 5 ? 'Market attention and near-term catalysts.' : `Primary disclosures, reviewed over ${horizon} trading sessions. Experimental ideas ranked only within this horizon.`}</p>
            </div>}
            {loadingResearch ? <div role="status" className="research-loading"><span className="sr-only">Loading research</span>{[0, 1, 2].map((index) => <div key={index} className="research-skeleton" aria-hidden="true"><span /><span /><span /></div>)}</div>
              : loadError ? <div className="research-empty" role="alert"><span aria-hidden="true">↻</span><h2>We couldn’t load your briefing.</h2><p>Try again to reconnect to the latest research.</p><button type="button" className="research-primary-button" onClick={loadResearch}>Try again</button></div>
              : !hasAnything ? <div className="research-empty"><span aria-hidden="true">✳</span><h2>{hasRun ? 'No qualifying ideas this run' : 'No picks yet'}</h2><p>{hasRun ? 'The research criteria did not produce a recommendation.' : 'New research appears after the next scheduled market scan.'}</p>{hasRun && <p className="research-muted">The scan is complete. There’s no need to force an idea.</p>}</div>
              : <>
                {picks.map((pick, index) => <PickCard key={`${horizon}:${pick.candidateId || pick.ticker}`} pick={pick} rank={rankFor(pick)} featured={index === 0} live={livePrices[pick.ticker]} generatedAt={pick.generatedAt || research?.generatedAt} />)}
                {picks.length === 0 && <div className="research-empty"><span aria-hidden="true">○</span><h2>Nothing looked strong enough tonight</h2><p>{below.length} weaker idea{below.length === 1 ? '' : 's'} below, if you want to look anyway.</p></div>}
                {below.length > 0 && <div className="research-below">
                  <div><p className="research-eyebrow">Below the conviction threshold</p><p>Below {CONVICTION_THRESHOLD}/10 or not scored. Kept here for a fuller view of the run.</p></div>
                  <button type="button" className="research-text-button" onClick={() => setShowBelow((value) => !value)} aria-expanded={showBelow} aria-controls="research-below-list">{showBelow ? 'Hide the weaker ideas' : `Show ${below.length} weaker idea${below.length === 1 ? '' : 's'}`}<span aria-hidden="true">{showBelow ? '−' : '+'}</span></button>
                  {showBelow && <div id="research-below-list">{below.map((pick) => <PickCard key={`${horizon}:${pick.candidateId || pick.ticker}`} pick={pick} rank={rankFor(pick)} live={livePrices[pick.ticker]} generatedAt={pick.generatedAt || research?.generatedAt} />)}</div>}
                </div>}
              </>}
          </section>

          <aside className="research-context" aria-label="Research context">
            <div id="research-market">{!loadingResearch && <RegimeGauge regime={research?.regime} />}</div>
            {!loadingResearch && !loadError && <ResearchSources research={research} ideaCount={allPicks.length} belowCount={below.length} />}
            {!loadingResearch && picks.length > 0 && user && <section className="research-sizing" aria-labelledby="research-sizing-title">
              <h2 id="research-sizing-title">How would these fit?</h2><p>Consider existing holdings, overlap and concentration before adding a position.</p>
              {(!sizing || sizing.error) && <button type="button" onClick={() => loadPositionSizing(picks)} disabled={sizingLoading} className="research-primary-button">{sizingLoading ? 'Analyzing…' : sizing?.error ? 'Try sizing again' : 'Size against my portfolio'}<span aria-hidden="true">↗</span></button>}
              {sizingLoading && <span role="status" className="sr-only">Analyzing your portfolio</span>}
              {sizing?.error && <p role="alert" className="research-negative">{sizing.error}</p>}
              {sizing?.picks?.length > 0 && <div className="research-allocation" aria-live="polite"><p className="research-eyebrow">Suggested allocation</p><p className="research-allocation-total">${sizing.totalSuggestedAllocation?.toLocaleString()} <span>· {sizing.allocationPct}%</span></p>{sizing.picks.map((suggestion) => <div className="research-allocation-pick" key={suggestion.ticker}><div><h3>{suggestion.ticker}</h3><span>{suggestion.suggestedPct}% · ${suggestion.suggestedAmount?.toLocaleString()}</span></div><p>{suggestion.reasoning}</p>{suggestion.overlap && <p>Existing overlap · {suggestion.overlap}</p>}{suggestion.warning && <p className="research-negative">{suggestion.warning}</p>}</div>)}</div>}
            </section>}

          </aside>
        </div>
        <footer className="research-page-foot"><span>WallAI / Research</span><span>Live prices refresh approximately every five minutes.</span></footer>
      </div>
    </div>
  )
}
