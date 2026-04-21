import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseSpreadsheet } from '../utils/parseSpreadsheet'
import { enrichRowsWithLivePrices } from '../utils/livePrices'
import { loadLocalPortfolio, loadSavedPortfolioWithTimeout, savePortfolio } from '../utils/portfolioStorage'
import { useAuth } from '../context/AuthContext'
import {
  parseNum, fmtCurrency, fmtPct, fmtNumber, pnlColor,
  computeStats, groupByAccount,
} from '../utils/portfolioStats'

// ─── Constants ────────────────────────────────────────────────────────────────
const COLS = [
  { key: 'SYMBOL',                 label: 'Symbol',      align: 'left',  type: 'symbol'   },
  { key: 'DESCRIPTION',            label: 'Description', align: 'left',  type: 'desc'     },
  { key: 'QUANTITY',               label: 'Qty',         align: 'right', type: 'number'   },
  { key: 'MARKET PRICE',           label: 'Price',       align: 'right', type: 'currency' },
  { key: 'MARKET VALUE',           label: 'Mkt Value',   align: 'right', type: 'currency' },
  { key: 'BOOK VALUE',             label: 'Book Value',  align: 'right', type: 'currency' },
  { key: 'DAY CHANGE',             label: 'Day Chg',     align: 'right', type: 'pnl'      },
  { key: 'DAY CHANGE %',           label: 'Day %',       align: 'right', type: 'pct'      },
  { key: 'UNREALIZED GAIN/LOSS',   label: 'P&L',         align: 'right', type: 'pnl'      },
  { key: 'UNREALIZED GAIN/LOSS %', label: 'P&L %',       align: 'right', type: 'pct'      },
]

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'charts',   label: 'Charts'   },
  { id: 'holdings', label: 'Holdings' },
  { id: 'upload',   label: 'Upload'   },
]

const CHART_COLORS    = ['#1A5C3A', '#2D7A4F', '#4A9B6F', '#16A34A', '#15803D', '#166534']
const CHART_GRADIENTS = [
  ['#1A5C3A', '#2D7A4F'],
  ['#16A34A', '#15803D'],
  ['#4A9B6F', '#1A5C3A'],
  ['#166534', '#14532D'],
  ['#86EFAC', '#4ADE80'],
  ['#2D7A4F', '#166534'],
]

const AUTO_PRICE_REFRESH_MS = 5 * 60 * 1000

const LIVE_META = {
  idle:    { label: 'Waiting for upload',   dot: 'bg-stone-300',              cls: 'border-stone-200 bg-stone-50 text-stone-500'         },
  loading: { label: 'Refreshing prices',    dot: 'bg-wall-green animate-pulse', cls: 'border-green-200 bg-green-50 text-green-700'       },
  success: { label: 'Prices up to date',    dot: 'bg-green-500',              cls: 'border-green-200 bg-green-50 text-green-700'         },
  partial: { label: 'Partial refresh',      dot: 'bg-amber-400',              cls: 'border-amber-200 bg-amber-50 text-amber-700'         },
  error:   { label: 'Live prices unavail.', dot: 'bg-red-400',                cls: 'border-red-200 bg-red-50 text-red-700'               },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function renderCell(type, val) {
  switch (type) {
    case 'currency': return { text: fmtCurrency(val), cls: 'text-stone-700' }
    case 'pnl':      return { text: fmtCurrency(val), cls: pnlColor(val) }
    case 'pct':      return { text: fmtPct(val),      cls: pnlColor(val) }
    case 'number':   return { text: fmtNumber(val),   cls: 'text-stone-600' }
    case 'symbol':   return { text: val ?? '—',       cls: 'text-stone-900 font-bold' }
    case 'desc':     return { text: val ?? '—',       cls: 'text-stone-400' }
    default:         return { text: val ?? '—',       cls: 'text-stone-700' }
  }
}

function pct(value, total) {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (value / total) * 100))
}

function barWidth(value, max) {
  if (value <= 0 || max <= 0) return '0%'
  return `${Math.max(4, pct(value, max))}%`
}

