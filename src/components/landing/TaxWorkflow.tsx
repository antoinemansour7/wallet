import { useRef } from 'react'
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { useMedia } from './motion'

const steps = [
  { name: 'Connect', title: 'Start with what you own.', text: 'Link a supported brokerage or import a statement. Add your account types to give your costs context.', tag: 'Your accounts, together', icon: '↔' },
  { name: 'Understand', title: 'Look behind the numbers.', text: 'Review withholding, fund expenses and FX costs. See what is measured, estimated or still needs data.', tag: 'Figures with a clear basis', icon: '✳' },
  { name: 'Compare', title: 'Consider your next step.', text: 'Compare withholding between account types, or check a planned contribution against your recorded room.', tag: 'A clearer view of your options', icon: '◫' },
]
function Node({ index }: { index: number }) {
  const step = steps[index]
  return <><div className="wa-workflow-meta"><span>STEP 0{index + 1}</span><span aria-hidden="true">{step.icon}</span></div><h3>{step.name}</h3><h4>{step.title}</h4><p>{step.text}</p><span className="wa-workflow-tag">{step.tag}</span></>
}
function AnimatedNode({ index, progress }: { index: number; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [index * .3, index * .3 + .15], [.45, 1])
  const y = useTransform(progress, [index * .3, index * .3 + .15], [16, 0])
  return <motion.article className="wa-workflow" style={{ opacity, y }}><Node index={index} /></motion.article>
}
function AnimatedFlow({ mobile }: { mobile: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 85%', 'end 45%'] })
  const position = useTransform(scrollYProgress, [0, .25, .55, .85, 1], ['0%', '0%', '50%', '100%', '100%'])
  const first = useTransform(scrollYProgress, [.25, .55], [1, 0])
  const second = useTransform(scrollYProgress, [.55, .85], [1, 0])
  return <div ref={ref} className="wa-workflow-flow"><div className="wa-workflow-rail" aria-hidden="true"><svg viewBox={mobile ? '0 0 2 100' : '0 0 100 2'} preserveAspectRatio="none"><path d={mobile ? 'M1 0V100' : 'M0 1H100'} stroke="var(--wa-dark-line)" fill="none" vectorEffect="non-scaling-stroke" />{[first, second].map((offset, i) => <motion.path key={i} d={mobile ? `M1 ${i * 50}V${(i + 1) * 50}` : `M${i * 50} 1H${(i + 1) * 50}`} stroke="var(--wa-sage)" strokeWidth="2" fill="none" pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: offset }} vectorEffect="non-scaling-stroke" />)}</svg><motion.span className="wa-data-marker" style={mobile ? { top: position } : { left: position }}>DATA <span>↗</span></motion.span></div><div className="wa-workflows-grid">{steps.map((step, index) => <AnimatedNode key={step.name} index={index} progress={scrollYProgress} />)}</div></div>
}
export default function TaxWorkflow({ reduced }: { reduced: boolean }) {
  const mobile = useMedia('(max-width: 760px)')
  return <section id="how-it-works" className="wa-workflows wa-dark" aria-labelledby="workflow-title"><div className="wa-container"><div className="wa-workflows-heading"><p className="wa-eyebrow"><span /> 03 / From accounts to answers</p><h2 id="workflow-title">A few steps.<br /><span>A clearer picture.</span></h2><p className="wa-section-copy">Start with your accounts.<br />Make sense of the tax and costs around them.</p></div>{reduced ? <div className="wa-workflow-flow wa-workflow-static"><div className="wa-static-data">Your account data · Illustrative walkthrough <span aria-hidden="true">→</span></div><div className="wa-workflows-grid">{steps.map((step, index) => <article className="wa-workflow" key={step.name}><Node index={index} /></article>)}</div></div> : <AnimatedFlow mobile={mobile} />}<div className="wa-workflows-foot"><span>Connect → Understand → Compare</span><p>Account comparisons cover dividend withholding only.</p><a className="wa-text-link" href="/login?mode=signup">Start understanding your costs <span aria-hidden="true">↗</span></a></div></div></section>
}
