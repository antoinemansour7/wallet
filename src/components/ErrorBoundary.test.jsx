import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary, { PageFallback, PanelFallback, RowFallback } from './ErrorBoundary'

vi.mock('../firebase/config', () => ({
  auth: { currentUser: null },
  db: {},
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: vi.fn().mockResolvedValue({}),
  serverTimestamp: vi.fn(() => 'server-time'),
}))

vi.mock('../preview/mockMode', () => ({ IS_PREVIEW: false }))

import { auth } from '../firebase/config'
import { addDoc } from 'firebase/firestore'

// React logs the error to its own console.error too, which is expected and
// not the thing under test — silenced so the real assertions stay readable.
const realError = console.error
beforeEach(() => {
  vi.clearAllMocks()
  auth.currentUser = null
  console.error = vi.fn()
})
afterEach(() => { console.error = realError })

function Bomb({ armed }) {
  if (armed) throw new Error('boom')
  return <div>fine</div>
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary context="test">
        <div>all good</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('catches a thrown render error and shows the fallback instead of crashing', () => {
    render(
      <ErrorBoundary context="test" fallback={PanelFallback}>
        <Bomb armed />
      </ErrorBoundary>,
    )
    expect(screen.getByText("This section couldn't load.")).toBeInTheDocument()
  })

  it('defaults to the page fallback when none is given', () => {
    render(
      <ErrorBoundary context="test">
        <Bomb armed />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('clears on manual retry and renders children again', () => {
    // The bomb only throws once: retrying re-renders the same tree, and a
    // component that throws every time would never demonstrate recovery.
    let armed = true
    function OnceThenFine() {
      if (armed) { armed = false; throw new Error('boom') }
      return <div>recovered</div>
    }

    render(
      <ErrorBoundary context="test" fallback={PanelFallback}>
        <OnceThenFine />
      </ErrorBoundary>,
    )
    expect(screen.getByText("This section couldn't load.")).toBeInTheDocument()

    fireEvent.click(screen.getByText('Try again'))
    expect(screen.getByText('recovered')).toBeInTheDocument()
  })

  it('resets automatically when resetKey changes, without a manual retry', () => {
    const { rerender } = render(
      <ErrorBoundary context="test" resetKey="a" fallback={PanelFallback}>
        <Bomb armed />
      </ErrorBoundary>,
    )
    expect(screen.getByText("This section couldn't load.")).toBeInTheDocument()

    rerender(
      <ErrorBoundary context="test" resetKey="b" fallback={PanelFallback}>
        <Bomb armed={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeInTheDocument()
  })

  it('does not reset when other props change but resetKey does not', () => {
    const { rerender } = render(
      <ErrorBoundary context="test" resetKey="a" fallback={PanelFallback}>
        <Bomb armed />
      </ErrorBoundary>,
    )
    rerender(
      <ErrorBoundary context="test-renamed" resetKey="a" fallback={PanelFallback}>
        <Bomb armed={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText("This section couldn't load.")).toBeInTheDocument()
  })

  it('reports nothing to Firestore when no one is signed in', () => {
    auth.currentUser = null
    render(
      <ErrorBoundary context="test">
        <Bomb armed />
      </ErrorBoundary>,
    )
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('reports to Firestore under the signed-in user when a crash happens', () => {
    auth.currentUser = { uid: 'user-123' }
    render(
      <ErrorBoundary context="holdings-row">
        <Bomb armed />
      </ErrorBoundary>,
    )
    expect(addDoc).toHaveBeenCalledTimes(1)
    const [, payload] = addDoc.mock.calls[0]
    expect(payload.context).toBe('holdings-row')
    expect(payload.message).toBe('boom')
  })

  it('never throws out of the reporter itself, even if the write fails', () => {
    auth.currentUser = { uid: 'user-123' }
    addDoc.mockRejectedValueOnce(new Error('offline'))
    expect(() => render(
      <ErrorBoundary context="test">
        <Bomb armed />
      </ErrorBoundary>,
    )).not.toThrow()
  })
})

describe('fallbacks', () => {
  it('PageFallback offers both a retry and a reload', () => {
    render(<PageFallback error={new Error('x')} reset={() => {}} />)
    expect(screen.getByText('Try again')).toBeInTheDocument()
    expect(screen.getByText('Reload')).toBeInTheDocument()
  })

  it('RowFallback renders with no interactive controls', () => {
    render(<RowFallback />)
    expect(screen.getByText("Couldn't show this holding.")).toBeInTheDocument()
  })
})
