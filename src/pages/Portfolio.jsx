import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseSpreadsheet } from '../utils/parseSpreadsheet'
import { enrichRowsWithLivePrices } from '../utils/livePrices'
import {
  loadLocalPortfolio,
  loadSavedPortfolioWithTimeout,
  saveLocalPortfolio,
  savePortfolio,
} from '../utils/portfolioStorage'
import { useAuth } from '../context/AuthContext'
import {
  parseNum, fmtCurrency, fmtPct, fmtNumber, pnlColor,
  computeStats, groupByAccount,
} from '../utils/portfolioStats'

const COLS = [
  { key: 'SYMBOL',                 label: 'Symbol',     align: 'left',  type: 'symbol'   },
  { key: 'DESCRIPTION',            label: 'Description',align: 'left',  type: 'desc'     },
  { key: 'QUANTITY',               label: 'Qty',        align: 'right', type: 'number'   },
  { key: 'MARKET PRICE',           label: 'Price',      align: 'right', type: 'currency' },
  { key: 'MARKET VALUE',           label: 'Mkt Value',  align: 'right', type: 'currency' },
  { key: 'BOOK VALUE',             label: 'Book Value', align: 'right', type: 'currency' },
  { key: 'DAY CHANGE',             label: 'Day Chg',    align: 'right', type: 'pnl'      },
  { key: 'DAY CHANGE %',           label: 'Day %',      align: 'right', type: 'pct'      },
  { key: 'UNREALIZED GAIN/LOSS',   label: 'P&L',        align: 'right', type: 'pnl'      },
  { key: 'UNREALIZED GAIN/LOSS %', label: 'P&L %',      align: 'right', type: 'pct'      },
]

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'charts', label: 'Charts' },
  { id: 'holdings', label: 'Holdings' },
  { id: 'upload', label: 'Upload' },
]

const CHART_COLORS = ['#38bdf8', '#34d399', '#f59e0b', '#f43f5e', '#a78bfa', '#f97316']
const AUTO_PRICE_REFRESH_MS = 5 * 60 * 1000

const LIVE_META = {
  idle: {
    label: 'Waiting for upload',
    dot: 'bg-slate-500',
    className: 'border-white/[0.06] bg-wall-surface text-slate-400',
  },
  loading: {
    label: 'Refreshing Yahoo prices',
    dot: 'bg-sky-400 animate-pulse',
    className: 'border-sky-400/20 bg-sky-400/[0.06] text-sky-300',
  },
  success: {
    label: 'Yahoo prices applied',
    dot: 'bg-emerald-400',
    className: 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300',
  },
  partial: {
    label: 'Partial price refresh',
    dot: 'bg-amber-400',
    className: 'border-amber-400/20 bg-amber-400/[0.06] text-amber-300',
  },
  error: {
    label: 'Live prices unavailable',
    dot: 'bg-rose-400',
    className: 'border-rose-400/20 bg-rose-400/[0.06] text-rose-300',
  },
}

function renderCell(type, val) {
  switch (type) {
    case 'currency': return { text: fmtCurrency(val), cls: 'text-slate-300' }
    case 'pnl':      return { text: fmtCurrency(val), cls: pnlColor(val) }
    case 'pct':      return { text: fmtPct(val),      cls: pnlColor(val) }
    case 'number':   return { text: fmtNumber(val),   cls: 'text-slate-300' }
    case 'symbol':   return { text: val ?? '-',        cls: 'text-slate-100 font-semibold' }
    case 'desc':     return { text: val ?? '-',        cls: 'text-slate-400' }
    default:         return { text: val ?? '-',        cls: 'text-slate-300' }
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
      symbol: row.SYMBOL || 'Unknown',
      description: row.DESCRIPTION || '',
      value: parseNum(row['MARKET VALUE']),
      pnl: parseNum(row['UNREALIZED GAIN/LOSS']),
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
      value: computeStats(accountRows).totalMarketValue,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }))
    .filter((item) => item.value > 0)
}

function getPnlBuckets(rows) {
  const buckets = [
    { id: 'gainers', label: 'Gainers', count: 0, value: 0, color: '#34d399' },
    { id: 'losers', label: 'Losers', count: 0, value: 0, color: '#fb7185' },
    { id: 'flat', label: 'Flat', count: 0, value: 0, color: '#94a3b8' },
  ]

  for (const row of rows) {
    const pnl = parseNum(row['UNREALIZED GAIN/LOSS'])
    if (pnl > 0) {
      buckets[0].count += 1
      buckets[0].value += pnl
    } else if (pnl < 0) {
      buckets[1].count += 1
      buckets[1].value += Math.abs(pnl)
    } else {
      buckets[2].count += 1
    }
  }

  return buckets
}

function timestampToDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value.toDate === 'function') return value.toDate()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isPriceRefreshDue(value) {
  const lastRefreshAt = timestampToDate(value)
  if (!lastRefreshAt) return true

  return Date.now() - lastRefreshAt.getTime() >= AUTO_PRICE_REFRESH_MS
}

function portfolioUpdatedAtMs(portfolio) {
  return timestampToDate(portfolio?.updatedAt)?.getTime() ?? 0
}

function shouldUseAccountPortfolio(accountPortfolio, localPortfolio) {
  if (!accountPortfolio?.rows?.length) return false
  if (!localPortfolio?.rows?.length) return true

  return portfolioUpdatedAtMs(accountPortfolio) >= portfolioUpdatedAtMs(localPortfolio)
}

function applySavedPortfolio(saved, {
  setRows,
  setFileName,
  setActiveView,
  setLastUpdatedAt,
  setLiveStatus,
  setLiveMessage,
  fileNameRef,
  message = 'Loaded saved portfolio from your account.',
}) {
  setRows(saved.rows)
  setFileName(saved.fileName)
  fileNameRef.current = saved.fileName
  setActiveView('overview')
  setLastUpdatedAt(timestampToDate(saved.lastPriceRefreshAt))
  setLiveStatus('success')
  setLiveMessage(message)
}

