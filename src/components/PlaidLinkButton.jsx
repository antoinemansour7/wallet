import { useCallback, useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'

export default function PlaidLinkButton({ userId, onSuccess, onConnecting }) {
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

  const handleSuccess = useCallback(async (publicToken, metadata) => {
    setLoading(true)
    onConnecting?.()
    try {
      // Exchange public token
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

      // Fetch holdings
      const holdingsRes = await fetch('/api/plaid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'holdings', userId }),
      })
      const holdingsData = await holdingsRes.json()
      if (!holdingsRes.ok) throw new Error(holdingsData.error || 'Holdings fetch failed')

      onSuccess?.(holdingsData, metadata.institution?.name)
    } catch (err) {
      console.error('[PlaidLink] error:', err)
      onSuccess?.(null, null, err)
    } finally {
      setLoading(false)
    }
  }, [userId, onSuccess, onConnecting])

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
      className={`group flex items-center gap-2.5 rounded-xl border px-4 py-3 text-left transition-all duration-150 ${
        disabled
          ? 'cursor-not-allowed border-white/[0.04] bg-white/[0.02] opacity-50'
          : 'border-white/[0.08] bg-white/[0.04] hover:border-white/[0.15] hover:bg-white/[0.06]'
      }`}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#00a87e]/10">
        {loading ? (
          <div className="h-4 w-4 rounded-full border-2 border-[#00a87e] border-t-transparent animate-spin" />
        ) : (
          <svg className="h-4 w-4 text-[#00a87e]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        )}
      </div>
      <div>
        <p className="text-sm font-medium text-white/80 group-hover:text-white">
          {loading ? 'Connecting…' : 'Connect Brokerage'}
        </p>
        <p className="text-[11px] text-white/40">
          Wealthsimple, Questrade, and more via Plaid
        </p>
      </div>
    </button>
  )
}
