import { useCallback, useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'

export default function PlaidLinkButton({ userId, onAccounts, onConnecting, onError }) {
  const [linkToken, setLinkToken] = useState(null)
  const [loading, setLoading] = useState(false)

  // Fetch link token on mount
  useEffect(() => {
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

  const disabled = !ready || !linkToken || loading

  return (
    <button
      type="button"
      onClick={() => open()}
      disabled={disabled}
      className={`group flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left transition-all duration-150 ${
        disabled
          ? 'cursor-not-allowed opacity-40'
          : 'bg-white/[0.03] hover:bg-white/[0.05]'
      }`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
        {loading ? (
          <div className="h-3.5 w-3.5 rounded-full border-[1.5px] border-white/50 border-t-transparent animate-spin" />
        ) : (
          <svg className="h-3.5 w-3.5 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        )}
      </div>
      <div>
        <p className="text-[13px] text-white/60 group-hover:text-white/80">
          {loading ? 'Connecting…' : 'Connect your brokerage'}
        </p>
        <p className="text-[11px] text-white/25">
          Wealthsimple, Questrade, and more
        </p>
      </div>
    </button>
  )
}
