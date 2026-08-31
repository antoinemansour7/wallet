import { useEffect, useRef, useState } from 'react'
import CompanyLogo from '../../components/CompanyLogo'
import { getQuoteSymbolsForRow } from '../../utils/livePrices'

const POLL_MS = 3000
const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—')

const VERDICT = {
  BUY: '#34d399',
  SELL: '#fb7185',
  HOLD: '#fbbf24',
}

function Sparkline({ data, positive }) {
  if (!data || data.length < 2) return <div className="h-14" />
  const W = 600
  const H = 56
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * W,
    H - 3 - ((v - min) / range) * (H - 6),
  ])
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const color = positive ? '#34d399' : '#fb7185'
  const gid = positive ? 'spark-up' : 'spark-down'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 56 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SentimentMeter({ score }) {
  const pos = Math.max(2, Math.min(98, (score + 100) / 2))
  return (
    <div>
      <div className="relative h-2 rounded-full" style={{ background: 'linear-gradient(90deg, #fb7185 0%, #3a3a42 50%, #34d399 100%)' }}>
        <span
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-wall-bg bg-white shadow-card transition-all duration-500 ease-ws"
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[10px] font-medium uppercase tracking-[0.1em] text-white/25">
        <span>Sell</span><span>Neutral</span><span>Buy</span>
      </div>
    </div>
  )
}

function IndicatorStat({ label, value, tone }) {
  const cls = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-white/75'
  return (
    <div className="flex-1 px-4 py-3 text-center">
      <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-white/30">{label}</p>
      <p className={`mt-1 text-[14px] font-semibold tabular ${cls}`}>{value}</p>
    </div>
  )
}

