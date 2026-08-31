import { useEffect, useRef, useState } from 'react'

const DURATION_MS = 700

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Animates a number toward `target` whenever it changes (count-up effect for
 * hero balances). Returns the in-flight value; jumps instantly when the user
 * prefers reduced motion.
 */
export function useCountUp(target) {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const frameRef = useRef(null)

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setValue(target)
      return
    }

    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      fromRef.current = target
      setValue(target)
      return
    }

    const from = fromRef.current
    if (from === target) return

    const start = performance.now()
    const tick = (now) => {
      const t = Math.min((now - start) / DURATION_MS, 1)
      const next = from + (target - from) * easeOutCubic(t)
      setValue(next)
      if (t < 1) frameRef.current = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [target])

  return value
}
