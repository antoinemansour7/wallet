import { useCallback, useEffect, useRef, useState } from 'react'
import { loadTaxSettings, saveTaxSettings } from './taxStorage'
import { loadTransactions, loadHistoryStarts } from '../../../utils/transactionStore'
import { fetchSecurityReference, symbolsToResolve } from '../../../utils/securityReference'
import { fetchLivePrices } from '../../../utils/livePrices'
import { poolCostBase } from '../../../utils/costBase'
import { callPlaid } from '../../../utils/plaidClient'

const EMPTY_LEDGER = { transactions: [], historyStarts: {}, loading: true, error: '', limited: false }
export default function useTaxWorkspace(uid, active, accounts = []) {
  const [state, setState] = useState({ uid: null, settings: {}, loading: true, saving: false, error: '' })
  const [ledger, setLedger] = useState(EMPTY_LEDGER)
  const [referenceState, setReference] = useState({})
  const [prices, setPrices] = useState({})
  const [syncState, setSync] = useState({})
  const [revision, refresh] = useState(0)
  const currentUid = useRef(uid)
  const syncing = useRef(false)
  currentUid.current = uid
  const symbolsKey = JSON.stringify(symbolsToResolve(accounts.flatMap((a) => a.positions || [])).sort())
  useEffect(() => {
    let cancelled = false
    setState({ uid, settings: {}, loading: true, saving: false, error: '' })
    loadTaxSettings(uid).then((settings) => {
      if (!cancelled) setState({ uid, settings, loading: false, saving: false, error: '' })
    }).catch(() => {
      if (!cancelled) setState({ uid, settings: {}, loading: false, saving: false, error: 'Tax settings couldn’t be loaded. Reload the page to try again.', loadFailed: true })
    })
    return () => { cancelled = true }
  }, [uid])
  useEffect(() => {
    let cancelled = false
    setReference({ uid, key: symbolsKey, loading: true, reference: {} })
    const symbols = JSON.parse(symbolsKey)
    // The endpoint accepts 200 symbols per request. Resolve the entire portfolio.
    Promise.all(Array.from({ length: Math.ceil(symbols.length / 200) }, (_, i) => fetchSecurityReference(symbols.slice(i * 200, (i + 1) * 200))))
      .then((parts) => { if (!cancelled) setReference({ uid, key: symbolsKey, loading: false, reference: Object.assign({}, ...parts) }) })
    return () => { cancelled = true }
  }, [uid, symbolsKey, revision])
  useEffect(() => {
    let cancelled = false
    setLedger({ ...EMPTY_LEDGER, uid })
    Promise.all([loadTransactions(uid, { strict: true }), loadHistoryStarts(uid, { strict: true })])
      .then(([transactions, historyStarts]) => {
        if (!cancelled) setLedger({ uid, transactions, historyStarts, loading: false, error: '', limited: transactions.length >= 2000 })
      }).catch(() => {
        if (!cancelled) setLedger({ ...EMPTY_LEDGER, uid, loading: false, error: 'Transaction history couldn’t be loaded. Retry before relying on contribution or sale figures.' })
      })
    return () => { cancelled = true }
  }, [uid, revision])
  useEffect(() => {
    if (!active || ledger.uid !== uid || ledger.loading || ledger.error || ledger.limited) return undefined
    let cancelled = false
    const symbols = [...new Set(poolCostBase(ledger.transactions, { historyStartsAt: ledger.historyStarts }).disposals.map((d) => d.symbol))]
    setPrices({ uid, loading: !!symbols.length, quotes: {} })
    if (symbols.length) Promise.all(Array.from({ length: Math.ceil(symbols.length / 199) }, (_, i) => fetchLivePrices(symbols.slice(i * 199, (i + 1) * 199)))).then((parts) => {
      const quotes = Object.fromEntries(parts.flatMap((result) => result.quotes.map((q) => [q.requestedSymbol || q.symbol, q])))
      if (!cancelled) setPrices({ uid, quotes, usdCadRate: parts.find((result) => result.usdCadRate)?.usdCadRate || null, loading: false })
    }).catch(() => { if (!cancelled) setPrices({ uid, quotes: {}, loading: false, error: 'Comparison prices couldn’t be loaded.' }) })
    return () => { cancelled = true }
  }, [uid, active, ledger])
  const saving = useRef(false)
  const update = useCallback(async (patch) => {
    if (saving.current || state.uid !== uid || state.loading || state.loadFailed) return false
    saving.current = true
    const next = { ...state.settings, ...patch }
    setState((prev) => ({ ...prev, saving: true, error: '' }))
    try {
      await saveTaxSettings(uid, next)
      if (currentUid.current === uid) setState({ uid, settings: next, loading: false, saving: false, error: '' })
      return true
    } catch {
      if (currentUid.current === uid) setState((prev) => ({ ...prev, saving: false, error: 'Couldn’t save your changes. Please try again.' }))
      return false
    } finally { saving.current = false }
  }, [state, uid])
  const sync = useCallback(async () => {
    if (!uid || syncing.current) return
    syncing.current = true
    setSync({ uid, loading: true })
    try {
      const response = await callPlaid({ action: 'sync-transactions' })
      const result = await response.json()
      if (!response.ok) throw new Error('Sync failed')
      if (currentUid.current === uid) {
        setSync({ uid, loading: false, result, error: result.errors?.length ? `${result.errors.length} connection(s) could not sync. Reconnect them on Accounts and retry.` : '' })
        refresh((value) => value + 1)
      }
    } catch {
      if (currentUid.current === uid) setSync({ uid, loading: false, error: 'Sync couldn’t finish. Please try again; imported transactions are safe to sync again.' })
    } finally { syncing.current = false }
  }, [uid])
  const visibleLedger = ledger.uid === uid ? ledger : EMPTY_LEDGER
  const reference = referenceState.uid === uid && referenceState.key === symbolsKey ? referenceState.reference || {} : {}
  return { ...(state.uid === uid ? state : { settings: {}, loading: true }), update, sync,
    retry: () => refresh((value) => value + 1),
    syncState: syncState.uid === uid ? syncState : {},
    prices: prices.uid === uid ? prices : {},
    referenceLoading: referenceState.uid !== uid || referenceState.key !== symbolsKey || referenceState.loading,
    ledger: visibleLedger,
    data: { reference, transactions: visibleLedger.limited || visibleLedger.error ? [] : visibleLedger.transactions, historyStarts: visibleLedger.historyStarts },
  }
}
