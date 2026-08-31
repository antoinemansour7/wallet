import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseSpreadsheet } from '../utils/parseSpreadsheet'
import { enrichRowsWithLivePrices } from '../utils/livePrices'
import { loadLocalPortfolio, loadSavedPortfolioWithTimeout, savePortfolio } from '../utils/portfolioStorage'
import { recordIntradayPoint, saveDailySnapshot } from '../utils/portfolioHistory'
import { useAuth } from '../context/AuthContext'
import Reveal from '../components/Reveal'
import { buildAccountPortfolio, flattenAccountRows, getAccountEntries, hasAccountPortfolio } from '../utils/accountPortfolio'
import { applyMerge, previewMerge, sourceIdFor } from '../utils/accountMerge'
import { computeStats } from '../utils/portfolioStats'
import { AUTO_PRICE_REFRESH_MS } from './portfolio/constants'
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
import AddAccountView from './portfolio/AddAccountView'
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
  const [activeView, setActiveView]       = useState('add')
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
  const visibleView = hasData ? activeView : 'add'

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
      // Only warn about something a person can act on: a holding with no price.
      // This used to escalate on `errors.length` too, so a recoverable provider
      // hiccup that cost nothing raised a warning banner reading "14 positions
      // refreshed; 0 symbols not found" — an announcement that nothing happened.
      if (result.updatedRows === 0 && result.errors?.length > 0) {
        setLiveStatus('error'); setLiveMessage(result.errors[0].error)
      } else if (result.updatedRows === 0) {
        setLiveStatus('partial'); setLiveMessage('No market data matched your holdings.')
      } else if (result.missing.length > 0) {
        // Name them — "2 symbols not found" is not actionable, "SHOP.TO" is.
        const shown = result.missing.slice(0, 4).join(', ')
        const rest = result.missing.length - 4
        setLiveStatus('partial')
        setLiveMessage(
          `No price for ${shown}${rest > 0 ? ` and ${rest} more` : ''}. `
          + 'Those positions show their last saved value; everything else is current.',
        )
      } else {
        // Nothing to report. The quiet timestamp line carries it from here.
        setLiveStatus('success'); setLiveMessage('')
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
    setLoadingMsg('Reading your statement…')
    try {
      const parsed = await parseSpreadsheet(file)
      stageStatement({
        name: file.name, kind: 'file',
        rows: parsed.rows ?? [], cashEntries: parsed.cashEntries ?? [],
      })
    } catch (err) {
      setError(err.message)
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

  // ── Adding an account ──────────────────────────────────────────────────────
  // A statement is staged rather than applied. Nothing touches the portfolio
  // until the merge has been previewed and confirmed, which is what makes
  // "add this to my existing TFSA" a safe thing to do.
  const [pending, setPending] = useState(null)
  const [preview, setPreview] = useState(null)
  const [merging, setMerging] = useState(false)

  const stageStatement = useCallback(({ name, kind, rows: incoming, cashEntries }) => {
    if (incoming.length === 0 && cashEntries.length === 0) {
      setError('No holdings found in that statement.')
      return
    }
    setError('')
    setPreview(null)
    setPending({
      name,
      rows: incoming,
      cashEntries,
      sourceId: sourceIdFor({ kind, name }),
      // What the file called the account, offered as the name for a new one.
      suggestedAccountNumber: String(incoming[0]?.['ACCOUNT NUMBER'] ?? name).trim() || name,
    })
  }, [])

  const handleChooseDestination = useCallback((destination) => {
    if (!pending) return
    setPreview({
      ...previewMerge({
        accounts,
        accountNumber: destination.accountNumber,
        sourceId: pending.sourceId,
        rows: pending.rows,
      }),
      destination,
    })
  }, [accounts, pending])

  const handleCancelMerge = useCallback(() => {
    setPending(null)
    setPreview(null)
    setError('')
  }, [])

  const handleConfirmMerge = useCallback(async () => {
    if (!pending || !preview) return
    setMerging(true)
    try {
      const cashForAccount = pending.cashEntries.length > 0
        ? pending.cashEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
        : null

      const nextAccounts = applyMerge({
        accounts,
        accountNumber: preview.accountNumber,
        sourceId: pending.sourceId,
        rows: pending.rows,
        cash: cashForAccount,
      })
      const nextRows = flattenAccountRows(nextAccounts)
      setAccounts(nextAccounts)
      setRows(nextRows)
      setFileName(pending.name)
      setPending(null)
      setPreview(null)
      setActiveView('overview')

      if (nextRows.length > 0) {
        setLoadingMsg('Fetching live prices…')
        await refreshRowsWithLivePrices(nextRows, { previousAccounts: nextAccounts })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setMerging(false)
      setLoadingMsg('')
    }
  }, [accounts, pending, preview, refreshRowsWithLivePrices])

  const handlePlaidConnecting = useCallback(() => {
    setLoading(true)
    setLoadingMsg('Connecting to your brokerage…')
  }, [])

  const handlePlaidSuccess = useCallback((holdingsData, institutionName, err) => {
    setLoading(false)
    setLoadingMsg('')
    if (err || !holdingsData) {
      setError(err?.message || 'Failed to connect brokerage')
      return
    }
    // A connection is staged and previewed exactly like a file, so choosing
    // the destination account is the same decision either way.
    stageStatement({
      name: institutionName || 'Connected brokerage',
      kind: 'plaid',
      rows: holdingsData.rows || [],
      cashEntries: holdingsData.cashEntries || [],
    })
  }, [stageStatement])
  const onDrop = (e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }

  return (
    <div className="relative min-h-screen overflow-hidden bg-wall-bg">
      <div className="glow-orb blob-drift absolute -top-64 left-1/3 h-[560px] w-[560px]" />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
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
        {visibleView === 'overview' && !stats && <EmptyState onUploadClick={() => setActiveView('add')} />}

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
        {visibleView === 'charts' && !stats && <EmptyState onUploadClick={() => setActiveView('add')} />}

        {visibleView === 'holdings' && (
          <HoldingsView rows={rows} accounts={accountEntries} onUploadClick={() => setActiveView('add')} />
        )}
        {visibleView === 'trade' && (
          <TradeView rows={rows} />
        )}
        {visibleView === 'add' && (
          <AddAccountView
            accounts={accountEntries}
            error={error}
            loading={loading}
            loadingMsg={loadingMsg}
            inputRef={inputRef}
            isDragging={isDragging}
            userId={uid}
            pending={pending}
            preview={preview}
            busy={merging}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onFile={handleFile}
            onPlaidSuccess={handlePlaidSuccess}
            onPlaidConnecting={handlePlaidConnecting}
            onChooseDestination={handleChooseDestination}
            onConfirm={handleConfirmMerge}
            onCancel={handleCancelMerge}
          />
        )}      </div>
    </div>
  )
}
