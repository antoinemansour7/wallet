import { useRef } from 'react'
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { useMedia } from './motion'

const taxComponents = [
  { name: 'Withholding', title: 'What stays behind?', text: 'See dividend withholding across your accounts. Review recorded figures, annual estimates and potential foreign tax credits.', tag: 'Look behind your dividends', icon: '✳' },
  { name: 'Fund expenses', title: 'What do your funds cost?', text: 'Translate fund expense ratios into estimated annual dollars. See the breakdown by holding and where fee data is missing.', tag: 'Put percentages in perspective', icon: '◫' },
  { name: 'FX costs', title: 'What did conversion cost?', text: 'Compare recorded conversions with a daily reference rate. See when costs are measured, estimated or not yet available.', tag: 'Understand the currency cost', icon: '↔' },
]
function Node({ index }: { index: number }) {
  const component = taxComponents[index]
  return <><div className="wa-workflow-meta"><span>COMPONENT 0{index + 1}</span><span aria-hidden="true">{component.icon}</span></div><h3>{component.name}</h3><h4>{component.title}</h4><p>{component.text}</p><span className="wa-workflow-tag">{component.tag}</span></>
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
  return <div ref={ref} className="wa-workflow-flow"><div className="wa-workflow-rail" aria-hidden="true"><svg viewBox={mobile ? '0 0 2 100' : '0 0 100 2'} preserveAspectRatio="none"><path d={mobile ? 'M1 0V100' : 'M0 1H100'} stroke="var(--wa-dark-line)" fill="none" vectorEffect="non-scaling-stroke" />{[first, second].map((offset, i) => <motion.path key={i} d={mobile ? `M1 ${i * 50}V${(i + 1) * 50}` : `M${i * 50} 1H${(i + 1) * 50}`} stroke="var(--wa-sage)" strokeWidth="2" fill="none" pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: offset }} vectorEffect="non-scaling-stroke" />)}</svg><motion.span className="wa-data-marker" style={mobile ? { top: position } : { left: position }}>CAD <span>↗</span></motion.span></div><div className="wa-workflows-grid">{taxComponents.map((component, index) => <AnimatedNode key={component.name} index={index} progress={scrollYProgress} />)}</div></div>
}
export default function TaxComponents({ reduced }: { reduced: boolean }) {
  const mobile = useMedia('(max-width: 760px)')
  return <section id="tax-components" className="wa-workflows wa-dark" aria-labelledby="tax-components-title"><div className="wa-container"><div className="wa-workflows-heading"><p className="wa-eyebrow"><span /> 03 / Meet your tax components</p><h2 id="tax-components-title">Small costs deserve<br /><span>a closer look.</span></h2><p className="wa-section-copy">One portfolio. Three different perspectives.<br />Meet the components behind your Tax & costs view.</p></div>{reduced ? <div className="wa-workflow-flow wa-workflow-static"><div className="wa-static-data">CAD · Your investment tax & costs <span aria-hidden="true">→</span></div><div className="wa-workflows-grid">{taxComponents.map((component, index) => <article className="wa-workflow" key={component.name}><Node index={index} /></article>)}</div></div> : <AnimatedFlow mobile={mobile} />}<div className="wa-workflows-foot"><span>Withholding · Fund expenses · FX costs</span><p>Measured figures and estimates, clearly labelled.</p><a className="wa-text-link" href="/login?mode=signup">Explore your tax & costs <span aria-hidden="true">↗</span></a></div></div></section>
}
