import { useEffect, useRef, useState } from 'react'

// ─── Constants ─────────────────────────────────────────────────────────────────

const MARKET_SYMBOLS = ['^GSPC', '^IXIC', '^DJI', '^VIX', '^TNX', 'BTC-USD']

const MARKET_LABELS = {
  '^GSPC': 'S&P 500',
  '^IXIC': 'NASDAQ',
  '^DJI':  'DOW',
  '^VIX':  'VIX',
  '^TNX':  '10Y Yield',
  'BTC-USD': 'BTC/USD',
}

const TAG_COLORS = {
  Earnings: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  Macro:    'text-purple-400 bg-purple-400/10 border-purple-400/20',
  AI:       'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  Crypto:   'text-orange-400 bg-orange-400/10 border-orange-400/20',
  Markets:  'text-amber-400 bg-amber-400/10 border-amber-400/20',
}

const AUTO_REFRESH_MS = 5 * 60 * 1000

// ─── Helpers ───────────────────────────────────────────────────────────────────

function deriveTag(title = '') {
  const t = title.toLowerCase()
  if (/earn|revenue|eps|profit|beat|miss|q[1-4]/.test(t))   return 'Earnings'
  if (/fed|rate|inflation|cpi|gdp|yield|recession/.test(t))  return 'Macro'
  if (/ai|artificial|gpt|nvidia|llm|model/.test(t))          return 'AI'
  if (/bitcoin|crypto|eth|btc|solana|blockchain/.test(t))    return 'Crypto'
  return 'Markets'
}

function formatRelative(dateStr) {
  if (!dateStr) return ''
  try {
    const diff = Date.now() - new Date(dateStr).getTime()
    const hours = Math.floor(diff / 3600000)
    if (hours < 1) return 'Just now'
    if (hours < 24) return `${hours}h ago`
    if (hours < 48) return 'Yesterday'
    return `${Math.floor(hours / 24)}d ago`
  } catch {
    return ''
  }
}

function formatGeneratedAt(dateStr) {
  if (!dateStr) return null
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    })
  } catch {
    return null
  }
}

