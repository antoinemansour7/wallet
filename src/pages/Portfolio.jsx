import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseSpreadsheet } from '../utils/parseSpreadsheet'
import { enrichRowsWithLivePrices } from '../utils/livePrices'
import { clearPortfolio, loadLocalPortfolio, loadSavedPortfolioWithTimeout, savePortfolio } from '../utils/portfolioStorage'
import { recordIntradayPoint, saveDailySnapshot } from '../utils/portfolioHistory'
import { callPlaid } from '../utils/plaidClient'
import { useAuth } from '../context/AuthContext'
import ErrorBoundary, { PanelFallback } from '../components/ErrorBoundary'
import { buildAccountPortfolio, cashEntryAmount, flattenAccountRows, getAccountEntries, hasAccountPortfolio } from '../utils/accountPortfolio'
import { PLAID_ACCOUNT_KEY, PLAID_ITEM_KEY, applyMerge, applyMergeByAccount, previewMerge, sourceIdFor } from '../utils/accountMerge'
import { importAccountSummary, planAccountRemoval, prepareImportRows } from '../utils/accountManagement'
import { computeStats, fmtCurrency } from '../utils/portfolioStats'
import { portfolioWithholding } from './portfolio/accountPresentation'
import { fetchSecurityReference, symbolsToResolve } from '../utils/securityReference'
import { loadTransactions, loadHistoryStarts } from '../utils/transactionStore'
import { summarizeFundFees } from '../utils/fundFees'
import { AUTO_PRICE_REFRESH_MS } from './portfolio/constants'
import TabNav from './portfolio/TabNav'
import StatRail from './portfolio/StatRail'
import LiveBanner from './portfolio/LiveBanner'
import CompositionPanel from './portfolio/CompositionPanel'
import PerformanceChart from './portfolio/PerformanceChart'
import ChartsView from './portfolio/ChartsView'
import { IS_PREVIEW, previewPlaidHoldings } from '../preview/mockMode'
import HoldingsView from './portfolio/HoldingsView'
import AccountsView from './portfolio/AccountsView'
import AccountDetailModal from './portfolio/AccountDetailModal'
import AddAccountModal from './portfolio/AddAccountModal'
import EmptyState from './portfolio/EmptyState'

