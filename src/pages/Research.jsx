import { useEffect, useMemo, useState } from 'react'
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
    const symbols = [...new Set(picksToPrice.map((p) => p.ticker).filter(Boolean))]
    if (symbols.length === 0) return

    try {
      const res = await fetch('/api/live-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      })
      if (!res.ok) { setLivePrices({}); return }

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
      setLivePrices(next)
    } catch {
      setLivePrices({})
      // A failed refresh leaves the stored figures showing, and the card says
      // when they were taken. Silence is fine; a wrong number is not.
    }
  }

  async function loadPositionSizing(picksToSize) {
    if (!user?.uid) return
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
      setSizing(await res.json())
    } catch (err) {
      console.error('[Research] position sizing failed:', err.message)
      setSizing({ error: 'Failed to analyze positions' })
    } finally {
      setSizingLoading(false)
    }
  }

  useEffect(() => { loadResearch() }, [])

  // Priced on arrival, then every five minutes, matching the portfolio.
  useEffect(() => {
    const all = research?.picks ?? []
    if (all.length === 0) return undefined

    loadLivePrices(all)
    const id = window.setInterval(() => loadLivePrices(all), 5 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [research])

  const { picks, below } = useMemo(() => {
    // The server order includes technicals, verified events, risk and premarket checks.
    const all = research?.picks ?? []
    return {
      picks: all.filter((p) => p.conviction >= CONVICTION_THRESHOLD),
      below: all.filter((p) => !(p.conviction >= CONVICTION_THRESHOLD)),
    }
  }, [research])

  const signalCount = research?.signalCount ?? research?.tweetCount ?? 0
  const timeLabel = formatTime(research?.generatedAt)
  const hasAnything = picks.length + below.length > 0

  const allPicks = research?.picks ?? []
  const rankFor = (pick) => allPicks.indexOf(pick) + 1
  const hasRun = Boolean(research?.generatedAt)

  return (
    <div className="wallai-system research-workspace">
      <header className="research-briefing">
        <div className="research-container">
          <div className="research-briefing-meta"><p className="research-eyebrow"><span /> Research / Latest briefing</p><span className="research-run-date">{loadingResearch ? 'Opening your briefing…' : timeLabel ? <><span className="research-status-dot" />Last run · <time dateTime={research.generatedAt}>{timeLabel}</time></> : loadError ? 'Briefing unavailable' : 'Awaiting first run'}</span></div>
          <div className="research-briefing-heading"><div><h1>Your research briefing.</h1><p>{loadingResearch ? 'Bringing the ideas and evidence together.' : loadError ? 'Your latest research could not be loaded.' : picks.length ? `${picks.length} idea${picks.length === 1 ? '' : 's'} worth a closer look.` : hasRun ? 'A completed scan. A selective shortlist.' : 'A closer look at what’s moving the market.'}</p></div><a href="#research-ideas" className="research-briefing-link">Explore the ideas <span aria-hidden="true">↓</span></a></div>
          <dl className="research-run-stats">
            <div><dt>Ideas found</dt><dd>{loadingResearch || loadError ? '—' : allPicks.length}<small>{!loadingResearch && !loadError && below.length > 0 ? `${below.length} below threshold` : 'In this run'}</small></dd></div>
            <div><dt>Signals reviewed</dt><dd>{loadingResearch || loadError ? '—' : signalCount.toLocaleString()}<small>Posts & stock screens</small></dd></div>
            <div><dt>News articles</dt><dd>{loadingResearch || loadError || !Array.isArray(research?.articles) ? '—' : research.articles.length.toLocaleString()}<small>Read for context</small></dd></div>
          </dl>
        </div>
      </header>

      <div className="research-container">
        <nav className="research-contents" aria-label="In this briefing"><span>In this briefing</span><a href="#research-ideas">01 <span>The ideas</span></a><a href="#research-market">02 <span>The backdrop</span></a><a href="#research-sources">03 <span>The sources</span></a></nav>
        <div className="research-layout">
          <section id="research-ideas" className="research-ideas" aria-labelledby="research-ideas-title" aria-busy={loadingResearch}>
            <div className="research-section-heading"><div><p className="research-eyebrow">01 / The shortlist</p><h2 id="research-ideas-title">Worth your attention.</h2></div><span className="research-order-note">In research ranking order</span></div>
            {loadingResearch ? <div role="status" className="research-loading"><span className="sr-only">Loading research</span>{[0, 1, 2].map((index) => <div key={index} className="research-skeleton" aria-hidden="true"><span /><span /><span /></div>)}</div>
              : loadError ? <div className="research-empty" role="alert"><span aria-hidden="true">↻</span><h3>We couldn’t load your briefing.</h3><p>Try again to reconnect to the latest research.</p><button type="button" className="research-primary-button" onClick={loadResearch}>Try again</button></div>
              : !hasAnything ? <div className="research-empty"><span aria-hidden="true">✳</span><h3>{hasRun ? 'No qualifying ideas this run' : 'No picks yet'}</h3><p>{hasRun ? 'The research criteria did not produce a recommendation.' : 'New research appears after the next scheduled market scan.'}</p>{hasRun && <p className="research-muted">The scan is complete. There’s no need to force an idea.</p>}</div>
              : <>
                {picks.map((pick, index) => <PickCard key={pick.ticker} pick={pick} rank={rankFor(pick)} featured={index === 0} defaultOpen={index === 0} live={livePrices[pick.ticker]} generatedAt={research?.generatedAt} />)}
                {picks.length === 0 && <div className="research-empty"><span aria-hidden="true">○</span><h3>Nothing looked strong enough tonight</h3><p>{below.length} weaker idea{below.length === 1 ? '' : 's'} below, if you want to look anyway.</p></div>}
                {below.length > 0 && <div className="research-below">
                  <div><p className="research-eyebrow">Below the conviction threshold</p><p>Below {CONVICTION_THRESHOLD}/10 or not scored. Kept here for a fuller view of the run.</p></div>
                  <button type="button" className="research-text-button" onClick={() => setShowBelow((value) => !value)} aria-expanded={showBelow} aria-controls="research-below-list">{showBelow ? 'Hide the weaker ideas' : `Show ${below.length} weaker idea${below.length === 1 ? '' : 's'}`}<span aria-hidden="true">{showBelow ? '−' : '+'}</span></button>
                  {showBelow && <div id="research-below-list">{below.map((pick) => <PickCard key={pick.ticker} pick={pick} rank={rankFor(pick)} live={livePrices[pick.ticker]} generatedAt={research?.generatedAt} />)}</div>}
                </div>}
              </>}
          </section>

          <aside className="research-context" aria-label="Research context">
            <div id="research-market">{!loadingResearch && <RegimeGauge regime={research?.regime} />}</div>
            {!loadingResearch && picks.length > 0 && user && <section className="research-sizing" aria-labelledby="research-sizing-title">
              <span className="research-sizing-symbol" aria-hidden="true">↔</span><p className="research-eyebrow">Your portfolio, in context</p><h2 id="research-sizing-title">How would these fit?</h2><p>Consider existing holdings, overlap and concentration before adding a position.</p>
              {(!sizing || sizing.error) && <button type="button" onClick={() => loadPositionSizing(picks)} disabled={sizingLoading} className="research-primary-button">{sizingLoading ? 'Analyzing…' : sizing?.error ? 'Try sizing again' : 'Size against my portfolio'}<span aria-hidden="true">↗</span></button>}
              {sizingLoading && <span role="status" className="sr-only">Analyzing your portfolio</span>}
              {sizing?.error && <p role="alert" className="research-negative">{sizing.error}</p>}
              {sizing?.picks?.length > 0 && <div className="research-allocation" aria-live="polite"><p className="research-eyebrow">Suggested allocation</p><p className="research-allocation-total">${sizing.totalSuggestedAllocation?.toLocaleString()} <span>· {sizing.allocationPct}%</span></p>{sizing.picks.map((suggestion) => <div className="research-allocation-pick" key={suggestion.ticker}><div><h3>{suggestion.ticker}</h3><span>{suggestion.suggestedPct}% · ${suggestion.suggestedAmount?.toLocaleString()}</span></div><p>{suggestion.reasoning}</p>{suggestion.overlap && <p>Existing overlap · {suggestion.overlap}</p>}{suggestion.warning && <p className="research-negative">{suggestion.warning}</p>}</div>)}</div>}
            </section>}
            {!loadingResearch && hasRun && <div className="research-reading-note"><span aria-hidden="true">↗</span><p>Read the case.<br /><strong>Then challenge it.</strong></p><span>Every idea includes the reasoning and the risks reported by the research run.</span></div>}
          </aside>
        </div>
        {!loadingResearch && !loadError && <ResearchSources research={research} />}
        <footer className="research-page-foot"><span>WallAI / Research</span><span>Live prices refresh approximately every five minutes.</span></footer>
      </div>
    </div>
  )
}
