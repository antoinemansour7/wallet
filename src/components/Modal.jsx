import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// A task that begins and ends belongs in an overlay, not on a page. Rendered
// through a portal so it escapes whatever the page layout is doing, and it
// takes the keyboard with it — Escape closes, focus is trapped inside, and the
// page behind cannot be scrolled away underneath.

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
// Keep this in sync with --motion-duration-long. The timeout is only a safety
// net for browsers that do not dispatch animationend (for example, when a tab
// is backgrounded while the sheet closes).
const MODAL_EXIT_MS = 300

export default function Modal({ open, onClose, labelledBy, children, className = '' }) {
  const panelRef = useRef(null)
  const restoreTo = useRef(null)
  const [present, setPresent] = useState(open)

  // Closing is still a state the dialog can render. Keeping it in the portal
  // for one motion beat lets the sheet settle away instead of disappearing.
  useEffect(() => {
    if (open) {
      setPresent(true)
      return undefined
    }
    if (!present) return undefined

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const timeout = window.setTimeout(() => setPresent(false), reducedMotion ? 0 : MODAL_EXIT_MS)
    return () => window.clearTimeout(timeout)
  }, [open, present])

  useEffect(() => {
    if (!open || !present) return undefined

    restoreTo.current = document.activeElement
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    // Focus the dialog itself, not the first control. Focusing the close button
    // put a ring on it the instant the overlay appeared, which reads as an
    // error state; Tab still walks into the content from here.
    panelRef.current?.focus?.()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') { onClose?.(); return }
      if (event.key !== 'Tab') return

      const items = [...(panelRef.current?.querySelectorAll(FOCUSABLE) ?? [])]
      if (items.length === 0) return
      const edge = event.shiftKey ? items[0] : items[items.length - 1]
      if (document.activeElement === edge) {
        event.preventDefault()
        ;(event.shiftKey ? items[items.length - 1] : items[0]).focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      restoreTo.current?.focus?.()
    }
  }, [open, onClose, present])

  if (!present) return null

  const state = open ? 'open' : 'closing'

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center sm:items-center ${open ? '' : 'pointer-events-none'}`}
      data-state={state}
      aria-hidden={open ? undefined : 'true'}
    >
      <div
        className="modal-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm"
        data-state={state}
        onClick={open ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-state={state}
        onAnimationEnd={(event) => {
          if (!open && event.target === event.currentTarget) setPresent(false)
        }}
        // Full width on a phone so it reads as a sheet, centred and contained
        // above that. Capped by viewport height so a long list scrolls inside
        // the panel rather than pushing the actions off screen.
        className={`modal-panel relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-[22px] bg-wall-surface shadow-modal outline-none sm:max-w-[440px] sm:rounded-[22px] ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

function NavButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/45 transition-colors duration-motion-short hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
    >
      {children}
    </button>
  )
}

/**
 * A close button on its own, for panels whose content opens with a heading of
 * its own. ModalHeader would put the X in a chrome band above that heading,
 * floating ~48px clear of the nearest thing it could line up with; pinned to
 * the panel instead, it sits on the first line of content and stays put while
 * the content scrolls under it.
 */
export function ModalClose({ onClose, className = '' }) {
  return (
    <div className={`absolute right-3 top-3 z-10 ${className}`}>
      <NavButton label="Close" onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </NavButton>
    </div>
  )
}

/**
 * Navigation row. `title` is optional: when the panel's own content already
 * names the task — a heading it can be labelled by — repeating it in chrome
 * above just spends the top of the sheet saying the same thing twice.
 */
export function ModalHeader({ id, title, subtitle, onBack, onClose }) {
  return (
    <div className="flex items-start gap-2 px-4 pb-1 pt-4">
      {onBack && (
        <NavButton label="Back" onClick={onBack}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </NavButton>
      )}

      {/* No spacer when there is no back button: an invisible 32px box left the
          title indented past the content it sits above. */}
      <div className="min-w-0 flex-1 pt-1.5" style={onBack ? undefined : { paddingLeft: 4 }}>
        {title && (
          <h2 id={id} className="truncate text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        )}
        {subtitle && <p className="mt-0.5 truncate text-[13px] text-ink/45">{subtitle}</p>}
      </div>

      <NavButton label="Close" onClick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </NavButton>
    </div>
  )
}
