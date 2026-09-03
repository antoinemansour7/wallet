import { useEffect, useRef } from 'react'

/**
 * Shows the new value immediately, then briefly tints its existing box so a
 * refresh is perceptible. There is deliberately no count-up: an in-flight
 * financial number is not a number the reader can trust yet.
 */
export default function ChangedValue({ as: Element = 'span', value, enabled = true, className = '', children }) {
  const elementRef = useRef(null)
  const previousValue = useRef(value)

  useEffect(() => {
    const node = elementRef.current
    if (!node) return undefined

    if (!enabled) {
      previousValue.current = value
      node.classList.remove('motion-value-change')
      return undefined
    }

    if (Object.is(previousValue.current, value)) return undefined
    previousValue.current = value
    node.classList.remove('motion-value-change')

    const schedule = globalThis.requestAnimationFrame
      ?? ((callback) => globalThis.setTimeout(callback, 0))
    const cancel = globalThis.cancelAnimationFrame ?? globalThis.clearTimeout
    const frame = schedule(() => node.classList.add('motion-value-change'))
    const clear = () => node.classList.remove('motion-value-change')
    node.addEventListener('animationend', clear, { once: true })

    return () => {
      cancel(frame)
      node.removeEventListener('animationend', clear)
      node.classList.remove('motion-value-change')
    }
  }, [enabled, value])

  return <Element ref={elementRef} className={className}>{children}</Element>
}
