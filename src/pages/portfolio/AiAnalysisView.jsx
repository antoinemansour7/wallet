import { useState, useEffect } from 'react'

function renderMarkdown(text) {
  // Strip emojis
  let html = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FAFF}]/gu, '')

  // Sanitize HTML to prevent XSS
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Tables (must be before other block processing)
  html = html.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (match, header, body) => {
    const headerCells = header.split('|').map((c) => c.trim()).filter(Boolean)
    const rows = body.trim().split('\n').map((row) =>
      row.split('|').map((c) => c.trim()).filter(Boolean)
    )
    return `<table><thead><tr>${headerCells.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  })

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr/>')

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/((?:<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>')

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // Line breaks for remaining paragraphs
  html = html.replace(/\n\n/g, '</p><p>')
  html = html.replace(/\n/g, '<br/>')
  html = `<p>${html}</p>`

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '')
  html = html.replace(/<p><(h[123]|hr|ul|ol|table|blockquote)/g, '<$1')
  html = html.replace(/<\/(h[123]|hr|ul|ol|table|blockquote)><\/p>/g, '</$1>')

  return html
}

function SectorBar({ sector, weight, count }) {
  const barColor = weight > 40 ? 'bg-loss' : weight > 25 ? 'bg-amber-500' : 'bg-gain'
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[12px] text-white/60 sm:w-32">{sector}</span>
      <div className="flex-1">
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(weight, 100)}%` }} />
        </div>
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-[11px] text-white/40">{weight}%</span>
      <span className="w-8 shrink-0 text-right text-[10px] text-white/25">{count}</span>
    </div>
  )
}

function MetricCard({ label, value, sub, warning }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${warning ? 'border-amber-400/15 bg-amber-400/[0.04]' : 'border-white/[0.06] bg-wall-surface'}`}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-white/30">{label}</p>
      <p className={`mt-1 text-lg font-bold ${warning ? 'text-amber-400' : 'text-white'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-white/40">{sub}</p>}
    </div>
  )
}

export default function AiAnalysisView({ rows }) {
  const [analysis, setAnalysis] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function runAnalysis() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analyze-portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolioRows: rows }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setAnalysis(data.analysis)
      setMetrics(data.metrics)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Auto-run on first mount when rows are available
  useEffect(() => {
    if (rows?.length > 0 && !analysis && !loading) {
      runAnalysis()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.08] px-6 py-16 text-center">
        <p className="text-sm text-white/50">Upload your portfolio first to get AI analysis.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Trigger button */}
      {!analysis && !loading && (
        <button
          onClick={runAnalysis}
          className="rounded-lg bg-white/[0.07] px-4 py-2 text-[13px] font-medium text-white/60 transition-all hover:bg-white/[0.12] hover:text-white/80"
        >
          Run AI Analysis
        </button>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-white/[0.08] bg-wall-surface px-6 py-8">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
          <span className="text-sm text-white/50">Analyzing {rows.length} positions…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-loss/15 bg-loss/[0.04] px-4 py-3 text-[13px] text-loss/70">
          {error}
        </div>
      )}

      {/* Results */}
      {metrics && (
        <>
          {/* Metrics grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="Total Value"
              value={`$${metrics.totalValue?.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            />
            <MetricCard
              label="Positions"
              value={metrics.positionCount}
            />
            <MetricCard
              label="Top 5 Weight"
              value={`${metrics.top5Weight}%`}
              warning={metrics.top5Weight > 60}
              sub={metrics.top5Weight > 60 ? 'Concentrated' : 'Balanced'}
            />
            <MetricCard
              label="Health"
              value={metrics.diversified ? 'Good' : 'At Risk'}
              warning={!metrics.diversified}
              sub={metrics.risks?.[0] || 'Well diversified'}
            />
          </div>

          {/* Sector breakdown */}
          <div className="rounded-2xl border border-white/[0.06] bg-wall-surface px-4 py-4 sm:px-6 sm:py-5">
            <h3 className="mb-4 text-sm font-semibold text-white/70">Sector Exposure</h3>
            <div className="space-y-2.5">
              {metrics.sectors?.map((s) => (
                <SectorBar key={s.sector} sector={s.sector} weight={s.weight} count={s.count} />
              ))}
            </div>
          </div>

          {/* Risk flags */}
          {metrics.risks?.length > 0 && (
            <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.04] px-4 py-4 sm:px-6 sm:py-5">
              <h3 className="mb-2 text-sm font-semibold text-amber-400/80">Risk Flags</h3>
              <ul className="space-y-1.5">
                {metrics.risks.map((r, i) => (
                  <li key={i} className="text-[12px] text-amber-400/60">⚠ {r}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Claude's full analysis */}
      {analysis && (
        <div className="rounded-2xl border border-white/[0.06] bg-wall-surface px-5 py-5 sm:px-7 sm:py-6">
          <div
            className="ai-prose max-w-none font-[system-ui] text-[13.5px] leading-[1.7] tracking-[-0.01em] text-white/55 [&_h1]:mb-3 [&_h1]:mt-7 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h1]:text-white/90 [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-[14px] [&_h2]:font-semibold [&_h2]:tracking-[-0.02em] [&_h2]:text-white/85 [&_h3]:mb-1.5 [&_h3]:mt-5 [&_h3]:text-[13.5px] [&_h3]:font-medium [&_h3]:text-white/75 [&_strong]:font-semibold [&_strong]:text-white/75 [&_em]:text-white/45 [&_li]:ml-5 [&_li]:mb-1.5 [&_li]:text-white/55 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-1 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-white/15 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-white/40 [&_hr]:my-5 [&_hr]:border-white/[0.07] [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12px] [&_th]:border-b [&_th]:border-white/[0.08] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-white/40 [&_td]:border-b [&_td]:border-white/[0.04] [&_td]:px-3 [&_td]:py-2 [&_td]:text-white/50 [&_p]:my-2"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(analysis) }}
          />
        </div>
      )}

      {/* Re-analyze button */}
      {analysis && (
        <button
          onClick={() => { setAnalysis(null); setMetrics(null); runAnalysis() }}
          className="text-[12px] text-white/30 underline hover:text-white/50"
        >
          Re-analyze
        </button>
      )}
    </div>
  )
}
