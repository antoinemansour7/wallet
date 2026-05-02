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
  return 'text-white/40'
}

function convictionBarColor(score) {
  if (score >= 8) return 'bg-gain'
  if (score >= 6) return 'bg-amber-500'
  return 'bg-white/20'
}

function convictionBadgeBg(score) {
  if (score >= 8) return 'border-gain/20 bg-gain/10 text-gain'
  if (score >= 6) return 'border-amber-400/20 bg-amber-400/10 text-amber-400'
  return 'border-white/10 bg-white/[0.06] text-white/40'
}

function parseBuyScore(report) {
  if (!report) return null
  const m = report.match(/overall buy score[^\d]*(\d+)\s*\/\s*10/i)
  return m ? Number(m[1]) : null
}

function decodeEntities(text) {
  if (!text) return text
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}

function domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function RenderMarkdown({ text }) {
  if (!text) return null

  const lines = text.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Table detection
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const tableLines = []
      let j = i
      while (j < lines.length && lines[j].includes('|')) {
        tableLines.push(lines[j])
        j++
      }
      elements.push(<MarkdownTable key={i} lines={tableLines} />)
      i = j
      continue
    }

    // Heading
    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^(#+)/)[1].length
      const content = line.replace(/^#+\s*/, '').replace(/\*\*/g, '')
      const cls = level === 1
        ? 'text-base font-bold text-white mt-6 mb-2'
        : level === 2
        ? 'text-sm font-bold text-white mt-5 mb-2'
        : 'text-sm font-semibold text-white/80 mt-4 mb-1.5'
      elements.push(<p key={i} className={cls}>{content}</p>)
      i++
      continue
    }

    // Bullet
    if (/^\s*[-*]\s/.test(line)) {
      const bullets = []
      let j = i
      while (j < lines.length && /^\s*[-*]\s/.test(lines[j])) {
        bullets.push(lines[j].replace(/^\s*[-*]\s+/, ''))
        j++
      }
      elements.push(
        <ul key={i} className="space-y-1.5 my-2 ml-1">
          {bullets.map((b, bi) => (
            <li key={bi} className="flex gap-2 text-[13px] leading-relaxed text-white/60">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/20" />
              <span><InlineMarkdown text={b} /></span>
            </li>
          ))}
        </ul>
      )
      i = j
      continue
    }

    // Empty line
    if (!line.trim()) {
      i++
      continue
    }

    // Paragraph
    elements.push(
      <p key={i} className="text-[13px] leading-relaxed text-white/60 my-1.5">
        <InlineMarkdown text={line} />
      </p>
    )
    i++
  }

  return <div>{elements}</div>
}

function InlineMarkdown({ text }) {
  // Process **bold**, [links](url)
  const parts = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    // Link
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/)

    const boldIdx = boldMatch ? remaining.indexOf(boldMatch[0]) : Infinity
    const linkIdx = linkMatch ? remaining.indexOf(linkMatch[0]) : Infinity

    if (boldIdx === Infinity && linkIdx === Infinity) {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }

    if (boldIdx <= linkIdx && boldMatch) {
      if (boldIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, boldIdx)}</span>)
      parts.push(<strong key={key++} className="font-semibold text-white">{boldMatch[1]}</strong>)
      remaining = remaining.slice(boldIdx + boldMatch[0].length)
    } else if (linkMatch) {
      if (linkIdx > 0) parts.push(<span key={key++}>{remaining.slice(0, linkIdx)}</span>)
      parts.push(
        <a key={key++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-gain hover:underline underline-offset-2">
          {linkMatch[1]}
        </a>
      )
      remaining = remaining.slice(linkIdx + linkMatch[0].length)
    }
  }

  return <>{parts}</>
}

