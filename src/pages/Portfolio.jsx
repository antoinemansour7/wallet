import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseSpreadsheet } from '../utils/parseSpreadsheet'
import { enrichRowsWithLivePrices } from '../utils/livePrices'
import { loadLocalPortfolio, loadSavedPortfolioWithTimeout, savePortfolio } from '../utils/portfolioStorage'
import { recordIntradayPoint, saveDailySnapshot } from '../utils/portfolioHistory'
import { useAuth } from '../context/AuthContext'
import Reveal from '../components/Reveal'
import { buildAccountPortfolio, getAccountEntries, hasAccountPortfolio } from '../utils/accountPortfolio'
import { computeStats } from '../utils/portfolioStats'
import { AUTO_PRICE_REFRESH_MS } from './portfolio/constants'
import PortfolioHeader from './portfolio/PortfolioHeader'
import TabNav from './portfolio/TabNav'
import KpiGrid from './portfolio/KpiGrid'
import LiveBanner from './portfolio/LiveBanner'
import AccountAllocationChart from './portfolio/AccountAllocationChart'
import TopPositionsChart from './portfolio/TopPositionsChart'
import ValueVsBookChart from './portfolio/ValueVsBookChart'
import PnlBreakdownChart from './portfolio/PnlBreakdownChart'
import PerformanceChart from './portfolio/PerformanceChart'
import AllocationDonut from './portfolio/AllocationDonut'
import HoldingsView from './portfolio/HoldingsView'
import UploadView from './portfolio/UploadView'
import EmptyState from './portfolio/EmptyState'
import TradeView from './portfolio/TradeView'