function StartScreen({ input, setInput, onStart, quickPicks }) {
  return (
    <div className="relative overflow-hidden rounded-card border border-white/[0.06] bg-wall-surface px-6 py-14 text-center">
      <div className="glow-orb absolute -top-32 left-1/2 h-64 w-64 -translate-x-1/2" />
      <div className="relative mx-auto max-w-md">
        <h2 className="font-display text-[24px] font-medium text-white">Live Trading Desk</h2>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-white/40">
          Enter any ticker for a near-real-time price and a technical signal.
        </p>

        <form onSubmit={(e) => { e.preventDefault(); onStart(input) }} className="mt-7 flex items-center gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/25">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            </span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase().replace(/[^A-Z.]/g, ''))}
              placeholder="NVDA"
              maxLength={10}
              className="w-full rounded-full border border-white/10 bg-wall-bg py-3.5 pl-11 pr-4 font-display text-[17px] font-medium tracking-[0.06em] text-white outline-none transition-colors placeholder:font-sans placeholder:tracking-normal placeholder:text-white/20 focus:border-accent"
            />
          </div>
          <button
            type="submit"
            disabled={!input}
            className="shrink-0 rounded-full bg-gradient-accent px-6 py-3.5 text-[14px] font-semibold text-brand shadow-glow-sm transition-all duration-ws ease-ws hover:shadow-glow disabled:opacity-40"
          >
            Start
          </button>
        </form>

        {quickPicks.length > 0 && (
          <div className="mt-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/25">Your holdings</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {quickPicks.map((p) => (
                <button
                  key={p.value}
                  onClick={() => onStart(p.value)}
                  className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] py-1.5 pl-1.5 pr-3 text-[12px] font-medium text-white/60 transition-colors hover:border-white/15 hover:text-white"
                >
                  <CompanyLogo symbol={p.label} size={18} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TradeView({ rows = [] }) {
  const [input, setInput] = useState('')
  const [active, setActive] = useState(null)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('idle') // idle | loading | live | error | notfound
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  const [tick, setTick] = useState(0)
  const prevPrice = useRef(null)

  const quickPicks = (() => {
    const seen = new Set()
    const out = []
    for (const r of rows) {
      const value = getQuoteSymbolsForRow(r)[0]
      const label = String(r.SYMBOL ?? '').toUpperCase()
      if (!value || seen.has(value)) continue
      seen.add(value)
      out.push({ value, label })
      if (out.length >= 6) break
    }
    return out
  })()

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`/api/live-quote?symbol=${encodeURIComponent(active)}`)
        const d = await res.json()
        if (cancelled) return
        if (!res.ok) { setStatus('error'); setError(d.error || `Error ${res.status}`); return }
        if (!d.found) { setStatus('notfound'); return }

        if (prevPrice.current != null && d.price !== prevPrice.current) {
          setFlash(d.price > prevPrice.current ? 'flash-up' : 'flash-down')
          setTick((t) => t + 1)
        }
        prevPrice.current = d.price
        setData(d)
        setStatus('live')
      } catch (err) {
        if (!cancelled) { setStatus('error'); setError(err.message) }
      }
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [active])

  const start = (s) => {
    const clean = String(s || '').toUpperCase().replace(/[^A-Z.]/g, '')
    if (!clean) return
    prevPrice.current = null
    setData(null); setError(''); setStatus('loading'); setActive(clean)
  }
  const stop = () => { setActive(null); setData(null); setStatus('idle'); prevPrice.current = null }

  if (status === 'idle') {
    return <StartScreen input={input} setInput={setInput} onStart={start} quickPicks={quickPicks} />
  }

  const base = active?.replace(/\.[A-Z]{1,3}$/, '') || active
  const up = (data?.dayChange ?? 0) >= 0
  const sig = data?.signal
  const ind = data?.indicators

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CompanyLogo symbol={base} size={40} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-[19px] font-semibold text-white">{active}</span>
              {status === 'live' && (
                <span className="flex items-center gap-1.5 rounded-full bg-gain/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gain">
                  <span className="live-dot h-1.5 w-1.5 rounded-full bg-gain" /> Live
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-white/30">
              {data?.name ? `${data.name} · ` : ''}near real-time{data?.ts ? ` · ${new Date(data.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </p>
          </div>
        </div>
        <button onClick={stop} className="rounded-full border border-white/[0.08] px-3.5 py-1.5 text-[12px] font-medium text-white/50 transition-colors hover:border-white/15 hover:text-white">
          Stop
        </button>
      </div>

      {status === 'loading' && (
        <div className="flex h-[300px] items-center justify-center rounded-card border border-white/[0.06] bg-wall-surface">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-white/60" />
        </div>
      )}

      {status === 'notfound' && (
        <div className="rounded-card border border-white/[0.06] bg-wall-surface px-6 py-14 text-center">
          <p className="text-[14px] text-white/50">No quote for “{active}”.</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[12px] leading-relaxed text-white/30">
            For Canadian CDRs use the exchange suffix (e.g. <span className="font-mono">ORAC.NE</span>), or pick from your holdings.
          </p>
          <button onClick={stop} className="mt-5 text-[12px] text-white/40 underline hover:text-white/70">Back</button>
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-card border border-loss/15 bg-loss/[0.04] px-5 py-4 text-[13px] text-loss/70">{error}</div>
      )}

      {status === 'live' && data && (
        <>
          {/* Hero: price + sparkline */}
          <div className="relative overflow-hidden rounded-card border border-white/[0.06] bg-wall-surface px-6 py-6 shadow-card">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[15px] font-medium text-white/30">{data.currency === 'CAD' ? 'C$' : '$'}</span>
              <span key={tick} className={`font-display text-[44px] font-semibold leading-none tabular text-white ${flash}`}>
                {fmt(data.price)}
              </span>
            </div>
            <p className={`mt-2 text-[14px] font-medium tabular ${up ? 'text-gain' : 'text-loss'}`}>
              {up ? '▲' : '▼'} {fmt(Math.abs(data.dayChange ?? 0))}
              {data.dayChangePct != null && ` (${data.dayChangePct >= 0 ? '+' : ''}${data.dayChangePct}%)`}
              <span className="ml-2 text-white/30">today</span>
            </p>
            <div className="mt-4 -mx-1">
              <Sparkline data={data.spark} positive={up} />
            </div>
          </div>

          {/* Signal */}
          <div className="rounded-card border border-white/[0.06] bg-wall-surface px-6 py-5 shadow-card">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/30">Technical signal</p>
                <p className="mt-1 font-display text-[28px] font-semibold leading-none" style={{ color: VERDICT[sig?.verdict] ?? '#fbbf24' }}>
                  {sig?.verdict ?? 'HOLD'}
                </p>
              </div>
              <span className="text-[12px] tabular text-white/35">strength {sig?.strength ?? 0}/100</span>
            </div>
            <div className="mt-5">
              <SentimentMeter score={sig?.score ?? 0} />
            </div>
            {sig?.reasons?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {sig.reasons.map((r, i) => (
                  <span key={i} className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/45">{r}</span>
                ))}
              </div>
            )}
          </div>

          {/* Indicator strip */}
          <div className="flex divide-x divide-white/[0.05] rounded-card border border-white/[0.06] bg-wall-surface shadow-card">
            <IndicatorStat label="RSI" value={ind?.rsi ?? '—'} tone={ind?.rsi > 70 ? 'loss' : ind?.rsi < 30 ? 'gain' : 'default'} />
            <IndicatorStat label="Trend" value={ind?.trend ?? '—'} />
            <IndicatorStat label="MACD" value={ind?.macd?.histogram ?? '—'} tone={ind?.macd?.histogram > 0 ? 'gain' : ind?.macd?.histogram < 0 ? 'loss' : 'default'} />
            <IndicatorStat label="Volume" value={ind?.relativeVolume != null ? `${ind.relativeVolume}×` : '—'} />
          </div>

          <p className="px-1 text-[11px] leading-relaxed text-white/25">
            Near-real-time quote and a deterministic technical signal — not financial advice or a recommendation to trade.
          </p>
        </>
      )}
    </div>
  )
}