function getTopPositions(rows, limit = 6) {
  return rows
    .map((row, index) => ({
      index,
      symbol:      row.SYMBOL || 'Unknown',
      description: row.DESCRIPTION || '',
      value:       parseNum(row['MARKET VALUE']),
      pnl:         parseNum(row['UNREALIZED GAIN/LOSS']),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

function getAccountBreakdown(groups) {
  return groups
    .map(([account, accountRows], index) => ({
      account,
      positions: accountRows.length,
      value:     computeStats(accountRows).totalMarketValue,
      color:     CHART_COLORS[index % CHART_COLORS.length],
      gradient:  CHART_GRADIENTS[index % CHART_GRADIENTS.length],
    }))
    .filter((item) => item.value > 0)
}

function getPnlBuckets(rows) {
  const buckets = [
    { id: 'gainers', label: 'Gainers', count: 0, value: 0, gradient: ['#16A34A', '#15803D'] },
    { id: 'losers',  label: 'Losers',  count: 0, value: 0, gradient: ['#EF4444', '#DC2626'] },
    { id: 'flat',    label: 'Flat',    count: 0, value: 0, gradient: ['#A8A29E', '#78716C'] },
  ]
  for (const row of rows) {
    const p = parseNum(row['UNREALIZED GAIN/LOSS'])
    if (p > 0)      { buckets[0].count += 1; buckets[0].value += p }
    else if (p < 0) { buckets[1].count += 1; buckets[1].value += Math.abs(p) }
    else            { buckets[2].count += 1 }
  }
  return buckets
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Portfolio() {
  const [rows, setRows]                   = useState([])
  const [fileName, setFileName]           = useState('')
  const [error, setError]                 = useState('')
  const [loading, setLoading]             = useState(false)
  const [loadingMsg, setLoadingMsg]       = useState('')
  const [isDragging, setIsDragging]       = useState(false)
  const [activeView, setActiveView]       = useState('upload')
  const [liveStatus, setLiveStatus]       = useState('idle')
  const [liveMessage, setLiveMessage]     = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const inputRef = useRef(null)

  const { user } = useAuth()
  const uid = user?.uid

  const hasData     = rows.length > 0
  const stats       = useMemo(() => (hasData ? computeStats(rows) : null), [hasData, rows])
  const groups      = useMemo(() => (hasData ? groupByAccount(rows) : []), [hasData, rows])
  const visibleView = hasData ? activeView : 'upload'

  // ── Restore saved portfolio on mount ──────────────────────────────────────
  useEffect(() => {
    if (!uid) return
    const local = loadLocalPortfolio(uid)
    if (local?.rows?.length) {
      setRows(local.rows)
      setFileName(local.fileName || '')
      setActiveView('overview')
    }
    loadSavedPortfolioWithTimeout(uid)
      .then((saved) => {
        if (saved?.rows?.length) {
          setRows(saved.rows)
          setFileName(saved.fileName || '')
          setActiveView('overview')
        }
      })
      .catch(() => {})
  }, [uid])

  // ── Auto-save whenever rows change ────────────────────────────────────────
  useEffect(() => {
    if (!uid || !rows.length || !fileName) return
    const timer = setTimeout(() => {
      savePortfolio(uid, { fileName, rows, lastPriceRefreshAt: lastUpdatedAt }).catch(() => {})
    }, 1000)
    return () => clearTimeout(timer)
  }, [rows, uid, fileName, lastUpdatedAt])

  const refreshRowsWithLivePrices = useCallback(async (sourceRows) => {
    if (!sourceRows.length) { setLiveStatus('idle'); setLiveMessage(''); return sourceRows }
    setLiveStatus('loading')
    setLiveMessage('Refreshing current prices from market data providers…')
    try {
      const result   = await enrichRowsWithLivePrices(sourceRows)
      const nextRows = result.rows
      setRows(nextRows)
      if (result.updatedRows > 0) setLastUpdatedAt(new Date())
      const cache = result.cache
      if (result.updatedRows === 0 && result.errors?.length > 0) {
        setLiveStatus('error'); setLiveMessage(result.errors[0].error)
      } else if (result.updatedRows === 0) {
        setLiveStatus('partial'); setLiveMessage('No market quotes matched the uploaded symbols.')
      } else if (result.missing.length > 0 || result.errors?.length > 0) {
        setLiveStatus('partial')
        setLiveMessage(`${result.updatedRows} positions refreshed; ${result.missing.length} symbols not found by market providers.`)
      } else if (cache?.refreshed === 0 && cache?.hits > 0) {
        setLiveStatus('success'); setLiveMessage(`${result.updatedRows} positions loaded from cache.`)
      } else {
        setLiveStatus('success')
        setLiveMessage(`${result.updatedRows} positions updated · ${cache?.hits ?? 0} from cache.`)
      }
      return nextRows
    } catch (err) {
      setLiveStatus('error'); setLiveMessage(`Price refresh failed: ${err.message}`)
      return sourceRows
    }
  }, [])

  useEffect(() => {
    if (!rows.length) return undefined
    const id = window.setInterval(() => {
      if (liveStatus !== 'loading') refreshRowsWithLivePrices(rows)
    }, AUTO_PRICE_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [rows, liveStatus, refreshRowsWithLivePrices])

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    setLoading(true)
    setLoadingMsg('Analyzing with AI…')
    try {
      const parsed     = await parseSpreadsheet(file)
      const parsedRows = parsed.rows ?? []
      setRows(parsedRows)
      setFileName(file.name)
      setActiveView(parsedRows.length > 0 ? 'overview' : 'upload')
      if (parsedRows.length > 0) {
        setLoadingMsg('Fetching live prices…')
        await refreshRowsWithLivePrices(parsedRows)
      } else {
        setLiveStatus('idle')
        setLiveMessage('No positions found in the uploaded file.')
      }
    } catch (err) {
      setError(err.message); setLiveStatus('idle'); setLiveMessage('')
    } finally {
      setLoading(false); setLoadingMsg('')
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onDrop = (e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }

  return (
    <div className="min-h-screen bg-wall-bg">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <PortfolioHeader
          fileName={fileName} hasData={hasData} liveStatus={liveStatus}
          lastUpdatedAt={lastUpdatedAt} onUploadClick={() => setActiveView('upload')}
        />
        <TabNav activeView={visibleView} hasData={hasData} onChange={setActiveView} />

        {visibleView === 'overview' && (
          <OverviewView rows={rows} stats={stats} groups={groups} liveStatus={liveStatus} liveMessage={liveMessage} lastUpdatedAt={lastUpdatedAt} onUploadClick={() => setActiveView('upload')} />
        )}
        {visibleView === 'charts' && (
          <ChartsView rows={rows} stats={stats} groups={groups} liveStatus={liveStatus} liveMessage={liveMessage} lastUpdatedAt={lastUpdatedAt} onUploadClick={() => setActiveView('upload')} />
        )}
        {visibleView === 'holdings' && (
          <HoldingsView rows={rows} groups={groups} onUploadClick={() => setActiveView('upload')} />
        )}
        {visibleView === 'upload' && (
          <UploadView
            error={error} fileName={fileName} hasData={hasData} isDragging={isDragging}
            loading={loading} loadingMsg={loadingMsg} rows={rows} inputRef={inputRef}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onFile={handleFile}
          />
        )}
      </div>
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────
function PortfolioHeader({ fileName, hasData, liveStatus, lastUpdatedAt, onUploadClick }) {
  const isRefreshing = liveStatus === 'loading'
  return (
    <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-wall-green/70">Dashboard</p>
        <h1 className="text-[28px] font-bold tracking-tight text-stone-900">Portfolio</h1>
        <p className="mt-1.5 text-sm text-stone-400">AI-parsed holdings · live market prices</p>
        {hasData && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 py-1 text-stone-600">
              <span className="h-1.5 w-1.5 rounded-full bg-wall-green" />
              {fileName}
            </span>
            {lastUpdatedAt && (
              <span className="rounded-full border border-black/[0.06] bg-wall-elevated px-3 py-1 font-mono text-stone-400">
                Prices at {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {hasData && (
          <div className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold ${
            isRefreshing
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-green-200 bg-green-50 text-green-700'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full bg-wall-green ${isRefreshing ? 'animate-pulse' : ''}`} />
            {isRefreshing ? 'Refreshing…' : 'Live · 5 min'}
          </div>
        )}
        <button
          type="button"
          onClick={onUploadClick}
          className="rounded-full border border-black/[0.1] bg-white px-4 py-1.5 text-xs font-semibold text-stone-600 shadow-sm transition-all hover:border-black/[0.18] hover:text-stone-900"
        >
          Upload file
        </button>
      </div>
    </header>
  )
}

// ─── Tab Navigation ───────────────────────────────────────────────────────────
function TabNav({ activeView, hasData, onChange }) {
  return (
    <div className="mb-7 flex gap-1 rounded-xl border border-black/[0.07] bg-wall-elevated p-1 shadow-sm">
      {TABS.map((tab) => {
        const disabled = !hasData && tab.id !== 'upload'
        const isActive = activeView === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
              isActive
                ? 'bg-wall-green text-white shadow-sm'
                : 'text-stone-500 hover:bg-black/[0.05] hover:text-stone-800'
            } ${disabled ? 'cursor-not-allowed opacity-30 hover:bg-transparent hover:text-stone-500' : ''}`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Views ────────────────────────────────────────────────────────────────────
function OverviewView({ rows, stats, groups, liveStatus, liveMessage, lastUpdatedAt, onUploadClick }) {
  if (!rows.length) return <EmptyState onUploadClick={onUploadClick} />
  return (
    <>
      <LiveBanner liveStatus={liveStatus} liveMessage={liveMessage} lastUpdatedAt={lastUpdatedAt} />
      <KpiGrid rows={rows} stats={stats} groups={groups} />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <AccountAllocationChart groups={groups} />
        <ValueVsBookChart stats={stats} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <TopPositionsChart rows={rows} />
        <PnlBreakdownChart rows={rows} />
      </div>
    </>
  )
}

function ChartsView({ rows, stats, groups, liveStatus, liveMessage, lastUpdatedAt, onUploadClick }) {
  if (!rows.length) return <EmptyState onUploadClick={onUploadClick} />
  return (
    <>
      <LiveBanner liveStatus={liveStatus} liveMessage={liveMessage} lastUpdatedAt={lastUpdatedAt} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TopPositionsChart rows={rows} large />
        <AccountAllocationChart groups={groups} large />
        <ValueVsBookChart stats={stats} />
        <PnlBreakdownChart rows={rows} />
      </div>
    </>
  )
}

// ─── KPI Grid ─────────────────────────────────────────────────────────────────
function KpiGrid({ rows, stats, groups }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Total Value"    value={fmtCurrency(stats.totalMarketValue)} sub={`${rows.length} positions`} />
      <StatCard label="All-time P&L"   value={fmtCurrency(stats.totalUnrealized)}  sub={fmtPct(stats.unrealizedPct)} pnl={stats.totalUnrealized} />
      <StatCard label="Today's Change" value={fmtCurrency(stats.totalDayChange)}   sub={fmtPct(stats.dayChangePct)}  pnl={stats.totalDayChange} />
      <StatCard label="Accounts"       value={String(groups.length)}               sub={`${rows.length} positions total`} />
    </div>
  )
}

// ─── Live Status Banner ───────────────────────────────────────────────────────
function LiveBanner({ liveStatus, liveMessage, lastUpdatedAt }) {
  const meta = LIVE_META[liveStatus] ?? LIVE_META.idle
  return (
    <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 ${meta.cls}`}>
      <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
          <p className="text-sm font-semibold">{meta.label}</p>
          {lastUpdatedAt && (
            <span className="font-mono text-xs opacity-60">
              {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed opacity-75">
          {liveMessage || 'Quantities, accounts, and book values come from the uploaded file.'}
        </p>
      </div>
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, pnl }) {
  const isPnl    = pnl !== undefined && pnl !== null
  const positive = isPnl && pnl > 0
  const negative = isPnl && pnl < 0

  const borderTop = positive ? 'via-green-400/60' : negative ? 'via-red-400/60' : 'via-wall-green/30'
  const pnlCls    = positive ? 'text-green-700' : negative ? 'text-red-600' : ''

  return (
    <div className="relative overflow-hidden rounded-xl border border-black/[0.07] bg-white p-5 shadow-card transition-all duration-200 hover:shadow-card-hover">
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent ${borderTop} to-transparent`} />
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-stone-400">{label}</p>
      <p className={`font-mono text-[26px] font-bold tabular leading-none tracking-tight ${value ? (pnlCls || 'text-stone-900') : 'text-stone-200'}`}>
        {value ?? '—'}
      </p>
      <p className={`mt-2.5 font-mono text-xs tabular ${pnlCls ? `${pnlCls} opacity-75` : 'text-stone-400'}`}>
        {sub}
      </p>
    </div>
  )
}

// ─── Chart Panel ──────────────────────────────────────────────────────────────
function ChartPanel({ title, meta, children, large = false }) {
  return (
    <section className={`rounded-xl border border-black/[0.07] bg-white p-5 shadow-card ${large ? 'min-h-[380px]' : ''}`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-stone-800">{title}</h2>
        {meta && (
          <span className="rounded-full border border-black/[0.07] bg-wall-elevated px-2.5 py-0.5 font-mono text-[10px] tabular text-stone-500">
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

// ─── Chart: Account Allocation ────────────────────────────────────────────────
function AccountAllocationChart({ groups, large = false }) {
  const items = getAccountBreakdown(groups)
  const total = items.reduce((s, i) => s + i.value, 0)

  return (
    <ChartPanel title="Allocation by Account" meta={fmtCurrency(total)} large={large}>
      {items.length === 0 ? <EmptyChart /> : (
        <>
          <div className="mb-5 flex h-2.5 overflow-hidden rounded-full bg-stone-100">
            {items.map((item) => (
              <div
                key={item.account}
                style={{ width: `${pct(item.value, total)}%`, background: `linear-gradient(90deg, ${item.gradient[0]}, ${item.gradient[1]})` }}
                className="h-full transition-all duration-700"
                title={`Account ${item.account}: ${fmtCurrency(item.value)}`}
              />
            ))}
          </div>
          <div className="space-y-3.5">
            {items.map((item) => (
              <div key={item.account} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-700">Account {item.account}</p>
                    <p className="text-[11px] text-stone-400">{item.positions} positions</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm tabular font-semibold text-stone-800">{fmtCurrency(item.value)}</p>
                  <p className="font-mono text-[11px] tabular text-stone-400">{pct(item.value, total).toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </ChartPanel>
  )
}

// ─── Chart: Top Positions ─────────────────────────────────────────────────────
function TopPositionsChart({ rows, large = false }) {
  const items = getTopPositions(rows, large ? 10 : 6)
  const max   = Math.max(...items.map((i) => i.value), 0)
  const total = rows.reduce((s, r) => s + parseNum(r['MARKET VALUE']), 0)

  return (
    <ChartPanel title="Top Positions" meta={`${items.length} shown`} large={large}>
      {items.length === 0 ? <EmptyChart /> : (
        <div className="space-y-4">
          {items.map((item, index) => {
            const [c0, c1] = CHART_GRADIENTS[index % CHART_GRADIENTS.length]
            const isPositive = item.pnl >= 0
            return (
              <div key={`${item.symbol}-${item.index}`}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-bold text-stone-900">{item.symbol}</p>
                    {item.description && <p className="truncate text-[11px] text-stone-400">{item.description}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm tabular font-semibold text-stone-800">{fmtCurrency(item.value)}</p>
                    <p className={`font-mono text-[11px] tabular ${isPositive ? 'text-green-600' : 'text-red-500'}`}>{fmtCurrency(item.pnl)}</p>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: barWidth(item.value, max), background: `linear-gradient(90deg, ${c0}90, ${c1})` }}
                  />
                </div>
                <p className="mt-1 font-mono text-[10px] tabular text-stone-400">{pct(item.value, total).toFixed(1)}% of portfolio</p>
              </div>
            )
          })}
        </div>
      )}
    </ChartPanel>
  )
}

// ─── Chart: Value vs Book ─────────────────────────────────────────────────────
function ValueVsBookChart({ stats }) {
  const max    = Math.max(stats.totalMarketValue, stats.totalBookValue, 1)
  const spread = stats.totalMarketValue - stats.totalBookValue

  return (
    <ChartPanel title="Value vs Book" meta={fmtCurrency(spread)}>
      <div className="space-y-5">
        <GradientBar label="Market value" value={stats.totalMarketValue} max={max} from="#1A5C3A90" to="#1A5C3A" />
        <GradientBar label="Book value"   value={stats.totalBookValue}   max={max} from="#A8A29E90" to="#78716C" />
      </div>
      <div className="mt-5 rounded-lg border border-black/[0.06] bg-wall-elevated px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-stone-500">Unrealized Spread</span>
          <span className={`font-mono text-sm tabular font-bold ${spread >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtCurrency(spread)}</span>
        </div>
      </div>
    </ChartPanel>
  )
}

function GradientBar({ label, value, max, from, to }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-stone-500">{label}</span>
        <span className="font-mono text-sm tabular font-semibold text-stone-800">{fmtCurrency(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-100">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: barWidth(value, max), background: `linear-gradient(90deg, ${from}, ${to})` }}
        />
      </div>
    </div>
  )
}

// ─── Chart: P&L Breakdown ─────────────────────────────────────────────────────
function PnlBreakdownChart({ rows }) {
  const buckets = getPnlBuckets(rows)
  const max     = Math.max(...buckets.map((b) => b.value), 1)

  return (
    <ChartPanel title="P&L Breakdown" meta={`${rows.length} positions`}>
      <div className="space-y-4">
        {buckets.map((b) => (
          <div key={b.id}>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.gradient[1] }} />
                <span className="text-sm text-stone-600">{b.label}</span>
              </div>
              <span className="font-mono text-sm tabular font-semibold text-stone-800">
                {b.count} · {fmtCurrency(b.value)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: b.value > 0 ? barWidth(b.value, max) : b.count > 0 ? '8%' : '0%',
                  background: `linear-gradient(90deg, ${b.gradient[0]}90, ${b.gradient[1]})`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </ChartPanel>
  )
}

// ─── Upload View ──────────────────────────────────────────────────────────────
function UploadView({ error, fileName, hasData, inputRef, isDragging, loading, loadingMsg, rows, onDragLeave, onDragOver, onDrop, onFile }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        <div
          className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-14 text-center transition-all duration-200 ${
            isDragging
              ? 'scale-[1.005] border-wall-green/50 bg-wall-green-light'
              : loading
              ? 'border-stone-200 bg-white'
              : 'border-stone-200 bg-dot-grid hover:border-wall-green/40 hover:bg-wall-green-light/40'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden" onChange={(e) => onFile(e.target.files[0])} />

          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="relative h-12 w-12">
                <div className="absolute inset-0 rounded-full border-2 border-stone-100" />
                <div className="absolute inset-0 rounded-full border-2 border-wall-green border-t-transparent animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-stone-700">{loadingMsg}</p>
                <p className="mt-1 text-xs text-stone-400">This may take a few seconds</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border-2 transition-all duration-200 ${isDragging ? 'border-wall-green bg-wall-green-light' : 'border-stone-200 bg-white'}`}>
                <UploadIcon active={isDragging} />
              </div>
              <div>
                <p className="text-base font-semibold text-stone-700">{isDragging ? 'Drop to import' : 'Drop your portfolio here'}</p>
                <p className="mt-1.5 text-xs text-stone-400">CSV · XLSX · XLS · PDF</p>
                <p className="mt-3 text-xs text-stone-400">
                  or <span className="cursor-pointer text-wall-green underline underline-offset-2 hover:text-green-800">browse files</span>
                </p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><circle cx="12" cy="16" r="0.5" fill="currentColor" />
            </svg>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      <aside className="space-y-3">
        <InfoPanel title="Current File" icon="📄">
          {hasData ? (
            <>
              <p className="truncate text-sm font-semibold text-stone-700" title={fileName}>{fileName}</p>
              <p className="mt-0.5 text-xs text-stone-400">{rows.length} positions</p>
            </>
          ) : (
            <p className="text-sm text-stone-400">No file loaded</p>
          )}
        </InfoPanel>
        <InfoPanel title="AI Parsing" icon="✦">
          <p className="text-xs leading-relaxed text-stone-400">
            Works with any broker — Questrade, TD, CIBC, Wealthsimple, and more. The AI maps your headers automatically.
          </p>
        </InfoPanel>
        <InfoPanel title="Live Prices" icon="⚡">
          <p className="text-xs leading-relaxed text-stone-400">
            US stocks refresh from Polygon/Massive when configured; Canadian CDRs and fallback quotes use Yahoo Finance.
          </p>
        </InfoPanel>
      </aside>
    </div>
  )
}

// ─── Holdings Table ───────────────────────────────────────────────────────────
function HoldingsView({ rows, groups, onUploadClick }) {
  if (!rows.length) return <EmptyState onUploadClick={onUploadClick} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-800">All Positions</h2>
        <span className="rounded-full border border-black/[0.07] bg-white px-3 py-1 font-mono text-xs text-stone-500 shadow-sm">
          {rows.length} positions
        </span>
      </div>

      {groups.map(([acct, acctRows]) => {
        const acctStats = computeStats(acctRows)
        const bookTotal = acctRows.reduce((s, r) => s + parseNum(r['BOOK VALUE']), 0)

        return (
          <div key={acct} className="overflow-hidden rounded-xl border border-black/[0.07] bg-white shadow-card">

            {/* ── Account header ───────────────────────────────────── */}
            <div className="flex items-center justify-between border-b border-black/[0.06] bg-wall-elevated px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-wall-green" />
                <span className="text-xs font-bold tracking-wide text-stone-700">Account {acct}</span>
                <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-medium text-stone-500">
                  {acctRows.length} positions
                </span>
              </div>
              <span className="font-mono text-sm font-bold tabular text-stone-800">
                {fmtCurrency(acctStats.totalMarketValue)}
              </span>
            </div>

            {/* ── Column labels ─────────────────────────────────────── */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 border-b border-black/[0.04] px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Position</span>
              <span className="w-20 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Price · Qty</span>
              <span className="w-28 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Mkt Value</span>
              <span className="w-28 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">P&L</span>
              <span className="w-16 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Today</span>
            </div>

            {/* ── Position rows ─────────────────────────────────────── */}
            <div className="divide-y divide-black/[0.03]">
              {acctRows.map((row, i) => {
                const isCdrRow = /\bCDR\b/i.test(String(row.DESCRIPTION ?? ''))
                const symbol   = row.SYMBOL ?? '—'
                const pnl      = parseNum(row['UNREALIZED GAIN/LOSS'])
                const pnlPct   = row['UNREALIZED GAIN/LOSS %']
                const dayAmt   = parseNum(row['DAY CHANGE'])
                const dayPct   = row['DAY CHANGE %']
                const price    = parseNum(row['MARKET PRICE'])
                const mktVal   = parseNum(row['MARKET VALUE'])
                const bookVal  = parseNum(row['BOOK VALUE'])
                const qty      = parseNum(row.QUANTITY)
                const gainCls  = pnl > 0 ? 'text-green-600' : pnl < 0 ? 'text-red-600' : 'text-stone-400'
                const dayCls   = dayAmt > 0 ? 'text-green-600' : dayAmt < 0 ? 'text-red-600' : 'text-stone-400'

                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 px-4 py-3.5 transition-colors hover:bg-stone-50/70"
                  >
                    {/* Position: icon + symbol + name */}
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-wall-green-light text-sm font-bold text-wall-green">
                        {symbol[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-sm font-bold text-stone-900">{symbol}</span>
                          {isCdrRow && (
                            <span
                              className="rounded bg-wall-green/10 px-1 py-px text-[9px] font-bold tracking-wide text-wall-green"
                              title="Canadian Depositary Receipt — price reflects the CDR unit on the NEO exchange, not the underlying US stock price"
                            >
                              CDR
                            </span>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-stone-400" title={row.DESCRIPTION ?? ''}>
                          {row.DESCRIPTION ?? '—'}
                        </p>
                      </div>
                    </div>

                    {/* Price · Qty */}
                    <div className="w-20 text-right">
                      <p className="font-mono text-sm font-semibold tabular text-stone-800">{fmtCurrency(price)}</p>
                      <p className="text-[11px] tabular text-stone-400">{fmtNumber(qty)} units</p>
                    </div>

                    {/* Market Value */}
                    <div className="w-28 text-right">
                      <p className="font-mono text-sm font-bold tabular text-stone-900">{fmtCurrency(mktVal)}</p>
                      <p className="text-[11px] tabular text-stone-400">{fmtCurrency(bookVal)} cost</p>
                    </div>

                    {/* P&L */}
                    <div className="w-28 text-right">
                      <p className={`font-mono text-sm font-bold tabular ${gainCls}`}>{fmtCurrency(pnl)}</p>
                      <p className={`text-[11px] font-medium ${gainCls}`}>{pnlPct ?? '—'}</p>
                    </div>

                    {/* Day change */}
                    <div className="w-16 text-right">
                      <p className={`text-xs font-bold ${dayCls}`}>{dayPct ?? '—'}</p>
                      <p className={`font-mono text-[11px] tabular ${dayCls}`}>
                        {dayAmt !== 0 ? fmtCurrency(dayAmt) : ''}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* ── Account subtotal ──────────────────────────────────── */}
            <div className="grid grid-cols-3 gap-4 border-t border-black/[0.05] bg-wall-elevated px-4 py-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-stone-400">Book Cost</p>
                <p className="font-mono text-xs font-semibold tabular text-stone-600">{fmtCurrency(bookTotal)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-stone-400">Total P&L</p>
                <p className={`font-mono text-xs font-semibold tabular ${acctStats.totalUnrealized >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmtCurrency(acctStats.totalUnrealized)}&nbsp;
                  <span className="font-normal">({fmtPct(acctStats.unrealizedPct)})</span>
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-stone-400">Today</p>
                <p className={`font-mono text-xs font-semibold tabular ${acctStats.totalDayChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmtCurrency(acctStats.totalDayChange)}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Info Panel ───────────────────────────────────────────────────────────────
function InfoPanel({ title, icon, children }) {
  return (
    <section className="rounded-xl border border-black/[0.07] bg-white p-4 shadow-card">
      <h2 className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400">
        <span>{icon}</span>{title}
      </h2>
      {children}
    </section>
  )
}

// ─── Empty States ─────────────────────────────────────────────────────────────
function EmptyState({ onUploadClick }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-200 bg-dot-grid px-6 py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-stone-200 bg-white">
        <UploadIcon />
      </div>
      <p className="text-base font-semibold text-stone-700">No portfolio loaded</p>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-stone-400">
        Upload a CSV, Excel, or PDF from any broker to populate the dashboard.
      </p>
      <button
        type="button"
        onClick={onUploadClick}
        className="mt-5 rounded-full border border-wall-green bg-wall-green px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-green-800"
      >
        Upload a file
      </button>
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-stone-100">
      <p className="text-sm text-stone-300">No data available</p>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────
function UploadIcon({ active = false }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={active ? 'text-wall-green' : 'text-stone-400'}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}
