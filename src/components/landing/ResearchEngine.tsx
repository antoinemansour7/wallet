import { useRef } from 'react'
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { useMedia } from './motion'

const researchStages = [
  { name: 'Nightly search', title: 'Where do ideas begin?', text: 'Searches market news, public posts and technical screens for stocks worth a closer look. Brings signals from different sources together.', tag: 'Cast a wider net', icon: '✳' },
  { name: 'Agent review', title: 'Does the idea hold up?', text: 'The Contrarian agent builds the opposing case. The Catalyst agent checks the event behind the idea, its timing and supporting sources.', tag: 'Challenge the story', icon: '↔' },
  { name: 'Research shortlist', title: 'What deserves your attention?', text: 'Ranks the remaining ideas and adds research reports. Explore the reasoning, catalysts and risks behind each pick in your research view.', tag: 'Go deeper on the ideas that matter', icon: '◫' },
]
function Node({ index }: { index: number }) {
  const component = researchStages[index]
  return <><div className="wa-workflow-meta"><span>STAGE 0{index + 1}</span><span aria-hidden="true">{component.icon}</span></div><h3>{component.name}</h3><h4>{component.title}</h4><p>{component.text}</p><span className="wa-workflow-tag">{component.tag}</span></>
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
  return <div ref={ref} className="wa-workflow-flow"><div className="wa-workflow-rail" aria-hidden="true"><svg viewBox={mobile ? '0 0 2 100' : '0 0 100 2'} preserveAspectRatio="none"><path d={mobile ? 'M1 0V100' : 'M0 1H100'} stroke="var(--wa-dark-line)" fill="none" vectorEffect="non-scaling-stroke" />{[first, second].map((offset, i) => <motion.path key={i} d={mobile ? `M1 ${i * 50}V${(i + 1) * 50}` : `M${i * 50} 1H${(i + 1) * 50}`} stroke="var(--wa-sage)" strokeWidth="2" fill="none" pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: offset }} vectorEffect="non-scaling-stroke" />)}</svg><motion.span className="wa-data-marker" style={mobile ? { top: position } : { left: position }}>SHOP <span>↗</span></motion.span></div><div className="wa-workflows-grid">{researchStages.map((component, index) => <AnimatedNode key={component.name} index={index} progress={scrollYProgress} />)}</div></div>
}
export default function ResearchEngine({ reduced }: { reduced: boolean }) {
  const mobile = useMedia('(max-width: 760px)')
  return <section id="research-engine" className="wa-workflows wa-dark" aria-labelledby="research-engine-title"><div className="wa-container"><div className="wa-workflows-heading"><p className="wa-eyebrow"><span /> 03 / Inside the research engine</p><h2 id="research-engine-title">A wider search.<br /><span>A closer look.</span></h2><p className="wa-section-copy">From market signals to ideas worth exploring.<br />Meet the engine behind your nightly research.</p></div>{reduced ? <div className="wa-workflow-flow wa-workflow-static"><div className="wa-static-data">SHOP · Illustrative research sequence <span aria-hidden="true">→</span></div><div className="wa-workflows-grid">{researchStages.map((component, index) => <article className="wa-workflow" key={component.name}><Node index={index} /></article>)}</div></div> : <AnimatedFlow mobile={mobile} />}<div className="wa-workflows-foot"><span>Search → Review → Research</span><p>Illustrative ticker · Research to inform your thinking.</p><a className="wa-text-link" href="/login?mode=signup">Explore your research <span aria-hidden="true">↗</span></a></div></div></section>
}
