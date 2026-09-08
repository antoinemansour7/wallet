import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { easeOut, timing, useMedia } from './motion'

function WithholdingReview() {
  return <div className="wa-tax-feature-review"><div className="wa-tax-review-heading"><span>Dividend withholding</span><span>Annual estimate · CAD</span></div>{[['TFSA', '$156.00'], ['RRSP', '$104.00'], ['Non-registered', '$52.00']].map(([account, value]) => <div className="wa-tax-review-row" key={account}><span>{account}</span><strong>{value}</strong></div>)}<p>Illustrative figures · Review the data behind each estimate.</p></div>
}
function ContributionReview() {
  return <div className="wa-tax-feature-review"><div className="wa-tax-review-heading"><span>Check a TFSA contribution</span><span>Illustration</span></div><div className="wa-tax-review-row"><span>Room on your records</span><strong>$6,250.00</strong></div><div className="wa-tax-review-row"><span>Planned contribution</span><strong>−$1,000.00</strong></div><div className="wa-tax-room-result"><span>Would remain</span><strong>$5,250.00 <small>CAD</small></strong></div></div>
}
function CurrencyReview() {
  return <div className="wa-currency-art" aria-label="Illustrative measured currency conversion costs: 96 Canadian dollars year to date"><span>CAD</span><i aria-hidden="true">⇄</i><span>USD</span><div className="wa-tax-fx-example"><strong>$96.00 <small>CAD</small></strong><span>Measured · Year to date</span></div><p>Compared with the daily reference rate.</p></div>
}
function FeesReview() {
  return <div className="wa-timeline-art"><div><span aria-hidden="true">A</span><p><strong>Fund A</strong><small>$12,000 held × 0.20% expenses</small></p><span>$24.00 / yr</span></div><div><span aria-hidden="true">B</span><p><strong>Fund B</strong><small>$80,000 held × 0.20% expenses</small></p><span>$160.00 / yr</span></div><p className="wa-timeline-caption">Illustrative funds · $184.00 CAD estimated annually</p></div>
}
const features = [
  { number: '01', title: 'See where your dividends go.', text: 'Review withholding across your accounts, with recorded figures and estimates clearly labelled. See the assumptions behind the number.', art: <WithholdingReview />, className: 'wa-feature-allocation' },
  { number: '02', title: 'Know your room before you contribute.', text: 'Enter your TFSA and RRSP room. Account for recorded deposits, then check what a planned contribution would leave.', art: <ContributionReview />, className: 'wa-feature-research' },
  { number: '03', title: 'Look beyond the exchange rate.', text: 'Review FX costs against a daily reference. When an actual cost can’t be measured, see that clearly.', art: <CurrencyReview />, className: 'wa-feature-currency' },
  { number: '04', title: 'Small percentages. Real dollars.', text: 'See fund expense ratios translated into estimated annual costs for the holdings you own. Know which funds still need fee data.', art: <FeesReview />, className: 'wa-feature-history' },
]
export default function Features({ reduced }: { reduced: boolean }) {
  const fine = useMedia('(hover: hover) and (pointer: fine)')
  const [inset, setInset] = useState(() => Math.round(window.innerHeight * .2))
  useEffect(() => {
    const resize = () => setInset(Math.round(window.innerHeight * .2))
    window.addEventListener('resize', resize, { passive: true })
    return () => window.removeEventListener('resize', resize)
  }, [])
  return <section id="features" className="wa-features wa-container" aria-labelledby="features-title"><div className="wa-feature-heading"><div><p className="wa-eyebrow"><span /> 02 / Tax & costs, in focus</p><h2 id="features-title">The costs add up.<br />See how.</h2></div><p className="wa-section-copy">Withholding, fees, currency conversion and contribution room. One place to look closer.</p></div>
    <motion.div className="wa-bento" initial={reduced ? false : 'hidden'} whileInView="visible" viewport={{ once: true, margin: `0px 0px -${inset}px 0px`, amount: 'some' }} variants={{ visible: { transition: { staggerChildren: reduced ? 0 : timing.stagger } } }}>
      {features.map(feature => <motion.article key={feature.number} className={`wa-feature ${feature.className}`} variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : timing.slow, ease: easeOut } } }} whileHover={!reduced && fine ? { y: -4, transition: { duration: timing.fast } } : undefined}><span className="wa-feature-number">{feature.number} /</span><h3>{feature.title}</h3><p className="wa-feature-copy">{feature.text}</p>{feature.art}</motion.article>)}
    </motion.div>
  </section>
}
