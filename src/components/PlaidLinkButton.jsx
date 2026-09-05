import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { IS_PREVIEW, PREVIEW_PLAID } from '../preview/mockMode'
import { callPlaid } from '../utils/plaidClient'
import AccountIcon from '../pages/portfolio/AccountIcons'

export default function PlaidLinkButton(props) {
  const [instance, setInstance] = useState(0)
  return IS_PREVIEW ? <PreviewPlaidLinkButton {...props} /> : <LivePlaidLinkButton key={instance} {...props} onRetry={() => setInstance((value) => value + 1)} />
}

function PreviewPlaidLinkButton({ userId, onAccounts, onConnecting }) {
  const [loading, setLoading] = useState(false)
  const connect = async () => {
    setLoading(true)
    onConnecting?.()
    await new Promise((resolve) => setTimeout(resolve, 650))
    onAccounts?.({ itemId: PREVIEW_PLAID.itemId, accounts: PREVIEW_PLAID.accounts, enabledAccountIds: PREVIEW_PLAID.accounts.filter((account) => account.type === 'investment').map((account) => account.id), institutionName: PREVIEW_PLAID.institutionName })
  }
  return <button type="button" className="ac-button ac-primary ac-plaid-button" disabled={loading || !userId} onClick={connect}><AccountIcon name="lock" size={16} />{loading ? 'Connecting…' : 'Continue with Plaid'}<AccountIcon name="arrow" size={17} /></button>
}

function LivePlaidLinkButton({ userId, onAccounts, onConnecting, onError, onLinkOpenChange, onRetry }) {
  const [linkToken, setLinkToken] = useState(null)
  const [loading, setLoading] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    if (!userId) return undefined
    let cancelled = false
    setLinkToken(null)
    setTokenError('')
    const timer = setTimeout(() => {
      if (!cancelled) setTokenError('The connection is taking longer than expected. Please try again.')
    }, 15000)
    callPlaid({ action: 'link-token', userId })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok || !data.link_token) throw new Error('Could not create a connection')
        if (!cancelled) { setLinkToken(data.link_token); setTokenError('') }
      })
      .catch(() => {
        if (!cancelled) setTokenError('We couldn’t start Plaid. Try again, or import a statement instead.')
      })
      .finally(() => clearTimeout(timer))
    return () => { cancelled = true; clearTimeout(timer) }
  }, [userId, attempt])

  const handleSuccess = useCallback(async (publicToken, metadata) => {
    onLinkOpenChange?.(false)
    setLoading(true)
    onConnecting?.()
    try {
      const response = await callPlaid({ action: 'exchange-token', publicToken, userId, institutionName: metadata.institution?.name || null })
      const data = await response.json()
      if (!response.ok || !data.itemId) throw new Error('We couldn’t finish connecting your brokerage. Please try again.')
      onAccounts?.({ itemId: data.itemId, accounts: data.accounts || [], enabledAccountIds: data.enabledAccountIds || [], institutionName: metadata.institution?.name || 'Your brokerage' })
    } catch (error) {
      onError?.(error)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [userId, onAccounts, onConnecting, onError, onLinkOpenChange])

  const handleExit = useCallback((error) => {
    onLinkOpenChange?.(false)
    setLoading(false)
    // Tokens are single-use. A fresh attempt also recovers from expired Link sessions.
    setAttempt((value) => value + 1)
    if (error) onError?.(new Error('The connection wasn’t completed. Try again, or choose another brokerage.'))
  }, [onError, onLinkOpenChange])

  const { open, ready, error: sdkError } = usePlaidLink({ token: linkToken, onSuccess: handleSuccess, onExit: handleExit })

  useEffect(() => {
    if (!linkToken || ready || sdkError) return undefined
    const timer = setTimeout(() => setTokenError('Plaid is taking longer than expected. Please try again.'), 15000)
    return () => clearTimeout(timer)
  }, [linkToken, ready, sdkError])

  const connect = () => { onLinkOpenChange?.(true); open() }

  if (tokenError || sdkError) return <div className="ac-plaid-retry"><p className="ac-inline-error" role="alert">{tokenError || 'Plaid couldn’t load. Check your connection and try again.'}</p><button type="button" className="ac-button ac-primary ac-plaid-button" onClick={onRetry}>Try again <AccountIcon name="arrow" size={17} /></button></div>
  const preparing = !ready || !linkToken
  return <button type="button" className="ac-button ac-primary ac-plaid-button" disabled={loading || preparing || !userId} onClick={connect}>{loading || preparing ? <span className="ac-spinner" aria-hidden="true" /> : <AccountIcon name="lock" size={16} />}{loading ? 'Connecting…' : preparing ? 'Preparing secure connection…' : 'Continue with Plaid'}{!loading && !preparing && <AccountIcon name="arrow" size={17} />}</button>
}
