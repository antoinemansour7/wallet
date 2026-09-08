'use client'

import { useEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import Lenis from 'lenis'
import Hero from '../src/components/landing/Hero'
import { useMedia, timing } from '../src/components/landing/motion'
import '../src/components/landing/tokens.css'
import '../src/components/landing/landing.css'

export default function LandingPage() {
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'WallAI — Your investments. All together.'
    return () => { document.title = previousTitle }
  }, [])
  useEffect(() => {
    // Override the existing global CSS smooth behavior; Lenis owns landing scroll.
    const previous = document.documentElement.style.scrollBehavior
    document.documentElement.style.scrollBehavior = 'auto'
    const lenis = reduced ? null : new Lenis({ autoRaf: true, anchors: true, duration: timing.slow, easing: t => 1 - Math.pow(1 - t, 3), syncTouch: false })
    return () => { lenis?.destroy(); document.documentElement.style.scrollBehavior = previous }
  }, [reduced])
  return <MotionConfig reducedMotion="user"><main className="wallai-system wa-landing"><Hero reduced={reduced} /></main></MotionConfig>
}
