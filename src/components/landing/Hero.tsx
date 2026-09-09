import { useEffect, useRef } from 'react'
import { animate, motion, useMotionTemplate, useMotionValue, useSpring } from 'framer-motion'
import Brand from './Brand'
import { cursorSpring, easeOut, spring, timing, useMedia } from './motion'

const chart = 'M0 154 L20 146 L40 151 L60 130 L80 138 L100 124 L120 129 L140 112 L160 120 L180 94 L200 102 L220 88 L240 97 L260 68 L280 79 L300 59 L320 66 L340 44 L360 52 L380 32 L400 39 L420 18 L440 25 L460 10'

function PortfolioCard({ reduced }: { reduced: boolean }) {
  const valueRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (valueRef.current) valueRef.current.textContent = '128,450'
    if (reduced) return
    const control = animate(0, 128450, {
      duration: timing.count, delay: timing.base, ease: easeOut,
      onUpdate: value => { if (valueRef.current) valueRef.current.textContent = Math.round(value).toLocaleString('en-CA') },
    })
    return () => control.stop()
  }, [reduced])
  return <motion.figure className="wa-portfolio" initial={reduced ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: reduced ? 0 : timing.base }}>
    <figcaption className="wa-card-top"><span><i className="wa-dot" />Your portfolio</span><span className="wa-sample">Illustrative portfolio</span></figcaption>
    <div className="wa-balance" aria-label="128,450 Canadian dollars"><span aria-hidden="true">$<span ref={valueRef}>128,450</span><span className="wa-cents">.00</span></span><span className="wa-currency" aria-hidden="true">CAD</span></div>
    <p className="wa-gain">↗ $11,460.00 (9.80%) <span>past year</span></p>
    <div className="wa-chart">
      <svg viewBox="0 0 460 185" role="img" aria-label="Illustrative portfolio value trending upward over one year">
        <defs><linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--wa-sage)" stopOpacity=".16" /><stop offset="1" stopColor="var(--wa-sage)" stopOpacity="0" /></linearGradient></defs>
        {[40, 95, 150].map(y => <line key={y} x1="0" x2="460" y1={y} y2={y} stroke="var(--wa-dark-line)" strokeDasharray="2 6" />)}
        <path d={`${chart} L460 185 L0 185 Z`} fill="url(#hero-fill)" />
        <motion.path d={chart} fill="none" stroke="var(--wa-sage)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" initial={reduced ? false : { strokeDashoffset: 1 }} animate={{ strokeDashoffset: 0 }} transition={{ duration: reduced ? 0 : timing.chart, delay: reduced ? 0 : timing.base, ease: 'linear' }} />
      </svg>
      <div className="wa-chart-labels"><span>Sep</span><span>Dec</span><span>Mar</span><span>Aug</span></div>
    </div>
    <div className="wa-portfolio-bottom"><span>All accounts, in CAD</span><span className="wa-period">1 year</span></div>
    <div className="wa-account-summary"><span className="wa-mini-icon">T</span><span className="wa-mini-icon">R</span><span className="wa-mini-icon">N</span><span><strong>Three accounts. One clear picture.</strong><small>TFSA · RRSP · Non-registered</small></span><span aria-hidden="true">↗</span></div>
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
        <h1 id="hero-title">{['Your', 'investments.', 'All together.'].map((line, i) => <span className="wa-mask" key={line}><motion.span initial={reduced ? false : { y: '110%' }} animate={{ y: 0 }} transition={{ duration: reduced ? 0 : timing.slow, delay: i * timing.headline, ease: easeOut }}>{line}</motion.span></span>)}</h1>
        <p className="wa-intro">A home for your portfolio.<br className="wa-desktop-break" /> A clearer view of your investment tax and costs.</p>
        <a className="wa-button wa-button-light" href="/login?mode=signup">Understand your costs <span aria-hidden="true">↗</span></a>
        <p className="wa-hero-note">Free during beta. Your money stays with your brokerage.</p>
      </div>
      <div className="wa-hero-art"><div className="wa-orbits" aria-hidden="true" /><PortfolioCard reduced={reduced} /></div>
    </div>
    <div className="wa-hero-footer wa-container"><span>Made for the way Canadians invest.</span><a href="#one-view">A wider perspective <span aria-hidden="true">↓</span></a></div>
  </section>
}
