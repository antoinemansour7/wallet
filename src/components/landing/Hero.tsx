import { useEffect, useRef } from 'react'
import { animate, motion, useMotionTemplate, useMotionValue, useSpring } from 'framer-motion'
import Brand from './Brand'
import TaxSnapshot from './TaxSnapshot'
import { cursorSpring, easeOut, spring, timing, useMedia } from './motion'

function TaxCard({ reduced }: { reduced: boolean }) {
  const valueRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (valueRef.current) valueRef.current.textContent = '312'
    if (reduced) return
    const control = animate(0, 312, {
      duration: timing.count, delay: timing.base, ease: easeOut,
      onUpdate: value => { if (valueRef.current) valueRef.current.textContent = Math.round(value).toLocaleString('en-CA') },
    })
    return () => control.stop()
  }, [reduced])
  return <motion.figure className="wa-portfolio" aria-label="Illustrative Tax and costs overview" initial={reduced ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: reduced ? 0 : timing.base }}>
    <TaxSnapshot amount={<span ref={valueRef}>312</span>} animateBars={!reduced} />
  </motion.figure>
}

export default function Hero({ reduced }: { reduced: boolean }) {
  const fine = useMedia('(min-width: 761px) and (hover: hover) and (pointer: fine)')
  const panel = useRef<HTMLElement>(null)
  const x = useMotionValue(600), y = useMotionValue(300)
  const lagX = useSpring(x, cursorSpring), lagY = useSpring(y, cursorSpring)
  const gradient = useMotionTemplate`radial-gradient(600px circle at ${lagX}px ${lagY}px, var(--wa-glow), transparent 70%)`
  useEffect(() => {
    const element = panel.current
    if (!element || reduced || !fine) return
    const move = (event: PointerEvent) => { const bounds = element.getBoundingClientRect(); x.set(event.clientX - bounds.left); y.set(event.clientY - bounds.top) }
    element.addEventListener('pointermove', move, { passive: true })
    return () => element.removeEventListener('pointermove', move)
  }, [fine, reduced, x, y])
  return <section ref={panel} className="wa-hero wa-dark" aria-labelledby="hero-title">
    {!reduced && fine && <motion.div className="wa-cursor" aria-hidden="true" style={{ background: gradient }} />}
    <header className="wa-nav wa-container"><Brand /><nav aria-label="Main navigation"><a href="#one-view">Your accounts</a><a href="#features">Tax & costs</a></nav><a href="/login" className="wa-button wa-button-outline">Log in <span aria-hidden="true">↗</span></a></header>
    <div className="wa-hero-grid wa-container">
      <div className="wa-hero-copy"><p className="wa-eyebrow"><span /> A clearer view of tax & costs</p>
        <h1 id="hero-title">{['Your money.', 'Your costs.', 'Made clear.'].map((line, i) => <span className="wa-mask" key={line}><motion.span initial={reduced ? false : { y: '110%' }} animate={{ y: 0 }} transition={{ duration: reduced ? 0 : timing.slow, delay: i * timing.headline, ease: easeOut }}>{line}</motion.span></span>)}</h1>
        <p className="wa-intro">Dividend withholding. Fund fees. Currency conversion.<br className="wa-desktop-break" /> See what investing costs you, across your accounts.</p>
        <a className="wa-button wa-button-light" href="/login?mode=signup">Understand your costs <span aria-hidden="true">↗</span></a>
        <p className="wa-hero-note">Free during beta. Your money stays with your brokerage.</p>
      </div>
      <div className="wa-hero-art"><div className="wa-orbits" aria-hidden="true" /><TaxCard reduced={reduced} /></div>
    </div>
    <div className="wa-hero-footer wa-container"><span>Built around Canadian accounts.</span><a href="#one-view">See what’s inside <span aria-hidden="true">↓</span></a></div>
  </section>
}
