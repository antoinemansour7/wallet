'use client'

import { useEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import Lenis from 'lenis'
import Brokerages from '../src/components/landing/Brokerages'
import OneView from '../src/components/landing/OneView'
import Features from '../src/components/landing/Features'
import TaxWorkflow from '../src/components/landing/TaxWorkflow'
import Closing from '../src/components/landing/Closing'
import Hero from '../src/components/landing/Hero'
import { useMedia, timing } from '../src/components/landing/motion'
import '../src/components/landing/tokens.css'
import '../src/components/landing/landing.css'

export default function LandingPage() {
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'WallAI — Investment tax & costs, made clear.'
    return () => { document.title = previousTitle }
  }, [])
  useEffect(() => {
    // Wheel/touch stay native. Lenis only eases explicit section-link navigation.
    const previous = document.documentElement.style.scrollBehavior
    document.documentElement.style.scrollBehavior = 'auto'
    const lenis = reduced ? null : new Lenis({ autoRaf: true, anchors: true, smoothWheel: false, duration: timing.base, easing: t => 1 - Math.pow(1 - t, 3), syncTouch: false })
    return () => { lenis?.destroy(); document.documentElement.style.scrollBehavior = previous }
  }, [reduced])
  return <MotionConfig reducedMotion="user"><main key={reduced ? 'static' : 'animated'} className="wallai-system wa-landing">
    <Hero reduced={reduced} />
    <Brokerages reduced={reduced} />
    <OneView reduced={reduced} />
    <Features reduced={reduced} />
    <TaxWorkflow reduced={reduced} />
    <Closing />
  </main></MotionConfig>
}
