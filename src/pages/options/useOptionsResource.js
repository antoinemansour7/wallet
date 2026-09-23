import { useCallback, useEffect, useRef, useState } from 'react'

export const OPTIONS_API = '/api/get-research?optionsAudit=1'

// Ownership is verified independently of tab visibility. Never render a title
// or retain a previous identity's data while the new identity is checked.
export function useOptionsResource(user, url) {
  const [state, setState] = useState({ verified: false, denied: false, busy: true, data: null, error: null })
  const lifetime = useRef(null)
  const generation = useRef(0)
  const request = useCallback(async (path, body) => {
    const signal = lifetime.current?.signal
    if (!user?.getIdToken || signal?.aborted) throw new Error('denied')
    const token = await user.getIdToken()
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET', cache: 'no-store', signal,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if ([401, 403].includes(response.status)) {
      if (!signal?.aborted) {
        generation.current += 1
        setState({ verified: false, denied: true, data: null, busy: false, error: null })
      }
      throw new Error('denied')
    }
    const data = await response.json()
    if (!response.ok) {
      // Never promote provider/storage error strings into the research UI.
      const error = new Error('Options data is unavailable. Try again.')
      error.referenceId = /^options-[a-zA-Z0-9-]+$/.test(data.referenceId) ? data.referenceId : null
      throw error
    }
    return data
  }, [user])

  const reload = useCallback(async () => {
    const current = ++generation.current
    setState((old) => ({ ...old, busy: true, error: null }))
    try {
      await request('/api/get-research?owner=1')
      if (lifetime.current?.signal.aborted || current !== generation.current) return
      setState((old) => ({ ...old, verified: true }))
      const data = await request(url)
      if (!lifetime.current?.signal.aborted && current === generation.current) setState({ verified: true, denied: false, busy: false, data, loadedUrl: url, error: null })
    } catch (error) {
      if (!lifetime.current?.signal.aborted && current === generation.current && error.message !== 'denied') {
        setState((old) => ({ ...old, busy: false, error: { message: 'Options data is unavailable. Try again.', referenceId: error.referenceId } }))
      }
    }
  }, [request, url])

  useEffect(() => {
    lifetime.current = new AbortController()
    if (!user?.getIdToken) setState({ verified: false, denied: true, busy: false, data: null, error: null })
    else reload()
    return () => { lifetime.current.abort(); generation.current += 1 }
  }, [reload, user])
  return { ...state, request, reload }
}