export default function Portfolio() {
  const [rows, setRows]                   = useState([])
  const [accounts, setAccounts]           = useState({})
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

  const accountEntries = useMemo(() => (
    getAccountEntries(accounts).map((account) => ({
      ...account,
      stats: computeStats(account.positions, { cashValue: account.cash, realizedPnl: account.realizedPnl }),
    }))
  ), [accounts])
  const totalCashValue = useMemo(() => accountEntries.reduce((sum, account) => sum + account.cash, 0), [accountEntries])
  const totalRealizedPnl = useMemo(() => accountEntries.reduce((sum, account) => sum + account.realizedPnl, 0), [accountEntries])
  const hasData     = rows.length > 0 || hasAccountPortfolio(accounts)
  const stats       = useMemo(() => (
    hasData
      ? computeStats(rows, { cashValue: totalCashValue, realizedPnl: totalRealizedPnl })
      : null
  ), [hasData, rows, totalCashValue, totalRealizedPnl])
  const visibleView = hasData ? activeView : 'upload'

  const applyPortfolioRows = useCallback((nextRows, {
    previousAccounts = accounts,
    cashEntries = [],
  } = {}) => {
    const nextAccounts = buildAccountPortfolio({
      rows: nextRows,
      previousAccounts,
      cashEntries,
    })
    setRows(nextRows)
    setAccounts(nextAccounts)
    return nextAccounts
  }, [accounts])

  useEffect(() => {
    if (!uid) return
    const local = loadLocalPortfolio(uid)
    const applySaved = (saved) => {
      if (!saved) return
      setRows(saved.rows ?? [])
      setAccounts(saved.accounts ?? {})
      setFileName(saved.fileName || '')
      const priceTime = saved.lastPriceRefreshAt ? new Date(saved.lastPriceRefreshAt).getTime() : 0
      setLastUpdatedAt(priceTime ? new Date(priceTime) : null)
      lastRefreshRef.current = 0
      setActiveView('overview')
    }

    if (local) applySaved(local)

    const localUpdatedAt = local?.updatedAt ? new Date(local.updatedAt).getTime() : 0
    const remoteTimeoutMs = local ? 2500 : 10000

    loadSavedPortfolioWithTimeout(uid, remoteTimeoutMs)
      .then((saved) => {
        if (!saved) return
        const remoteUpdatedAt = saved.updatedAt ? new Date(saved.updatedAt).getTime() : 0
        if (!local || remoteUpdatedAt >= localUpdatedAt) applySaved(saved)
      })
      .catch(() => {})
  }, [uid])

  useEffect(() => {
    if (!uid || !fileName || !hasData) return
    const timer = setTimeout(() => {
      savePortfolio(uid, {
        fileName,
        rows,
        accounts,
        lastPriceRefreshAt: lastUpdatedAt,
      }).then(() => console.log('[portfolio] saved to Firestore'))
        .catch((err) => console.error('[portfolio] Firestore save failed:', err.message))
    }, 1000)
    return () => clearTimeout(timer)
  }, [accounts, fileName, hasData, lastUpdatedAt, rows, uid])

  // Record daily snapshot + intraday point for the performance chart
  useEffect(() => {
    if (!uid || !stats) return
    saveDailySnapshot(uid, stats).catch(() => {})
    recordIntradayPoint(stats)
  }, [uid, stats])

  const refreshRowsWithLivePrices = useCallback(async (sourceRows, options = {}) => {
    if (!sourceRows.length) {
      applyPortfolioRows(sourceRows, options)
      setLiveStatus('idle')
      setLiveMessage('')
      return sourceRows
    }
    // Phase 1 — instant paint from the Redis quote cache (no blocking live
    // fetch). Only on the first refresh of a session, so the auto-refresh
    // interval never repaints stale over already-live numbers.
    const isFirstRefresh = lastRefreshRef.current === 0
    if (isFirstRefresh || options.instant) {
      try {
        const cached = await enrichRowsWithLivePrices(sourceRows, { cachedOnly: true })
        if (cached.updatedRows > 0) applyPortfolioRows(cached.rows, options)
      } catch { /* fall through to the live fetch */ }
    }

    setLiveStatus('loading')
    setLiveMessage('Refreshing current prices from market data providers…')
    try {
      const result   = await enrichRowsWithLivePrices(sourceRows)
      const nextRows = result.rows
      applyPortfolioRows(nextRows, options)
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
        setLiveMessage(`${result.updatedRows} positions updated`)
      }
      return nextRows
    } catch (err) {
      applyPortfolioRows(sourceRows, options)
      setLiveStatus('error'); setLiveMessage(`Price refresh failed: ${err.message}`)
      return sourceRows
    }
  }, [applyPortfolioRows])

  const lastRefreshRef = useRef(0)
  useEffect(() => { if (liveStatus === 'success' || liveStatus === 'partial') lastRefreshRef.current = Date.now() }, [liveStatus])

  useEffect(() => {
    if (!rows.length) return undefined
    const CHECK_MS = 30_000
    const tryRefresh = () => {
      if (liveStatus === 'loading') return
      if (Date.now() - lastRefreshRef.current >= AUTO_PRICE_REFRESH_MS) {
        refreshRowsWithLivePrices(rows, { previousAccounts: accounts })
      }
    }
    const id = window.setInterval(tryRefresh, CHECK_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') tryRefresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [accounts, rows, liveStatus, refreshRowsWithLivePrices])

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    setLoading(true)
    setLoadingMsg('Analyzing with AI…')
    try {
      const parsed     = await parseSpreadsheet(file)
      const parsedRows = parsed.rows ?? []
      const cashEntries = parsed.cashEntries ?? []
      const nextAccounts = applyPortfolioRows(parsedRows, {
        previousAccounts: accounts,
        cashEntries,
      })
      setFileName(file.name)
      setActiveView(parsedRows.length > 0 || cashEntries.length > 0 ? 'overview' : 'upload')
      if (parsedRows.length > 0) {
        setLoadingMsg('Fetching live prices…')
        await refreshRowsWithLivePrices(parsedRows, {
          previousAccounts: nextAccounts,
          cashEntries,
        })
      } else if (cashEntries.length > 0) {
        setLiveStatus('success')
        setLiveMessage('Cash balances imported from the uploaded file.')
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

  const handleCashOverride = useCallback((newCashTotal) => {
    setAccounts((prev) => {
      const keys = Object.keys(prev)
      if (keys.length === 0) return prev
      const next = { ...prev }
      if (keys.length === 1) {
        const k = keys[0]
        next[k] = { ...next[k], cash: newCashTotal, cashSource: 'explicit' }
      } else {
        const oldTotal = keys.reduce((sum, k) => sum + (prev[k].cash || 0), 0)
        const diff = newCashTotal - oldTotal
        const k = keys[0]
        next[k] = { ...next[k], cash: Math.round(((next[k].cash || 0) + diff) * 100) / 100, cashSource: 'explicit' }
      }
      return next
    })
  }, [])

  const handlePlaidConnecting = useCallback(() => {
    setLoading(true)
    setLoadingMsg('Connecting to your brokerage…')
  }, [])

  const handlePlaidSuccess = useCallback(async (holdingsData, institutionName, err) => {
    if (err || !holdingsData) {
      setError(err?.message || 'Failed to connect brokerage')
      setLoading(false)
      setLoadingMsg('')
      return
    }
    try {
      const plaidRows = holdingsData.rows || []
      const cashEntries = holdingsData.cashEntries || []
      if (plaidRows.length === 0 && cashEntries.length === 0) {
        setError('No holdings found in the connected account.')
        setLoading(false)
        setLoadingMsg('')
        return
      }
      const nextAccounts = applyPortfolioRows(plaidRows, { previousAccounts: accounts, cashEntries })
      setFileName(`${institutionName || 'Plaid'} (connected)`)
      setActiveView('overview')
      if (plaidRows.length > 0) {
        setLoadingMsg('Fetching live prices…')
        await refreshRowsWithLivePrices(plaidRows, { previousAccounts: nextAccounts, cashEntries })
      } else {
        setLiveStatus('success')
        setLiveMessage('Cash balances imported from connected account.')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }, [accounts, applyPortfolioRows, refreshRowsWithLivePrices])

  const onDrop = (e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }

  return (
    <div className="relative min-h-screen overflow-hidden bg-wall-bg">
      <div className="glow-orb blob-drift absolute -top-64 left-1/3 h-[560px] w-[560px]" />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <PortfolioHeader fileName={fileName} hasData={hasData} lastUpdatedAt={lastUpdatedAt} />
        <TabNav activeView={visibleView} hasData={hasData} onChange={setActiveView} />

        {visibleView === 'overview' && stats && (
          <>
            <LiveBanner liveStatus={liveStatus} liveMessage={liveMessage} lastUpdatedAt={lastUpdatedAt} />
            <Reveal>
              <PerformanceChart hero stats={stats} rows={rows} />
            </Reveal>
            <KpiGrid rows={rows} stats={stats} accounts={accountEntries} onCashOverride={handleCashOverride} />
            <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <Reveal><TopPositionsChart rows={rows} /></Reveal>
              <Reveal delay={80}><AccountAllocationChart accounts={accountEntries} /></Reveal>
            </div>
          </>
        )}
        {visibleView === 'overview' && !stats && <EmptyState onUploadClick={() => setActiveView('upload')} />}

        {visibleView === 'charts' && stats && (
          <>
            <LiveBanner liveStatus={liveStatus} liveMessage={liveMessage} lastUpdatedAt={lastUpdatedAt} />
            <Reveal><AllocationDonut rows={rows} stats={stats} /></Reveal>
            <div className="mt-8 grid gap-4 lg:grid-cols-2">
              <Reveal><ValueVsBookChart stats={stats} /></Reveal>
              <Reveal delay={80}><PnlBreakdownChart rows={rows} /></Reveal>
            </div>
          </>
        )}
        {visibleView === 'charts' && !stats && <EmptyState onUploadClick={() => setActiveView('upload')} />}

        {visibleView === 'holdings' && (
          <HoldingsView rows={rows} accounts={accountEntries} onUploadClick={() => setActiveView('upload')} />
        )}
        {visibleView === 'trade' && (
          <TradeView rows={rows} />
        )}
        {visibleView === 'upload' && (
          <UploadView
            error={error} fileName={fileName} hasData={hasData} isDragging={isDragging}
            loading={loading} loadingMsg={loadingMsg} rows={rows} inputRef={inputRef}
            userId={uid}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onFile={handleFile}
            onPlaidSuccess={handlePlaidSuccess}
            onPlaidConnecting={handlePlaidConnecting}
          />
        )}
      </div>
    </div>
  )
}
