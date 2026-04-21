// TODO: replace all placeholder data with real API calls (Alpha Vantage / Polygon.io / Finnhub)

const TOP_MOVERS = [
  { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Tech' },
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Tech' },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'EV' },
  { symbol: 'MSFT', name: 'Microsoft', sector: 'Tech' },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Social' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Tech' },
]

const NEWS = [
  {
    id: 1,
    title: 'Markets rally on strong earnings reports across tech sector',
    source: 'Reuters',
    time: 'Today, 9:30 AM',
    tag: 'Earnings',
  },
  {
    id: 2,
    title: 'Fed signals potential rate cut as inflation data eases',
    source: 'Bloomberg',
    time: 'Today, 8:15 AM',
    tag: 'Macro',
  },
  {
    id: 3,
    title: 'NVIDIA reports record GPU demand driven by AI infrastructure',
    source: 'WSJ',
    time: 'Yesterday',
    tag: 'AI',
  },
  {
    id: 4,
    title: 'S&P 500 hits new all-time high amid low volatility environment',
    source: 'FT',
    time: 'Yesterday',
    tag: 'Markets',
  },
  {
    id: 5,
    title: 'Apple announces $110B buyback — largest in company history',
    source: 'CNBC',
    time: '2 days ago',
    tag: 'Buyback',
  },
]

const TAG_COLORS = {
  Earnings: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  Macro:    'text-purple-400 bg-purple-400/10 border-purple-400/20',
  AI:       'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  Markets:  'text-amber-400 bg-amber-400/10 border-amber-400/20',
  Buyback:  'text-sky-400 bg-sky-400/10 border-sky-400/20',
}

export default function Research() {
  return (
    <div className="min-h-screen bg-wall-bg">
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-slate-100 mb-1">Research</h1>
            <p className="text-slate-500 text-sm">Market movers, news, and daily insights.</p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2.5 py-1 rounded-full mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-slow" />
            Stub — live data soon
          </span>
        </div>

        {/* Top movers */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <TrendingIcon />
            <h2 className="text-slate-300 text-sm font-medium">Top Movers</h2>
            <span className="text-slate-700 text-xs ml-1">— awaiting API</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {TOP_MOVERS.map(({ symbol, name, sector }) => (
              <div
                key={symbol}
                className="bg-wall-surface border border-white/[0.06] rounded-xl p-4 hover:bg-wall-elevated hover:border-white/[0.10] transition-all duration-150 cursor-default"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-slate-100 font-semibold text-sm font-mono">{symbol}</span>
                  <span className="text-slate-700 text-[10px] bg-white/[0.04] px-1.5 py-0.5 rounded font-medium">
                    {sector}
                  </span>
                </div>
                <p className="text-slate-500 text-[11px] mb-2 truncate">{name}</p>
                <p className="text-2xl font-semibold text-slate-700 font-mono tabular">—</p>
                <p className="text-slate-700 text-[11px] mt-1 font-mono tabular">— %</p>
                {/* TODO: fetch price + change from stock API */}
              </div>
            ))}
          </div>
        </section>

        {/* Market snapshot bar */}
        <div className="bg-wall-surface border border-white/[0.06] rounded-xl px-5 py-3.5 mb-8 flex flex-wrap gap-x-8 gap-y-2">
          {[
            { label: 'S&P 500', val: '—' },
            { label: 'NASDAQ', val: '—' },
            { label: 'DOW', val: '—' },
            { label: 'VIX', val: '—' },
            { label: '10Y Yield', val: '—' },
            { label: 'BTC/USD', val: '—' },
          ].map(({ label, val }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-slate-600 text-xs">{label}</span>
              <span className="text-slate-500 text-xs font-mono tabular">{val}</span>
              {/* TODO: fill from API */}
            </div>
          ))}
        </div>

        {/* News feed */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <NewsIcon />
            <h2 className="text-slate-300 text-sm font-medium">Latest News</h2>
          </div>
          <div className="bg-wall-surface border border-white/[0.06] rounded-xl divide-y divide-white/[0.04] overflow-hidden">
            {NEWS.map((article) => {
              const tagClass = TAG_COLORS[article.tag] ?? 'text-slate-400 bg-slate-400/10 border-slate-400/20'
              return (
                <div
                  key={article.id}
                  className="px-5 py-4 hover:bg-white/[0.02] transition-colors cursor-default"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-200 text-sm font-medium leading-snug mb-1.5">
                        {article.title}
                      </p>
                      <div className="flex items-center gap-2.5">
                        <span className="text-slate-600 text-xs">{article.source}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-700" />
                        <span className="text-slate-600 text-xs">{article.time}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border ${tagClass}`}>
                      {article.tag}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-slate-700 text-xs mt-3 px-1">
            {/* TODO: replace placeholder data with live news API (Polygon.io / Finnhub / Alpha Vantage) */}
            Placeholder articles shown. Wire up a news API to show real-time market news.
          </p>
        </section>

      </div>
    </div>
  )
}

function TrendingIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
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
