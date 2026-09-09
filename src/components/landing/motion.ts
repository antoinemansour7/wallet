import { useEffect, useState } from 'react'

// DESIGN.md §4; durations are seconds for Motion/Lenis.
export const timing = { fast: .15, base: .3, slow: .6, stagger: .06, headline: .08, count: 1.2, chart: 1.5 }
export const easeOut = [.22, 1, .36, 1] as const
export const spring = { type: 'spring' as const, stiffness: 120, damping: 22, mass: 1 }
export const cursorSpring = { stiffness: 70, damping: 24, mass: 1 }
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}