function MarkdownTable({ lines }) {
  const parseRow = (line) => line.split('|').map((c) => c.trim()).filter(Boolean)
  const headers = parseRow(lines[0])
  const rows = lines.slice(2).map(parseRow)

  return (
    <div className="my-4 overflow-x-auto rounded-lg border border-white/[0.06]">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-white/[0.06] bg-white/[0.03]">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-semibold text-white/60">{h.replace(/\*\*/g, '')}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-white/[0.02] transition-colors">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-white/40 font-mono tabular">{cell.replace(/\*\*/g, '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function MarketCard({ symbol, quote, loading }) {
  const label = MARKET_LABELS[symbol]
  const chg = quote?.changePercent ?? quote?.regularMarketChangePercent
  const price = quote?.price ?? quote?.regularMarketPrice
  const isPos = chg != null && Number(chg) >= 0

  return (
    <div className="rounded-card border border-white/[0.06] bg-wall-surface p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{label}</p>
      {loading && !quote ? (
        <div className="mt-2 h-5 w-16 animate-pulse rounded bg-white/[0.06]" />
      ) : (
        <>
          <p className="mt-1.5 font-mono text-sm font-semibold tabular text-white">{fmtPrice(price)}</p>
          <p className={`mt-0.5 font-mono text-xs tabular ${isPos ? 'text-gain' : 'text-loss'}`}>
            {fmtPct(chg)}
          </p>
        </>
      )}
    </div>
  )
}

function PickCard({ pick, expanded, onToggle }) {
  const { ticker, conviction, reason, report, citations, error } = pick
  const buyScore = parseBuyScore(report)
  const displayScore = buyScore ?? conviction
  const barWidth = `${(displayScore / 10) * 100}%`

  // Extract highlights from report
  const highlights = []
  if (report) {
    const hlMatch = report.match(/## Highlights:?\s*\n([\s\S]*?)(?=\n##|\n$|$)/i)
    if (hlMatch) {
      const hlLines = hlMatch[1].split('\n').filter((l) => l.trim().startsWith('-'))
      for (const line of hlLines) {
        const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/)
        if (linkMatch) {
          const dateMatch = line.match(/Published on (.+)$/)
          highlights.push({ title: linkMatch[1], url: linkMatch[2], date: dateMatch?.[1] ?? '' })
        }
      }
    }
  }

  // Strip highlights section from the report body
  const reportBody = report?.replace(/## Highlights:?\s*\n[\s\S]*$/i, '').trim()

  return (
    <div className="overflow-hidden rounded-card border border-white/[0.06] bg-wall-surface transition-all duration-200 hover:border-white/[0.12]">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-base font-bold text-white">
          {ticker?.[0] ?? '?'}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-white">{ticker}</span>
            <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${convictionBadgeBg(displayScore)}`}>
              {displayScore}/10
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-white/40">{reason}</p>
        </div>

        <span className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-medium text-white/40 transition-colors hover:border-white/20 hover:text-white/60">
          {expanded ? 'Collapse' : 'Full Report'}
        </span>
      </button>

      {/* Conviction bar */}
      <div className="px-5 pb-4">
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full rounded-full transition-all duration-700 ${convictionBarColor(displayScore)}`}
            style={{ width: barWidth }}
          />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.06] px-5 py-5">
          {error ? (
            <p className="text-sm text-loss">Report generation failed: {error}</p>
          ) : report ? (
            <>
              <RenderMarkdown text={reportBody} />

              {highlights.length > 0 && (
                <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">Highlights</p>
                  <div className="space-y-2">
                    {highlights.map((h, i) => (
                      <a
                        key={i}
                        href={h.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-2.5 rounded-lg p-2 transition-colors hover:bg-white/[0.04]"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-gain">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium leading-snug text-white/60">{decodeEntities(h.title)}</p>
                          {h.date && <p className="mt-0.5 text-[11px] text-white/20">{h.date}</p>}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {citations && citations.length > 0 && (
                <div className="mt-4 border-t border-white/[0.06] pt-4">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white/30">Sources</p>
                  <div className="flex flex-wrap gap-1.5">
                    {citations.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/30 transition-colors hover:border-white/10 hover:text-white/50"
                      >
                        {domainFromUrl(url)}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-white/40">No report available.</p>
          )}
        </div>
      )}
    </div>
  )
}

function NewsCard({ article }) {
  const tag = deriveTag(article.title)
  const tagClass = TAG_COLORS[tag] ?? 'text-white/40 bg-white/[0.06] border-white/10'
  const timeLabel = formatRelative(article.pubDate)

  return (
    <a
      href={article.link || undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-card border border-white/[0.06] bg-wall-surface p-4 transition-all duration-200 hover:border-white/[0.12] hover:bg-white/[0.02]"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-sm font-medium leading-snug text-white/80 group-hover:text-white transition-colors">
          {decodeEntities(article.title)}
        </p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tagClass}`}>
          {tag}
        </span>
      </div>
      <div className="mt-auto flex items-center gap-2">
        <span className="text-[11px] text-white/30">{article.source}</span>
        {timeLabel && (
          <>
            <span className="h-1 w-1 rounded-full bg-white/10" />
            <span className="text-[11px] text-white/30">{timeLabel}</span>
          </>
        )}
      </div>
    </a>
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

  const picks    = (research?.picks ?? []).filter((p) => p.conviction >= 6)
  const articles = research?.articles ?? []
  const signalCount = research?.signalCount ?? research?.tweetCount ?? 0
  const generatedAtLabel = formatGeneratedAt(research?.generatedAt)

  return (
    <div className="min-h-screen bg-wall-bg">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">

        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">Research</h1>
            <p className="mt-1 text-sm text-white/40">
              AI-curated picks, live market data, and finance news.
            </p>
          </div>
          {generatedAtLabel ? (
            <span className="flex items-center gap-1.5 rounded-full border border-gain/20 bg-gain/10 px-2.5 py-1 text-xs text-gain">
              <span className="h-1.5 w-1.5 rounded-full bg-gain" />
              Updated {generatedAtLabel}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              Runs at 3 AM UTC
            </span>
          )}
        </div>

        {/* Market snapshot grid */}
        <div className="mb-8 grid grid-cols-3 gap-3 lg:grid-cols-6">
          {MARKET_SYMBOLS.map((sym) => (
            <MarketCard key={sym} symbol={sym} quote={marketQuotes[sym]} loading={loadingMarket} />
          ))}
        </div>

        {/* AI Picks section */}
        <section className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SparkleIcon />
              <h2 className="text-sm font-semibold text-white">Nightly Picks</h2>
              <span className="text-xs text-white/30">AI-curated from X signals</span>
            </div>
            {signalCount > 0 && (
              <span className="rounded-full border border-white/[0.06] bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] text-white/30">
                {signalCount} signals
              </span>
            )}
          </div>

          {loadingResearch ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-card border border-white/[0.06] bg-wall-surface" />
              ))}
            </div>
          ) : picks.length === 0 ? (
            <div className="rounded-card border border-dashed border-white/[0.06] px-5 py-12 text-center">
              <p className="text-sm text-white/40">No picks available yet.</p>
              <p className="mt-1 text-xs text-white/20">The pipeline runs nightly at 3 AM UTC.</p>
            </div>
          ) : (
            <div className="space-y-3">
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
          <div className="mb-4 flex items-center gap-2">
            <NewsIcon />
            <h2 className="text-sm font-semibold text-white">Latest News</h2>
            <span className="text-xs text-white/30">Yahoo Finance RSS</span>
          </div>

          {loadingResearch ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-card border border-white/[0.06] bg-wall-surface" />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="rounded-card border border-dashed border-white/[0.06] px-5 py-12 text-center">
              <p className="text-sm text-white/40">No news articles yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {articles.slice(0, 12).map((article, i) => (
                <NewsCard key={i} article={article} />
              ))}
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
      <path d="M12 3l1.88 5.76a1 1 0 0 0 .95.69h6.07l-4.91 3.57a1 1 0 0 0-.36 1.12L17.41 20 12 16.43 6.59 20l1.88-5.86a1 1 0 0 0-.36-1.12L3.1 9.45h6.07a1 1 0 0 0 .95-.69L12 3z" />
    </svg>
  )
}

function NewsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8" />
      <path d="M15 18h-5" />
      <path d="M10 6h8v4h-8V6Z" />
    </svg>
  )
}