function fmtPrice(val) {
  if (val == null) return '—'
  return Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(val) {
  if (val == null) return '—'
  const n = Number(val)
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function convictionColor(score) {
  if (score >= 8) return 'text-gain'
  if (score >= 6) return 'text-amber-400'
  return 'text-slate-400'
}

function convictionBarColor(score) {
  if (score >= 8) return 'bg-gain'
  if (score >= 6) return 'bg-amber-500'
  return 'bg-slate-500'
}

// Pull "Overall Buy Score: 8/10" out of the Perplexity markdown
function parseBuyScore(report) {
  if (!report) return null
  const m = report.match(/overall buy score[^\d]*(\d+)\s*\/\s*10/i)
  return m ? Number(m[1]) : null
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function PickCard({ pick, expanded, onToggle }) {
  const { ticker, conviction, reason, report, citations, error } = pick
  const buyScore = parseBuyScore(report)
  // Show buy score if available, otherwise fall back to Groq conviction
  const displayScore = buyScore ?? conviction
  const barWidth = `${(displayScore / 10) * 100}%`

  return (
    <div className="bg-wall-surface border border-white/[0.06] rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center gap-4 hover:bg-white/[0.02] transition-colors text-left"
      >
        {/* Ticker badge */}
        <span className="shrink-0 text-slate-100 font-semibold text-sm font-mono bg-white/[0.06] px-2.5 py-1 rounded-lg min-w-[4rem] text-center">
          {ticker}
        </span>

        {/* Buy Score */}
        <div className="shrink-0 w-28">
          <div className="flex items-center justify-between mb-1">
            <span className="text-slate-500 text-[10px]">{buyScore != null ? 'Buy Score' : 'Signal'}</span>
            <span className={`text-[11px] font-semibold font-mono ${convictionColor(displayScore)}`}>
              {displayScore}/10
            </span>
          </div>
          <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${convictionBarColor(displayScore)}`}
              style={{ width: barWidth }}
            />
          </div>
        </div>

        {/* Reason */}
        <p className="flex-1 text-slate-400 text-sm truncate">{reason}</p>

        {/* Toggle button */}
        <span className="shrink-0 text-slate-600 text-xs border border-white/[0.08] px-2.5 py-1 rounded-lg hover:border-white/[0.15] transition-colors">
          {expanded ? 'Collapse' : 'Full Report'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] px-5 py-4">
          {error ? (
            <p className="text-loss text-sm">Report generation failed: {error}</p>
          ) : report ? (
            <>
              <div className="prose-sm text-slate-300 whitespace-pre-wrap leading-relaxed text-[13px]">
                {report}
              </div>
              {citations && citations.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/[0.06]">
                  <p className="text-slate-500 text-xs font-medium mb-2">Sources</p>
                  <ul className="space-y-1">
                    {citations.map((url, i) => (
                      <li key={i}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-500 hover:text-slate-300 text-xs truncate block transition-colors"
                        >
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="text-slate-500 text-sm">No report available.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Research() {
  const [research, setResearch]           = useState(null)
  const [marketQuotes, setMarketQuotes]   = useState({})
  const [loadingResearch, setLoadingResearch] = useState(true)
  const [loadingMarket, setLoadingMarket]     = useState(true)
  const [expandedPick, setExpandedPick]       = useState(null)
  const marketTimerRef = useRef(null)

  async function loadResearch() {
    try {
      const res = await fetch('/api/get-research')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setResearch(data)
    } catch (err) {
      console.error('[Research] failed to load research:', err.message)
      setResearch({ empty: true, picks: [], articles: [], signalCount: 0, queryCount: 0, generatedAt: null })
    } finally {
      setLoadingResearch(false)
    }
  }

  async function loadMarket() {
    setLoadingMarket(true)
    try {
      const res = await fetch('/api/live-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: MARKET_SYMBOLS }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const map = {}
      for (const q of data.quotes ?? []) {
        const sym = q.requestedSymbol ?? q.symbol
        if (sym) map[sym] = q
      }
      setMarketQuotes(map)
    } catch (err) {
      console.error('[Research] failed to load market quotes:', err.message)
    } finally {
      setLoadingMarket(false)
    }
  }

  useEffect(() => {
    loadResearch()
    loadMarket()

    marketTimerRef.current = setInterval(loadMarket, AUTO_REFRESH_MS)
    return () => clearInterval(marketTimerRef.current)
  }, [])

  const picks    = research?.picks    ?? []
  const articles = research?.articles ?? []
  const signalCount = research?.signalCount ?? research?.tweetCount ?? 0
  const generatedAtLabel = formatGeneratedAt(research?.generatedAt)

  return (
    <div className="min-h-screen bg-wall-bg">
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-slate-100 mb-1">Research</h1>
            <p className="text-slate-500 text-sm">
              AI-curated picks, live market data, and finance news.
            </p>
          </div>
          {generatedAtLabel ? (
            <span className="flex items-center gap-1.5 text-xs text-gain bg-gain/10 border border-gain/20 px-2.5 py-1 rounded-full mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-gain" />
              Updated {generatedAtLabel}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2.5 py-1 rounded-full mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-slow" />
              Runs at 3 AM UTC
            </span>
          )}
        </div>

        {/* Market snapshot bar */}
        <div className="bg-wall-surface border border-white/[0.06] rounded-xl px-5 py-3.5 mb-8 flex flex-wrap gap-x-8 gap-y-2">
          {MARKET_SYMBOLS.map((sym) => {
            const q = marketQuotes[sym]
            const chg = q?.changePercent ?? q?.regularMarketChangePercent
            const isPos = chg != null && Number(chg) >= 0
            const isNeg = chg != null && Number(chg) < 0
            return (
              <div key={sym} className="flex items-center gap-2">
                <span className="text-slate-600 text-xs">{MARKET_LABELS[sym]}</span>
                {loadingMarket && !q ? (
                  <span className="text-slate-700 text-xs font-mono tabular">—</span>
                ) : (
                  <>
                    <span className="text-slate-300 text-xs font-mono tabular">
                      {fmtPrice(q?.price ?? q?.regularMarketPrice)}
                    </span>
                    <span className={`text-xs font-mono tabular ${isPos ? 'text-gain' : isNeg ? 'text-loss' : 'text-slate-500'}`}>
                      {fmtPct(chg)}
                    </span>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* AI Picks section */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <SparkleIcon />
            <h2 className="text-slate-300 text-sm font-medium">Nightly Picks</h2>
            <span className="text-slate-600 text-xs ml-1">— AI-curated from X-first discovery, with Yahoo RSS as secondary context</span>
            {signalCount > 0 && (
              <span className="text-slate-700 text-[10px] bg-white/[0.04] px-1.5 py-0.5 rounded ml-auto">
                {signalCount} X signals analyzed
              </span>
            )}
          </div>

          {loadingResearch ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-wall-surface border border-white/[0.06] rounded-xl h-16 animate-pulse" />
              ))}
            </div>
          ) : picks.length === 0 ? (
            <div className="bg-wall-surface border border-white/[0.06] rounded-xl px-5 py-8 text-center">
              <p className="text-slate-500 text-sm">No picks available yet.</p>
              <p className="text-slate-700 text-xs mt-1">The pipeline runs nightly at 3 AM UTC.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {picks.map((pick) => (
                <PickCard
                  key={pick.ticker}
                  pick={pick}
                  expanded={expandedPick === pick.ticker}
                  onToggle={() => setExpandedPick(expandedPick === pick.ticker ? null : pick.ticker)}
                />
              ))}
            </div>
          )}
        </section>

        {/* News feed */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <NewsIcon />
            <h2 className="text-slate-300 text-sm font-medium">Latest News</h2>
            <span className="text-slate-600 text-xs ml-1">— Yahoo Finance RSS</span>
          </div>

          {loadingResearch ? (
            <div className="bg-wall-surface border border-white/[0.06] rounded-xl divide-y divide-white/[0.04] overflow-hidden">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="px-5 py-4 h-16 animate-pulse" />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="bg-wall-surface border border-white/[0.06] rounded-xl px-5 py-8 text-center">
              <p className="text-slate-500 text-sm">No news articles yet.</p>
            </div>
          ) : (
            <div className="bg-wall-surface border border-white/[0.06] rounded-xl divide-y divide-white/[0.04] overflow-hidden">
              {articles.slice(0, 20).map((article, i) => {
                const tag = deriveTag(article.title)
                const tagClass = TAG_COLORS[tag] ?? 'text-slate-400 bg-slate-400/10 border-slate-400/20'
                const timeLabel = formatRelative(article.pubDate)
                return (
                  <a
                    key={i}
                    href={article.link || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-5 py-4 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-200 text-sm font-medium leading-snug mb-1.5">
                          {article.title}
                        </p>
                        {article.description && (
                          <p className="text-slate-500 text-xs leading-snug mb-1.5 line-clamp-2">
                            {article.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2.5">
                          <span className="text-slate-600 text-xs">{article.source}</span>
                          {timeLabel && (
                            <>
                              <span className="w-1 h-1 rounded-full bg-slate-700" />
                              <span className="text-slate-600 text-xs">{timeLabel}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border ${tagClass}`}>
                        {tag}
                      </span>
                    </div>
                  </a>
                )
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
      <path d="M12 3l1.88 5.76a1 1 0 0 0 .95.69h6.07l-4.91 3.57a1 1 0 0 0-.36 1.12L17.41 20 12 16.43 6.59 20l1.88-5.86a1 1 0 0 0-.36-1.12L3.1 9.45h6.07a1 1 0 0 0 .95-.69L12 3z" />
    </svg>
  )
}

function NewsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8" />
      <path d="M15 18h-5" />
      <path d="M10 6h8v4h-8V6Z" />
    </svg>
  )
}
