import { useRef, useState } from 'react'
import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { useMedia } from './motion'

const accounts = [
  { name: 'TFSA', caption: 'Check the room you have recorded.', value: '$6,250.00', metric: 'Contribution room remaining', detail: 'Your entered room, less recorded deposits across your TFSA accounts.', facts: [['Starting room entered', '$8,250.00'], ['Recorded deposits', '−$2,000.00']], basis: 'Based on your records', icon: 'T' },
  { name: 'RRSP', caption: 'Plan your next contribution.', value: '$18,400.00', metric: 'Contribution room remaining', detail: 'Add your available room, then check a planned contribution against your records.', facts: [['Starting room entered', '$22,400.00'], ['Recorded deposits', '−$4,000.00']], basis: 'Based on your records', icon: 'R' },
  { name: 'Non-registered', caption: 'Look closer at dividend withholding.', value: '$52.00', metric: 'Estimated annual withholding', detail: 'Review withholding by holding and see where a foreign tax credit may be available.', facts: [['What the estimate uses', 'Holdings & yields'], ['What you can review', 'Data & assumptions']], basis: 'Annual estimate', icon: 'N' },
]
function AccountContent({ index }: { index: number }) {
  const account = accounts[index]
  return <><div className="wa-account-top"><span className="wa-account-symbol">{account.icon}</span><span>ACCOUNT {String(index + 1).padStart(2, '0')}</span><span aria-hidden="true">↗</span></div><h3>{account.name}</h3><p className="wa-account-value">{account.value}</p><p className="wa-account-metric">{account.metric}</p><p className="wa-account-detail">{account.detail}</p><dl className="wa-account-facts">{account.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="wa-account-bottom"><span>{account.basis}</span><span>Sample · CAD</span></div></>
}
function AccountCard({ index, progress }: { index: number; progress: MotionValue<number> }) {
  // Hold each order, then move to the next: T/R/N -> R/N/T -> N/T/R.
  const stops = [0, .22, .4, .55, .73, 1]
  const ranks = [[0, 0, 2, 2, 1, 1], [1, 1, 0, 0, 2, 2], [2, 2, 1, 1, 0, 0]][index]
  const y = useTransform(progress, stops, ranks.map(rank => rank * 32))
  const x = useTransform(progress, stops, ranks.map(rank => rank * 12))
  const rotate = useTransform(progress, stops, ranks.map(rank => rank * -3))
  const scale = useTransform(progress, stops, ranks.map(rank => 1 - rank * .045))
  const zIndex = useTransform(progress, value => 3 - ranks[value < .31 ? 0 : value < .64 ? 2 : 4])
  return <motion.article className={`wa-account-card wa-account-${index}`} style={{ x, y, rotate, scale, zIndex }}><AccountContent index={index} /></motion.article>
}
function Copy({ active = 0, staticLayout = false }: { active?: number; staticLayout?: boolean }) {
  return <div className="wa-one-copy"><p className="wa-eyebrow"><span /> 01 / Your accounts, considered</p><h2 id="one-view-title">Every account.<br />A clearer plan.</h2><p className="wa-section-copy">Contribution room for your next deposit. Withholding behind your dividends. Bring the questions that matter into one place.</p><ol className="wa-account-steps" aria-label="Account types">{accounts.map((account, i) => <li key={account.name} data-active={staticLayout || active === i}><span>0{i + 1}</span><div><strong>{account.name}</strong><p>{account.caption}</p></div></li>)}</ol><a className="wa-text-link" href="/login?mode=signup">Start with your accounts <span aria-hidden="true">↗</span></a></div>
}
function StickyAccounts() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [active, setActive] = useState(0)
  const activeIndex = useRef(0)
  useMotionValueEvent(scrollYProgress, 'change', value => {
    const next = value < .31 ? 0 : value < .64 ? 1 : 2
    if (next !== activeIndex.current) { activeIndex.current = next; setActive(next) }
  })
  return <section ref={ref} id="one-view" className="wa-one wa-one-sticky" aria-labelledby="one-view-title"><div className="wa-one-stage wa-container"><Copy active={active} /><div className="wa-account-board">{accounts.map((account, i) => <AccountCard key={account.name} index={i} progress={scrollYProgress} />)}</div></div></section>
}
export default function OneView({ reduced }: { reduced: boolean }) {
  const mobile = useMedia('(max-width: 760px)')
  if (!mobile && !reduced) return <StickyAccounts />
  return <section id="one-view" className="wa-one wa-one-static" aria-labelledby="one-view-title"><div className="wa-one-stage wa-container"><Copy staticLayout /><div className="wa-account-board">{accounts.map((account, i) => <article key={account.name} className={`wa-account-card wa-account-${i}`}><AccountContent index={i} /></article>)}</div></div></section>
}
