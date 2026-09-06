import { useCallback, useEffect, useRef, useState } from 'react'
import { loadTaxSettings, loadTaxTransactions, saveTaxSettings } from './taxStorage'

export default function useTaxWorkspace(uid, loadLedger) {
  const [state, setState] = useState({ uid: null, settings: {}, loading: true, saving: false, error: '' })
  const [ledger, setLedger] = useState({ uid: null, transactions: [], loading: false, error: '', limited: false })
  const currentUid = useRef(uid)
  currentUid.current = uid
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
    if (!loadLedger) return undefined
    let cancelled = false
    setLedger({ uid, transactions: [], loading: true, error: '', limited: false })
    loadTaxTransactions(uid).then((result) => { if (!cancelled) setLedger({ uid, ...result, loading: false, error: '' }) })
      .catch(() => { if (!cancelled) setLedger({ uid, transactions: [], loading: false, error: 'Transaction history couldn’t be loaded. Try opening the Tax tab again.', limited: false }) })
    return () => { cancelled = true }
  }, [uid, loadLedger])
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
  return { ...(state.uid === uid ? state : { settings: {}, loading: true }), update,
    ledger: ledger.uid === uid ? ledger : { transactions: [], loading: loadLedger, error: '', limited: false } }
}
