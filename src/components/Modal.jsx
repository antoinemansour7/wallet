import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// A task that begins and ends belongs in an overlay, not on a page. Rendered
// through a portal so it escapes whatever the page layout is doing, and it
// takes the keyboard with it — Escape closes, focus is trapped inside, and the
// page behind cannot be scrolled away underneath.

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, labelledBy, children, className = '' }) {
  const panelRef = useRef(null)
  const restoreTo = useRef(null)

  useEffect(() => {
    if (!open) return undefined

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
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="modal-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        // Full width on a phone so it reads as a sheet, centred and contained
        // above that. Capped by viewport height so a long list scrolls inside
        // the panel rather than pushing the actions off screen.
        className={`modal-panel relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/[0.09] bg-wall-surface shadow-card outline-none sm:max-w-[420px] sm:rounded-2xl ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Title row with a close affordance — every modal needs the same one. */
export function ModalHeader({ id, title, subtitle, onBack, onClose }) {
  return (
    <div className="flex items-start gap-3 px-5 pb-4 pt-5">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="-ml-1.5 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h2 id={id} className="truncate text-[16px] font-semibold tracking-[-0.01em] text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-[12.5px] text-white/40">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="-mr-1.5 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
