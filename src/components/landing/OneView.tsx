import { useRef, useState } from 'react'
import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { useMedia } from './motion'

const accounts = [
  { name: 'TFSA', caption: 'Room for your next chapter.', value: '$48,250.00', detail: 'Your tax-free savings, in the picture.', allocation: '38% of your portfolio', holdings: ['VFV', 'XEQT', 'SHOP'], icon: 'T' },
  { name: 'RRSP', caption: 'A longer view, made clearer.', value: '$62,400.00', detail: 'Keep tomorrow in view, alongside today.', allocation: '49% of your portfolio', holdings: ['VEQT', 'VTI', 'XBB'], icon: 'R' },
  { name: 'Non-registered', caption: 'The rest of your possibilities.', value: '$17,800.00', detail: 'Your investments beyond registered accounts.', allocation: '14% of your portfolio', holdings: ['RY', 'CNR', 'CASH'], icon: 'N' },
]
function AccountContent({ index }: { index: number }) {
  const account = accounts[index]
  return <><div className="wa-account-top"><span className="wa-account-symbol">{account.icon}</span><span>ACCOUNT {String(index + 1).padStart(2, '0')}</span><span aria-hidden="true">↗</span></div><h3>{account.name}</h3><p className="wa-account-value">{account.value}</p><p className="wa-account-detail">{account.detail}</p><div className="wa-account-holdings">{account.holdings.map(holding => <span key={holding}>{holding}</span>)}</div><div className="wa-account-bottom"><span>{account.allocation}</span><span>Sample · CAD</span></div></>
}
function AccountCard({ index, progress }: { index: number; progress: MotionValue<number> }) {
  // Hold each order, then move to the next: T/R/N -> R/N/T -> N/T/R.
  const stops = [0, .22, .4, .55, .73, 1]
  const ranks = [[0, 0, 2, 2, 1, 1], [1, 1, 0, 0, 2, 2], [2, 2, 1, 1, 0, 0]][index]
  const y = useTransform(progress, stops, ranks.map(rank => rank * 32))
  const x = useTransform(progress, stops, ranks.map(rank => rank * 12))
  const rotate = useTransform(progress, stops, ranks.map(rank => rank * -3))
  const scale = useTransform(progress, stops, ranks.map(rank => 1 - rank * .045))
  const zIndex = useTransform(progress, stops, ranks.map(rank => 3 - rank))
  return <motion.article className={`wa-account-card wa-account-${index}`} style={{ x, y, rotate, scale, zIndex }}><AccountContent index={index} /></motion.article>
}
function Copy({ active = 0, staticLayout = false }: { active?: number; staticLayout?: boolean }) {
  return <div className="wa-one-copy"><p className="wa-eyebrow"><span /> 01 / The big picture</p><h2 id="one-view-title">Many accounts.<br />One point of view.</h2><p className="wa-section-copy">Different places, different plans. Bring them into focus with a single view of everything you own.</p><ol className="wa-account-steps" aria-label="Account types">{accounts.map((account, i) => <li key={account.name} data-active={staticLayout || active === i}><span>0{i + 1}</span><div><strong>{account.name}</strong><p>{account.caption}</p></div></li>)}</ol><a className="wa-text-link" href="/login?mode=signup">Bring your accounts together <span aria-hidden="true">↗</span></a></div>
}
function StickyAccounts() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const [active, setActive] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', value => setActive(value < .31 ? 0 : value < .64 ? 1 : 2))
  return <section ref={ref} id="one-view" className="wa-one wa-one-sticky" aria-labelledby="one-view-title"><div className="wa-one-stage wa-container"><Copy active={active} /><div className="wa-account-board">{accounts.map((account, i) => <AccountCard key={account.name} index={i} progress={scrollYProgress} />)}<p className="wa-stack-note">One portfolio. A little more perspective.</p></div></div></section>
}
export default function OneView({ reduced }: { reduced: boolean }) {
  const mobile = useMedia('(max-width: 760px)')
  if (!mobile && !reduced) return <StickyAccounts />
  return <section id="one-view" className="wa-one wa-one-static" aria-labelledby="one-view-title"><div className="wa-one-stage wa-container"><Copy staticLayout /><div className="wa-account-board">{accounts.map((account, i) => <article key={account.name} className={`wa-account-card wa-account-${i}`}><AccountContent index={i} /></article>)}</div></div></section>
}