export default function Portfolio() {
  const { user } = useAuth()
  const [rows, setRows]               = useState([])
  const [fileName, setFileName]       = useState('')
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [portfolioLoading, setPortfolioLoading] = useState(true)
  const [loadingMsg, setLoadingMsg]   = useState('')
  const [isDragging, setIsDragging]   = useState(false)
  const [activeView, setActiveView]   = useState('upload')
  const [liveStatus, setLiveStatus]   = useState('idle')
  const [liveMessage, setLiveMessage] = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const inputRef = useRef(null)
  const fileNameRef = useRef('')
  const userId = user?.uid

  const hasData = rows.length > 0
  const stats = useMemo(() => (hasData ? computeStats(rows) : null), [hasData, rows])
  const groups = useMemo(() => (hasData ? groupByAccount(rows) : []), [hasData, rows])
  const visibleView = hasData ? activeView : 'upload'

  useEffect(() => {
    fileNameRef.current = fileName
  }, [fileName])

  const persistRows = useCallback(async (nextRows, options = {}) => {
    if (!userId || !nextRows.length) return

    try {
      await savePortfolio(userId, {
        fileName: options.fileNameOverride ?? fileNameRef.current,
        rows: nextRows,
        lastPriceRefreshAt: options.lastPriceRefreshAt ?? null,
        markUploaded: options.markUploaded ?? false,
      })
    } catch (err) {
      console.warn('Could not sync portfolio to account storage:', err)
    }
  }, [userId])

  const persistRowsLocal = useCallback((nextRows, options = {}) => {
    if (!userId || !nextRows.length) return

    saveLocalPortfolio(userId, {
      fileName: options.fileNameOverride ?? fileNameRef.current,
      rows: nextRows,
      lastPriceRefreshAt: options.lastPriceRefreshAt ?? null,
    })
  }, [userId])

  const refreshRowsWithLivePrices = useCallback(async (sourceRows, options = {}) => {
    if (!sourceRows.length) {
      setLiveStatus('idle')
      setLiveMessage('')
      return sourceRows
    }

    setLiveStatus('loading')
    setLiveMessage('Refreshing current prices from Yahoo Finance.')

    try {
      const result = await enrichRowsWithLivePrices(sourceRows)
      const nextRows = result.rows
      setRows(nextRows)

      const shouldPersistRows = result.updatedRows > 0 || options.markUploaded
      const refreshedAt = result.updatedRows > 0 ? new Date() : null
      const refreshedAtIso = refreshedAt?.toISOString() ?? null

      if (refreshedAt) {
        setLastUpdatedAt(refreshedAt)
      }

      if (shouldPersistRows) {
        persistRowsLocal(nextRows, {
          fileNameOverride: options.fileNameOverride,
          lastPriceRefreshAt: refreshedAtIso,
        })
        persistRows(nextRows, {
          fileNameOverride: options.fileNameOverride,
          lastPriceRefreshAt: refreshedAtIso,
          markUploaded: options.markUploaded ?? false,
        })
      }

      const cache = result.cache
      if (result.updatedRows === 0 && result.errors?.length > 0) {
        setLiveStatus('error')
        setLiveMessage(result.errors[0].error)
      } else if (result.updatedRows === 0) {
        setLiveStatus('partial')
        setLiveMessage('No Yahoo quotes matched the uploaded symbols.')
      } else if (result.missing.length > 0 || result.errors?.length > 0) {
        setLiveStatus('partial')
        setLiveMessage(`${result.updatedRows} positions refreshed; ${result.missing.length} symbols were not found on Yahoo.`)
      } else if (cache?.refreshed === 0 && cache?.hits > 0) {
        setLiveStatus('success')
        setLiveMessage(`${result.updatedRows} positions loaded from Redis cache.`)
      } else {
        setLiveStatus('success')
        setLiveMessage(`${result.updatedRows} positions updated automatically; ${cache?.hits ?? 0} came from cache.`)
      }

      return nextRows
    } catch (err) {
      setLiveStatus('error')
      setLiveMessage(`Yahoo refresh failed: ${err.message}`)
      return sourceRows
    }
  }, [persistRows, persistRowsLocal])

  useEffect(() => {
    let cancelled = false

    async function loadPortfolio() {
      if (!userId) {
        setPortfolioLoading(false)
        return
      }

      setPortfolioLoading(true)
      setError('')

      let displayedLocalPortfolio = false
      let localSaved = null

      try {
        localSaved = loadLocalPortfolio(userId)
        if (localSaved?.rows?.length) {
          displayedLocalPortfolio = true
          applySavedPortfolio(localSaved, {
            setRows,
            setFileName,
            setActiveView,
            setLastUpdatedAt,
            setLiveStatus,
            setLiveMessage,
            fileNameRef,
            message: 'Loaded saved portfolio from this browser.',
          })
          setPortfolioLoading(false)
        }

        const saved = await loadSavedPortfolioWithTimeout(userId)
        if (cancelled) return

        let portfolioToRefresh = localSaved

        if (saved?.rows?.length && shouldUseAccountPortfolio(saved, localSaved)) {
          applySavedPortfolio(saved, {
            setRows,
            setFileName,
            setActiveView,
            setLastUpdatedAt,
            setLiveStatus,
            setLiveMessage,
            fileNameRef,
          })
          setPortfolioLoading(false)
          saveLocalPortfolio(userId, saved)
          portfolioToRefresh = saved
        } else if (saved?.rows?.length && localSaved?.rows?.length) {
          persistRows(localSaved, {
            fileNameOverride: localSaved.fileName,
            lastPriceRefreshAt: localSaved.lastPriceRefreshAt,
          })
        } else if (!localSaved?.rows?.length) {
          setRows([])
          setFileName('')
          fileNameRef.current = ''
          setActiveView('upload')
          setLiveStatus('idle')
          setLiveMessage('')
          setLastUpdatedAt(null)
        }

        if (portfolioToRefresh?.rows?.length && isPriceRefreshDue(portfolioToRefresh.lastPriceRefreshAt)) {
          refreshRowsWithLivePrices(portfolioToRefresh.rows, {
            fileNameOverride: portfolioToRefresh.fileName,
          })
        }
      } catch (err) {
        if (!cancelled) {
          if (!displayedLocalPortfolio) {
            setError(`Could not load saved portfolio: ${err.message}`)
          } else if (localSaved?.rows?.length && isPriceRefreshDue(localSaved.lastPriceRefreshAt)) {
            refreshRowsWithLivePrices(localSaved.rows, {
              fileNameOverride: localSaved.fileName,
            })
          }
        }
      } finally {
        if (!cancelled) setPortfolioLoading(false)
      }
    }

    loadPortfolio()

    return () => {
      cancelled = true
    }
  }, [userId, refreshRowsWithLivePrices])

  useEffect(() => {
    if (!rows.length) return undefined

    const intervalId = window.setInterval(() => {
      if (liveStatus !== 'loading') {
        refreshRowsWithLivePrices(rows)
      }
    }, AUTO_PRICE_REFRESH_MS)

    return () => window.clearInterval(intervalId)
  }, [rows, liveStatus, refreshRowsWithLivePrices])

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    setLoading(true)
    setLoadingMsg('Analyzing with AI...')
    try {
      const parsed = await parseSpreadsheet(file)
      const parsedRows = parsed.rows ?? []
      setRows(parsedRows)
      setFileName(file.name)
      fileNameRef.current = file.name
      setActiveView(parsedRows.length > 0 ? 'overview' : 'upload')

      if (parsedRows.length > 0) {
        persistRowsLocal(parsedRows, { fileNameOverride: file.name, lastPriceRefreshAt: null })
        setLoadingMsg('Refreshing Yahoo prices...')
        await refreshRowsWithLivePrices(parsedRows, { fileNameOverride: file.name, markUploaded: true })
      } else {
        setLiveStatus('idle')
        setLiveMessage('No positions were found in the uploaded file.')
      }
    } catch (err) {
      setError(err.message)
      setLiveStatus('idle')
      setLiveMessage('')
    } finally {
      setLoading(false)
      setLoadingMsg('')
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div className="min-h-screen bg-wall-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PortfolioHeader
          fileName={fileName}
          hasData={hasData}
          liveStatus={liveStatus}
          lastUpdatedAt={lastUpdatedAt}
          onUploadClick={() => setActiveView('upload')}
        />

        <TabNav activeView={visibleView} hasData={hasData} onChange={setActiveView} />

        {portfolioLoading && <LoadingPortfolio />}

        {!portfolioLoading && visibleView === 'overview' && (
          <OverviewView
            rows={rows}
            stats={stats}
            groups={groups}
            liveStatus={liveStatus}
            liveMessage={liveMessage}
            lastUpdatedAt={lastUpdatedAt}
            onUploadClick={() => setActiveView('upload')}
          />
        )}

        {!portfolioLoading && visibleView === 'charts' && (
          <ChartsView
            rows={rows}
            stats={stats}
            groups={groups}
            liveStatus={liveStatus}
            liveMessage={liveMessage}
            lastUpdatedAt={lastUpdatedAt}
            onUploadClick={() => setActiveView('upload')}
          />
        )}

        {!portfolioLoading && visibleView === 'holdings' && (
          <HoldingsView rows={rows} groups={groups} onUploadClick={() => setActiveView('upload')} />
        )}

        {!portfolioLoading && visibleView === 'upload' && (
          <UploadView
            error={error}
            fileName={fileName}
            hasData={hasData}
            isDragging={isDragging}
            loading={loading}
            loadingMsg={loadingMsg}
            rows={rows}
            inputRef={inputRef}
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

function LoadingPortfolio() {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-wall-surface px-5 py-8 text-center">
      <div className="mx-auto mb-3 h-7 w-7 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
      <p className="text-sm font-medium text-slate-300">Loading saved portfolio</p>
      <p className="mt-1 text-xs text-slate-600">Checking your account for existing holdings.</p>
    </div>
  )
}

function PortfolioHeader({ fileName, hasData, liveStatus, lastUpdatedAt, onUploadClick }) {
  const isRefreshing = liveStatus === 'loading'

  return (
    <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100 tracking-normal">Portfolio</h1>
        <p className="text-slate-500 text-sm mt-1">
          Dashboard built from uploaded holdings and refreshed with Yahoo Finance prices.
        </p>
        {hasData && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md border border-white/[0.06] bg-wall-surface px-2.5 py-1 text-slate-400">
              Current file: <span className="text-slate-200">{fileName}</span>
            </span>
            {lastUpdatedAt && (
              <span className="rounded-md border border-white/[0.06] bg-wall-surface px-2.5 py-1 text-slate-500">
                Prices updated {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {hasData && (
          <span className={`rounded-lg border px-3 py-2 text-sm font-medium ${
            isRefreshing
              ? 'border-sky-400/20 bg-sky-400/10 text-sky-300'
              : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
          }`}>
            {isRefreshing ? 'Auto-refreshing...' : 'Auto-refresh on'}
          </span>
        )}
        <button
          type="button"
          onClick={onUploadClick}
          className="rounded-lg border border-white/[0.08] bg-wall-surface px-3 py-2 text-sm font-medium text-slate-300 hover:bg-wall-elevated hover:text-slate-100 transition-colors"
        >
          Upload file
        </button>
      </div>
    </header>
  )
}

function TabNav({ activeView, hasData, onChange }) {
  return (
    <div className="mb-6 overflow-x-auto border-b border-white/[0.06]">
      <div className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const disabled = !hasData && tab.id !== 'upload'
          const isActive = activeView === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(tab.id)}
              className={`border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-sky-400 text-slate-100'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              } ${disabled ? 'cursor-not-allowed opacity-40 hover:text-slate-500' : ''}`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function OverviewView({ rows, stats, groups, liveStatus, liveMessage, lastUpdatedAt, onUploadClick }) {
  if (!rows.length) return <EmptyState onUploadClick={onUploadClick} />

  return (
    <>
      <MarketStatusBanner
        liveStatus={liveStatus}
        liveMessage={liveMessage}
        lastUpdatedAt={lastUpdatedAt}
      />
      <KpiGrid rows={rows} stats={stats} groups={groups} />
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <AccountAllocationChart groups={groups} />
        <ValueVsBookChart stats={stats} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
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
      <MarketStatusBanner
        liveStatus={liveStatus}
        liveMessage={liveMessage}
        lastUpdatedAt={lastUpdatedAt}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <TopPositionsChart rows={rows} large />
        <AccountAllocationChart groups={groups} large />
        <ValueVsBookChart stats={stats} />
        <PnlBreakdownChart rows={rows} />
      </div>
    </>
  )
}

function KpiGrid({ rows, stats, groups }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Total Value"
        value={fmtCurrency(stats.totalMarketValue)}
        sub={`${rows.length} positions`}
      />
      <StatCard
        label="All-time P&L"
        value={fmtCurrency(stats.totalUnrealized)}
        sub={fmtPct(stats.unrealizedPct)}
        pnl={stats.totalUnrealized}
      />
      <StatCard
        label="Today's Change"
        value={fmtCurrency(stats.totalDayChange)}
        sub={fmtPct(stats.dayChangePct)}
        pnl={stats.totalDayChange}
      />
      <StatCard
        label="Accounts"
        value={String(groups.length)}
        sub={`${rows.length} total rows`}
      />
    </div>
  )
}

function MarketStatusBanner({ liveStatus, liveMessage, lastUpdatedAt }) {
  const meta = LIVE_META[liveStatus] ?? LIVE_META.idle

  return (
    <div className={`mb-6 rounded-lg border px-4 py-3 ${meta.className}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
          <div>
            <p className="text-sm font-medium">{meta.label}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {liveMessage || 'Quantities, accounts, and book values come from the uploaded file.'}
            </p>
          </div>
        </div>
        {lastUpdatedAt && (
          <span className="shrink-0 text-xs text-slate-500">
            Last quote update {lastUpdatedAt.toLocaleDateString()} {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  )
}

function UploadView({
  error,
  fileName,
  hasData,
  inputRef,
  isDragging,
  loading,
  loadingMsg,
  rows,
  onDragLeave,
  onDragOver,
  onDrop,
  onFile,
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div>
        <div
          className={`relative cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-all duration-200 sm:p-12 ${
            isDragging
              ? 'border-sky-400/70 bg-sky-400/[0.05]'
              : 'border-white/[0.08] bg-wall-surface hover:border-white/[0.16] hover:bg-wall-elevated'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.pdf"
            className="hidden"
            onChange={(e) => onFile(e.target.files[0])}
          />
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
              <p className="text-sm text-slate-300">{loadingMsg}</p>
              <p className="text-xs text-slate-600">Parsing holdings, then refreshing Yahoo prices.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                <UploadIcon />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">
                  Drop a portfolio file here
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  CSV, XLSX, XLS, or PDF
                </p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3">
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        )}
      </div>

      <aside className="space-y-3">
        <SidePanel title="Current File">
          {hasData ? (
            <>
              <p className="truncate text-sm font-medium text-slate-200" title={fileName}>{fileName}</p>
              <p className="mt-1 text-xs text-slate-500">{rows.length} positions loaded</p>
            </>
          ) : (
            <p className="text-sm text-slate-500">No file loaded yet.</p>
          )}
        </SidePanel>
        <SidePanel title="Live Prices">
          <p className="text-sm text-slate-400">
            After import, the app asks Yahoo Finance for matching symbols and updates market price, market value, day change, and unrealized P&L when quotes are found.
          </p>
        </SidePanel>
        <SidePanel title="Data Source">
          <p className="text-sm text-slate-400">
            Share counts, account numbers, and book values still come from the uploaded document.
          </p>
        </SidePanel>
      </aside>
    </div>
  )
}

function HoldingsView({ rows, groups, onUploadClick }) {
  if (!rows.length) return <EmptyState onUploadClick={onUploadClick} />

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-300">Positions</h2>
        <span className="rounded-full border border-white/[0.06] bg-wall-surface px-2.5 py-1 text-xs text-slate-600">
          {rows.length} row{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/[0.06]">
        {groups.map(([acct, acctRows], gi) => {
          const acctStats = computeStats(acctRows)
          return (
            <div key={acct} className={gi > 0 ? 'border-t border-white/[0.08]' : ''}>
              <div className="flex flex-col gap-2 border-b border-white/[0.06] bg-wall-elevated px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                  <span className="text-xs font-medium tracking-wide text-slate-400">Account {acct}</span>
                  <span className="text-xs text-slate-700">· {acctRows.length} positions</span>
                </div>
                <span className="font-mono text-xs font-medium tabular text-slate-300">
                  {fmtCurrency(acctStats.totalMarketValue)}
                </span>
              </div>

              <div className="overflow-x-auto bg-wall-surface">
                <table className="min-w-full">
                  {gi === 0 && (
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        {COLS.map((col) => (
                          <th
                            key={col.key}
                            className={`whitespace-nowrap px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-slate-600 ${
                              col.align === 'right' ? 'text-right' : 'text-left'
                            }`}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {acctRows.map((row, i) => (
                      <tr
                        key={`${acct}-${row.SYMBOL ?? 'row'}-${i}`}
                        className="border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.02]"
                      >
                        {COLS.map((col) => {
                          const { text, cls } = renderCell(col.type, row[col.key])
                          return (
                            <td
                              key={col.key}
                              className={`whitespace-nowrap px-4 py-2.5 font-mono text-sm tabular ${cls} ${
                                col.align === 'right' ? 'text-right' : 'text-left'
                              } ${col.type === 'desc' ? 'max-w-[220px] truncate font-sans' : ''}`}
                              title={col.type === 'desc' ? (row[col.key] ?? '') : undefined}
                            >
                              {text}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-2 border-t border-white/[0.06] bg-wall-elevated px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs font-medium text-slate-600">Subtotal</span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular">
                  <span className="text-slate-500">
                    Book {fmtCurrency(acctRows.reduce((s, r) => s + parseNum(r['BOOK VALUE']), 0))}
                  </span>
                  <span className={`font-medium ${pnlColor(acctStats.totalUnrealized)}`}>
                    P&L {fmtCurrency(acctStats.totalUnrealized)} ({fmtPct(acctStats.unrealizedPct)})
                  </span>
                  <span className={pnlColor(acctStats.totalDayChange)}>
                    Day {fmtCurrency(acctStats.totalDayChange)}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, pnl }) {
  const pnlCls = pnl !== undefined && pnl !== null ? pnlColor(pnl) : ''

  return (
    <div className="rounded-lg border border-white/[0.06] bg-wall-surface p-4">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`font-mono text-2xl font-semibold tabular ${pnlCls || 'text-slate-100'}`}>
        {value}
      </p>
      <p className={`mt-1.5 font-mono text-[11px] tabular ${pnlCls ? `${pnlCls} opacity-80` : 'text-slate-600'}`}>
        {sub}
      </p>
    </div>
  )
}

function ChartPanel({ title, meta, children, large = false }) {
  return (
    <section className={`rounded-lg border border-white/[0.06] bg-wall-surface p-4 ${large ? 'min-h-[360px]' : ''}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-slate-300">{title}</h2>
        {meta && <span className="font-mono text-xs tabular text-slate-600">{meta}</span>}
      </div>
      {children}
    </section>
  )
}

function AccountAllocationChart({ groups, large = false }) {
  const items = getAccountBreakdown(groups)
  const total = items.reduce((sum, item) => sum + item.value, 0)

  return (
    <ChartPanel title="Allocation By Account" meta={fmtCurrency(total)} large={large}>
      {items.length === 0 ? (
        <EmptyChart />
      ) : (
        <>
          <div className="mb-5 flex h-3 overflow-hidden rounded-full bg-white/[0.05]">
            {items.map((item) => (
              <div
                key={item.account}
                style={{ width: `${pct(item.value, total)}%`, backgroundColor: item.color }}
                className="h-full"
                title={`${item.account}: ${fmtCurrency(item.value)}`}
              />
            ))}
          </div>
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.account} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-300">Account {item.account}</p>
                    <p className="text-xs text-slate-600">{item.positions} positions</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm tabular text-slate-200">{fmtCurrency(item.value)}</p>
                  <p className="font-mono text-xs tabular text-slate-600">{pct(item.value, total).toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </ChartPanel>
  )
}

function TopPositionsChart({ rows, large = false }) {
  const items = getTopPositions(rows, large ? 10 : 6)
  const max = Math.max(...items.map((item) => item.value), 0)
  const total = rows.reduce((sum, row) => sum + parseNum(row['MARKET VALUE']), 0)

  return (
    <ChartPanel title="Top Positions" meta={`${items.length} shown`} large={large}>
      {items.length === 0 ? (
        <EmptyChart />
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={`${item.symbol}-${item.index}`}>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-semibold text-slate-100">{item.symbol}</p>
                  {item.description && <p className="truncate text-xs text-slate-600">{item.description}</p>}
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm tabular text-slate-200">{fmtCurrency(item.value)}</p>
                  <p className={`font-mono text-xs tabular ${pnlColor(item.pnl)}`}>{fmtCurrency(item.pnl)}</p>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: barWidth(item.value, max),
                    backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                  }}
                />
              </div>
              <p className="mt-1 font-mono text-[11px] tabular text-slate-700">
                {pct(item.value, total).toFixed(1)}% of portfolio
              </p>
            </div>
          ))}
        </div>
      )}
    </ChartPanel>
  )
}

function ValueVsBookChart({ stats }) {
  const max = Math.max(stats.totalMarketValue, stats.totalBookValue)
  const spread = stats.totalMarketValue - stats.totalBookValue

  return (
    <ChartPanel title="Value Vs Book" meta={fmtCurrency(spread)}>
      <div className="space-y-5">
        <ValueBar label="Market value" value={stats.totalMarketValue} max={max} color="#38bdf8" />
        <ValueBar label="Book value" value={stats.totalBookValue} max={max} color="#f59e0b" />
      </div>
      <div className="mt-6 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">Spread</span>
          <span className={`font-mono text-sm tabular ${pnlColor(spread)}`}>{fmtCurrency(spread)}</span>
        </div>
      </div>
    </ChartPanel>
  )
}

function ValueBar({ label, value, max, color }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-slate-400">{label}</span>
        <span className="font-mono text-sm tabular text-slate-200">{fmtCurrency(value)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-white/[0.05]">
        <div className="h-full rounded-full" style={{ width: barWidth(value, max), backgroundColor: color }} />
      </div>
    </div>
  )
}

function PnlBreakdownChart({ rows }) {
  const buckets = getPnlBuckets(rows)
  const max = Math.max(...buckets.map((bucket) => bucket.value), 1)

  return (
    <ChartPanel title="P&L Breakdown" meta={`${rows.length} positions`}>
      <div className="space-y-4">
        {buckets.map((bucket) => (
          <div key={bucket.id}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm text-slate-400">{bucket.label}</span>
              <span className="font-mono text-sm tabular text-slate-200">
                {bucket.count} / {fmtCurrency(bucket.value)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
              <div
                className="h-full rounded-full"
                style={{
                  width: bucket.value > 0 ? barWidth(bucket.value, max) : bucket.count > 0 ? '8%' : '0%',
                  backgroundColor: bucket.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </ChartPanel>
  )
}

function SidePanel({ title, children }) {
  return (
    <section className="rounded-lg border border-white/[0.06] bg-wall-surface p-4">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-600">{title}</h2>
      {children}
    </section>
  )
}

function EmptyState({ onUploadClick }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-wall-surface px-5 py-8 text-center">
      <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
        <UploadIcon />
      </div>
      <p className="text-sm font-medium text-slate-200">Upload a portfolio file to build the dashboard.</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-600">
        CSV, Excel, and PDF files are parsed into holdings, then matched against Yahoo Finance quotes.
      </p>
      <button
        type="button"
        onClick={onUploadClick}
        className="mt-4 rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-sm font-medium text-sky-300 hover:bg-sky-400/15"
      >
        Go to upload
      </button>
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02]">
      <p className="text-sm text-slate-600">No chart data available.</p>
    </div>
  )
}

function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}