export default function Portfolio() {
  const [rows, setRows]                   = useState([])
  const [accounts, setAccounts]           = useState({})
  const [fileName, setFileName]           = useState('')
  const [error, setError]                 = useState('')
  const [loading, setLoading]             = useState(false)
  const [loadingMsg, setLoadingMsg]       = useState('')
  const [isDragging, setIsDragging]       = useState(false)
  const [addMode, setAddMode]             = useState(null)
  const [activeView, setActiveView]       = useState('add')
  const [liveStatus, setLiveStatus]       = useState('idle')
  const [liveMessage, setLiveMessage]     = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const inputRef = useRef(null)
  const structureVersion = useRef(0)
  const mutationBusy = useRef(false)
  const draftConnection = useRef(null)

  const { user } = useAuth()
  const uid = user?.uid

  const accountEntries = useMemo(() => (
    getAccountEntries(accounts).map((account) => ({
      ...account,
      stats: computeStats(account.positions, { cashValue: account.cash, realizedPnl: account.realizedPnl }),
    }))
  ), [accounts])
  // Reference data and the ledger both arrive after the first paint. Until
  // they do, the tax figures render from holdings alone and say they are
  // projections — which is what they are, so nothing has to be hidden while
  // the lookups are in flight.
  const [reference, setReference] = useState({})
  const [ledger, setLedger] = useState({ transactions: [], historyStarts: {} })

  const symbolKey = useMemo(() => symbolsToResolve(rows).sort().join(','), [rows])
  useEffect(() => {
    if (!symbolKey) return undefined
    let cancelled = false
    fetchSecurityReference(symbolKey.split(','))
      .then((resolved) => { if (!cancelled) setReference(resolved) })
    return () => { cancelled = true }
  }, [symbolKey])

  useEffect(() => {
    if (!uid) return undefined
    let cancelled = false
    Promise.all([loadTransactions(uid), loadHistoryStarts(uid)])
      .then(([transactions, historyStarts]) => { if (!cancelled) setLedger({ transactions, historyStarts }) })
    return () => { cancelled = true }
  }, [uid])

  const portfolioDrag = useMemo(
    () => portfolioWithholding(accountEntries, { reference, transactions: ledger.transactions, historyStarts: ledger.historyStarts }),
    [accountEntries, reference, ledger],
  )
  const fundFees = useMemo(() => summarizeFundFees(rows, reference), [rows, reference])
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
      if (!saved || structureVersion.current > 0) return
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
      if (mutationBusy.current) return
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
    const version = structureVersion.current
    const current = () => version === structureVersion.current
    if (mutationBusy.current) return sourceRows
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
        if (current() && cached.updatedRows > 0) applyPortfolioRows(cached.rows, options)
      } catch { /* fall through to the live fetch */ }
    }

    if (!current()) return sourceRows
    setLiveStatus('loading')
    setLiveMessage('Refreshing current prices from market data providers…')
    try {
      const result   = await enrichRowsWithLivePrices(sourceRows)
      const nextRows = result.rows
      if (!current()) return sourceRows
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
      if (!current()) return sourceRows
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
      if (liveStatus === 'loading' || mutationBusy.current) return
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
  const [addOpen, setAddOpen] = useState(false)
  const [pending, setPending] = useState(null)
  // Accounts Plaid returned, awaiting the user's pick. Held separately from
  // `pending` because nothing has been fetched yet — this is the step before.
  const [discovered, setDiscovered] = useState(null)
  const [openAccount, setOpenAccount] = useState(null)
  const [removing, setRemoving] = useState(false)
  const [preview, setPreview] = useState(null)
  const [merging, setMerging] = useState(false)

  const [completed, setCompleted] = useState(null)
  const [accountNotice, setAccountNotice] = useState('')
  const [removalError, setRemovalError] = useState('')

  const stageStatement = useCallback(({ name, kind, rows: incoming = [], cashEntries = [], connection = null }) => {
    if (!incoming.length && !cashEntries.length) {
      setError(kind === 'plaid' ? 'No holdings or cash balances were returned. Choose another account or try a statement.' : 'No holdings or cash balances were found in this statement.')
      return false
    }
    setError('')
    setPreview(null)
    const rows = prepareImportRows(incoming)
    const knownAccounts = importAccountSummary(rows, cashEntries, kind === 'plaid')
    setPending({
      name, kind, rows, knownAccounts, cashEntries, connection,
      sourceId: sourceIdFor({ kind, name }),
      suggestedAccountNumber: String(rows[0]?.['ACCOUNT NUMBER'] || cashEntries[0]?.accountNumber || name).trim() || name,
    })
    return true
  }, [])

  const handleChooseDestination = useCallback((destination) => {
    if (!pending || pending.knownAccounts?.length) return
    setPreview({ ...previewMerge({ accounts, accountNumber: destination.accountNumber, sourceId: pending.sourceId, rows: pending.rows }), destination })
  }, [accounts, pending])

  const openAdd = useCallback((mode) => {
    setAddMode(typeof mode === 'string' ? mode : null)
    setPending(null)
    setPreview(null)
    setDiscovered(null)
    setCompleted(null)
    setError('')
    setAddOpen(true)
  }, [])

  const closeAdd = useCallback(async () => {
    if (loading || merging) return
    // An exchanged token is a real connection even before holdings are saved.
    // Canceling the review must retire that unfinished connection as well.
    if (draftConnection.current && !IS_PREVIEW) {
      setLoading(true)
      setLoadingMsg('Closing the connection…')
      try {
        const response = await callPlaid({ action: 'disconnect', userId: uid, itemId: draftConnection.current.itemId })
        if (!response.ok && response.status !== 404) throw new Error('We couldn’t close this connection. Please try closing it again.')
      } catch (err) {
        setError(err.message || 'We couldn’t close this connection. Please try again.')
        return
      } finally { setLoading(false); setLoadingMsg('') }
    }
    draftConnection.current = null
    setAddOpen(false)
    setAddMode(null)
    setPending(null)
    setPreview(null)
    setDiscovered(null)
    setCompleted(null)
    setError('')
  }, [loading, merging, uid])

  const handleCancelMerge = useCallback(() => {
    if (pending?.kind === 'plaid' && draftConnection.current) setDiscovered(draftConnection.current)
    setPending(null)
    setPreview(null)
    setError('')
  }, [pending])

  const handleConfirmMerge = useCallback(async () => {
    if (!pending || !uid || mutationBusy.current || (!preview && !pending.knownAccounts?.length)) return
    mutationBusy.current = true
    structureVersion.current += 1
    setMerging(true)
    setError('')
    try {
      const cashByAccount = {}
      const currencyByAccount = {}
      for (const entry of pending.cashEntries) {
        if (!entry.accountNumber) continue
        cashByAccount[entry.accountNumber] = Math.round(((cashByAccount[entry.accountNumber] || 0) + cashEntryAmount(entry)) * 100) / 100
        currencyByAccount[entry.accountNumber] = entry.currency || ''
      }
      const sourceMetadataByAccount = {}
      if (pending.connection) {
        for (const account of pending.knownAccounts) {
          const rows = pending.rows.filter((row) => row['ACCOUNT NUMBER'] === account.accountNumber)
          const cash = pending.cashEntries.filter((entry) => entry.accountNumber === account.accountNumber)
          sourceMetadataByAccount[account.accountNumber] = {
            plaidItemId: pending.connection.itemId,
            plaidAccountIds: [...new Set([...rows, ...cash].map((row) => row[PLAID_ACCOUNT_KEY]).filter(Boolean))],
          }
        }
      }
      const nextAccounts = pending.knownAccounts?.length
        ? applyMergeByAccount({ accounts, sourceId: pending.sourceId, rows: pending.rows, cashByAccount, currencyByAccount, sourceMetadataByAccount })
        : applyMerge({ accounts, accountNumber: preview.accountNumber, sourceId: pending.sourceId, rows: pending.rows, cash: pending.cashEntries.length ? pending.cashEntries.reduce((sum, entry) => sum + cashEntryAmount(entry), 0) : null, currency: pending.cashEntries[0]?.currency || '' })
      const nextRows = flattenAccountRows(nextAccounts)
      await savePortfolio(uid, { fileName: pending.name, rows: nextRows, accounts: nextAccounts, lastPriceRefreshAt: lastUpdatedAt })
      setAccounts(nextAccounts)
      setRows(nextRows)
      setFileName(pending.name)
      setCompleted({ count: pending.knownAccounts?.length || 1, name: pending.name })
      draftConnection.current = null
      setPending(null)
      setPreview(null)
      setDiscovered(null)
      setActiveView('add')
      setLiveStatus('idle')
      mutationBusy.current = false
      if (nextRows.length) void refreshRowsWithLivePrices(nextRows, { previousAccounts: nextAccounts })
    } catch (err) {
      setError(err.message || 'The accounts couldn’t be saved. Please try again.')
    } finally {
      mutationBusy.current = false
      setMerging(false)
      setLoadingMsg('')
    }
  }, [accounts, pending, preview, refreshRowsWithLivePrices, uid, lastUpdatedAt])

  const handlePlaidConnecting = useCallback(() => {
    setError('')
    setLoading(true)
    setLoadingMsg('Connecting to your brokerage…')
  }, [])

  const removeFromPortfolio = useCallback(async (accountNumber, sourceId) => {
    if (!uid || mutationBusy.current) return false
    mutationBusy.current = true
    structureVersion.current += 1
    setRemoving(true)
    setRemovalError('')
    try {
      const { nextAccounts, operations } = planAccountRemoval({ accounts, accountNumber, sourceId })
      if (!IS_PREVIEW) {
        for (const operation of operations) {
          if (operation.action === 'keep-connection') continue
          const response = await callPlaid({ ...operation, userId: uid })
          if (!response.ok && !(operation.action === 'disconnect' && response.status === 404)) {
            throw new Error('The brokerage connection couldn’t be updated. Your account is still here. Please try again.')
          }
        }
      }
      const nextRows = flattenAccountRows(nextAccounts)
      const empty = !hasAccountPortfolio(nextAccounts)
      if (empty) await clearPortfolio(uid)
      else await savePortfolio(uid, { fileName, rows: nextRows, accounts: nextAccounts, lastPriceRefreshAt: lastUpdatedAt })
      setAccounts(nextAccounts)
      setRows(nextRows)
      setOpenAccount(nextAccounts[accountNumber] || null)
      setActiveView('add')
      setAccountNotice(sourceId ? 'The import was removed from your portfolio.' : `Account ${accountNumber} was removed from your portfolio.`)
      setLiveStatus('idle')
      if (empty) setFileName('')
      return true
    } catch (err) {
      setRemovalError(err.message || 'The account couldn’t be removed. Please try again.')
      return false
    } finally {
      mutationBusy.current = false
      setRemoving(false)
    }
  }, [accounts, fileName, lastUpdatedAt, uid])

  const handleRemoveSource = useCallback((accountNumber, sourceId) => removeFromPortfolio(accountNumber, sourceId), [removeFromPortfolio])
  const handleRemoveAccount = useCallback((accountNumber) => removeFromPortfolio(accountNumber), [removeFromPortfolio])

  const handlePlaidError = useCallback((err) => {
    setLoading(false)
    setLoadingMsg('')
    setError(err?.message || 'We couldn’t connect your brokerage. Please try again.')
  }, [])

  const handlePlaidAccounts = useCallback((found) => {
    draftConnection.current = found
    setLoading(false)
    setLoadingMsg('')
    setError('')
    setDiscovered(found)
  }, [])

  const handleImportDiscovered = useCallback(async (accountIds) => {
    if (!discovered || !uid || merging || !accountIds.length) return
    setMerging(true)
    setError('')
    try {
      let data
      if (IS_PREVIEW) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        data = previewPlaidHoldings(accountIds)
      } else {
        const selection = await callPlaid({ action: 'select-accounts', userId: uid, itemId: discovered.itemId, accountIds })
        if (!selection.ok) throw new Error('We couldn’t save your selection. Please try again.')
        const response = await callPlaid({ action: 'holdings', userId: uid, itemId: discovered.itemId })
        data = await response.json()
        if (!response.ok || data.errors?.length) throw new Error('Some account details couldn’t be loaded. Please try again before adding them.')
      }
      const connection = { ...discovered, enabledAccountIds: accountIds }
      draftConnection.current = connection
      const staged = stageStatement({ name: discovered.institutionName || 'Connected brokerage', kind: 'plaid', rows: (data.rows || []).map((row) => ({ ...row, [PLAID_ITEM_KEY]: discovered.itemId })), cashEntries: data.cashEntries || [], connection })
      if (staged) setDiscovered(null)
    } catch (err) {
      setError(err.message || 'We couldn’t load your accounts. Please try again.')
    } finally { setMerging(false) }
  }, [discovered, uid, stageStatement, merging])
  const onDrop = (e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }

  // Dropped or picked on the accounts screen: the sheet opens straight into
  // reading it, rather than onto a chooser asking what you just handed it.
  const addFromFile = useCallback((file) => { openAdd(); handleFile(file) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openAdd])

  return (
    <div className="portfolio-shell min-h-screen bg-wall-bg">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <TabNav activeView={visibleView} hasData={hasData} onChange={setActiveView} />

        {/* One boundary per visible tab, keyed on the tab itself: switching
            away and back is the retry, so a crash on Charts does not require
            reloading the whole app to see Holdings. */}
        <ErrorBoundary key={visibleView} context={`portfolio-panel:${visibleView}`} resetKey={visibleView} fallback={PanelFallback}>
          {visibleView === 'overview' && stats && (
            <>
              <LiveBanner liveStatus={liveStatus} liveMessage={liveMessage} lastUpdatedAt={lastUpdatedAt} />
              <PerformanceChart hero stats={stats} rows={rows} />
              <StatRail rows={rows} stats={stats} accounts={accountEntries} onCashOverride={handleCashOverride} />
              <CompositionPanel rows={rows} accounts={accountEntries} />
              {/* One quiet line, deliberately not a stat tile: this is a tax
                  fact sitting among performance numbers, and a dollar figure
                  styled like a metric reads as an alarm. */}
              {portfolioDrag && (
                <p className="mt-6 text-[13px] leading-[1.7] text-ink/45">
                  About {fmtCurrency(portfolioDrag.annualWithheldMinor / 100)}
                  {portfolioDrag.basis === 'projected' ? ' a year is withheld' : ' was withheld over the last 12 months'}
                  {' '}on US dividends across {portfolioDrag.accountCount === 1 ? 'one account' : `${portfolioDrag.accountCount} accounts`}. Open an account to see the detail.
                </p>
              )}
              {/* Fund fees, in dollars. Never "$0 in fees" from a failed
                  lookup: a fund whose fee did not resolve is named, not
                  folded into the total. */}
              {fundFees && fundFees.annualFeeMinor > 0 && (
                <p className="mt-2 text-[13px] leading-[1.7] text-ink/45">
                  Your funds charge about {fmtCurrency(fundFees.annualFeeMinor / 100)} a year, averaging {fundFees.weightedMerPct}% of the amount they hold.
                  {!fundFees.complete && ` No fee data for ${fundFees.missingFeeData.join(', ')}, so ${fundFees.missingFeeData.length === 1 ? 'it is' : 'they are'} not in that figure.`}
                </p>
              )}
            </>
          )}
          {visibleView === 'overview' && !stats && <EmptyState onUploadClick={() => openAdd()} />}

          {visibleView === 'charts' && stats && (
            <>
              <LiveBanner liveStatus={liveStatus} liveMessage={liveMessage} lastUpdatedAt={lastUpdatedAt} />
              <ChartsView accounts={accountEntries} />
            </>
          )}
          {visibleView === 'charts' && !stats && <EmptyState onUploadClick={() => openAdd()} />}

          {visibleView === 'holdings' && (
            <HoldingsView rows={rows} accounts={accountEntries} onUploadClick={() => openAdd()} />
          )}
          {visibleView === 'add' && (
            <AccountsView
              accounts={accountEntries}
              onAdd={openAdd}
              onFile={addFromFile}
              onOpenAccount={(account) => { setRemovalError(''); setOpenAccount(account) }}
              notice={accountNotice}
              onDismissNotice={() => setAccountNotice('')}
            />
          )}
        </ErrorBoundary>
      </div>

      <AddAccountModal
        open={addOpen}
        onClose={closeAdd}
        initialMode={addMode}
        accounts={accountEntries}
        error={error}
        loading={loading}
        loadingMsg={loadingMsg}
        inputRef={inputRef}
        isDragging={isDragging}
        userId={uid}
        pending={pending}
        completed={completed}
        preview={preview}
        busy={merging}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onFile={handleFile}
        discovered={discovered}
        onImportDiscovered={handleImportDiscovered}
        onPlaidAccounts={handlePlaidAccounts}
        onPlaidConnecting={handlePlaidConnecting}
        onPlaidError={handlePlaidError}
        onChooseDestination={handleChooseDestination}
        onConfirm={handleConfirmMerge}
        onCancel={handleCancelMerge}
      />

      <AccountDetailModal
        open={Boolean(openAccount)}
        account={openAccount ? (accountEntries.find((a) => a.accountNumber === openAccount.accountNumber) ?? null) : null}
        busy={removing}
        accounts={accountEntries}
        reference={reference}
        transactions={ledger.transactions}
        historyStarts={ledger.historyStarts}
        error={removalError}
        onClose={() => { if (!removing) { setOpenAccount(null); setRemovalError('') } }}
        onRemoveSource={handleRemoveSource}
        onRemoveAccount={handleRemoveAccount}
      />
    </div>
  )
}
