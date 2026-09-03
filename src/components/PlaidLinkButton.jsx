import { useCallback, useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { IS_PREVIEW, PREVIEW_PLAID } from '../preview/mockMode'

export default function PlaidLinkButton({ userId, onAccounts, onConnecting, onError }) {
  const [linkToken, setLinkToken] = useState(null)
  const [loading, setLoading] = useState(false)

  // Fetch link token on mount
  useEffect(() => {
    if (IS_PREVIEW) return undefined
    if (!userId) return
    let cancelled = false

    fetch('/api/plaid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'link-token', userId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.link_token) setLinkToken(data.link_token)
      })
      .catch((err) => console.error('[PlaidLink] failed to get link token:', err))

    return () => { cancelled = true }
  }, [userId])

  // Stops at the exchange. Holdings are only fetched once the user has said
  // which accounts they actually want — an institution that forces a chequing
  // account into the connection should not force it into the portfolio.
  const handleSuccess = useCallback(async (publicToken, metadata) => {
    setLoading(true)
    onConnecting?.()
    try {
      const exchangeRes = await fetch('/api/plaid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'exchange-token',
          publicToken,
          userId,
          institutionName: metadata.institution?.name || null,
        }),
      })
      const exchangeData = await exchangeRes.json()
      if (!exchangeRes.ok) throw new Error(exchangeData.error || 'Exchange failed')

      onAccounts?.({
        itemId: exchangeData.itemId,
        accounts: exchangeData.accounts || [],
        enabledAccountIds: exchangeData.enabledAccountIds || [],
        institutionName: metadata.institution?.name || null,
      })
    } catch (err) {
      console.error('[PlaidLink] error:', err)
      onError?.(err)
    } finally {
      setLoading(false)
    }
  }, [userId, onAccounts, onConnecting, onError])

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: handleSuccess,
  })

  // Preview stands in for the whole Link round trip. Without it the connect
  // path is the one flow you cannot look at without real bank credentials,
  // which makes it the one flow that never gets designed.
  const openPreview = useCallback(async () => {
    setLoading(true)
    onConnecting?.()
    await new Promise((r) => setTimeout(r, 700))
    setLoading(false)
    onAccounts?.({
      itemId: PREVIEW_PLAID.itemId,
      accounts: PREVIEW_PLAID.accounts,
      enabledAccountIds: PREVIEW_PLAID.accounts.filter((a) => a.type === 'investment').map((a) => a.id),
      institutionName: PREVIEW_PLAID.institutionName,
    })
  }, [onAccounts, onConnecting])

  const disabled = IS_PREVIEW ? loading : (!ready || !linkToken || loading)

  return (
    <button
      type="button"
      onClick={() => (IS_PREVIEW ? openPreview() : open())}
      disabled={disabled}
      className={`flex w-full items-center gap-3.5 px-4 py-4 text-left transition-colors duration-motion-short focus-visible:outline-none focus-visible:bg-ink/[0.04] ${
        disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-ink/[0.03]'
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-ink/[0.06] text-ink/55">
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-[1.5px] border-ink/50 border-t-transparent" />
        ) : (
          <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium tracking-[-0.01em] text-ink">
          {loading ? 'Connecting…' : 'Connect your brokerage'}
        </span>
        <span className="mt-0.5 block text-[13px] text-ink/45">
          Wealthsimple, Questrade, and more
        </span>
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink/25">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}
