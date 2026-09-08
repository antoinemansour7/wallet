import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { easeOut, timing, useMedia } from './motion'

function Allocation() {
  return <div className="wa-allocation-art" aria-label="Sample allocation: equities 68%, fixed income 22%, cash 10%"><div className="wa-allocation-bar"><span /><span /><span /></div><div className="wa-allocation-legend"><span><i />Equities <strong>68%</strong></span><span><i />Fixed income <strong>22%</strong></span><span><i />Cash <strong>10%</strong></span></div></div>
}
function Research() {
  return <div className="wa-research-art"><div><span className="wa-research-star" aria-hidden="true">✳</span><span>Three agents.<br /><strong>A more considered answer.</strong></span></div><p><span>01</span> Find the catalyst <span>↗</span></p><p><span>02</span> Challenge the thesis <span>↗</span></p><p><span>03</span> Put risk in perspective <span>↗</span></p></div>
}
function Currency() {
  return <div className="wa-currency-art" aria-label="See Canadian and US holdings together"><span>CAD</span><i aria-hidden="true">⇄</i><span>USD</span><p>Your holdings. A common currency.</p></div>
}
function Timeline() {
  return <div className="wa-timeline-art"><div><span aria-hidden="true">↗</span><p><strong>Dividend received</strong><small>Added to your portfolio history</small></p><span>+$84.20</span></div><div><span aria-hidden="true">+</span><p><strong>Contribution added</strong><small>A little closer to your next chapter</small></p><span>+$500.00</span></div><p className="wa-timeline-caption">Illustrative activity</p></div>
}
const features = [
  { number: '01', title: 'Know what makes up your wealth.', text: 'See your allocation across accounts. Spot the overlaps. Understand the whole.', art: <Allocation />, className: 'wa-feature-allocation' },
  { number: '02', title: 'A second look. And a third.', text: 'Research that checks the catalyst, challenges the idea, and considers the risk.', art: <Research />, className: 'wa-feature-research' },
  { number: '03', title: 'Across borders. In focus.', text: 'Canadian and US holdings, together in one portfolio view.', art: <Currency />, className: 'wa-feature-currency' },
  { number: '04', title: 'See the story behind the balance.', text: 'Contributions, dividends, and trades. Keep the moments that shape your portfolio in view.', art: <Timeline />, className: 'wa-feature-history' },
]
export default function Features({ reduced }: { reduced: boolean }) {
  const fine = useMedia('(hover: hover) and (pointer: fine)')
  const [inset, setInset] = useState(() => Math.round(window.innerHeight * .2))
  useEffect(() => {
    const resize = () => setInset(Math.round(window.innerHeight * .2))
    window.addEventListener('resize', resize, { passive: true })
    return () => window.removeEventListener('resize', resize)
  }, [])
  return <section id="features" className="wa-features wa-container" aria-labelledby="features-title"><div className="wa-feature-heading"><div><p className="wa-eyebrow"><span /> 02 / A little more insight</p><h2 id="features-title">Less noise.<br />More knowing.</h2></div><p className="wa-section-copy">The details that matter, with the room to make sense of them.</p></div>
    <motion.div className="wa-bento" initial={reduced ? false : 'hidden'} whileInView="visible" viewport={{ once: true, margin: `0px 0px -${inset}px 0px`, amount: 'some' }} variants={{ visible: { transition: { staggerChildren: reduced ? 0 : timing.stagger } } }}>
      {features.map(feature => <motion.article key={feature.number} className={`wa-feature ${feature.className}`} variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : timing.slow, ease: easeOut } } }} whileHover={!reduced && fine ? { y: -4, transition: { duration: timing.fast } } : undefined}><span className="wa-feature-number">{feature.number} /</span><h3>{feature.title}</h3><p className="wa-feature-copy">{feature.text}</p>{feature.art}</motion.article>)}
    </motion.div>
  </section>
}
