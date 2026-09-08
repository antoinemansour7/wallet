import { useRef } from 'react'
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { useMedia } from './motion'

const agents = [
  { name: 'Catalyst', title: 'What could change?', text: 'Looks for the event behind the idea, then checks its timing and evidence.', tag: 'Verify the opportunity', icon: '✳' },
  { name: 'Contrarian', title: 'What could we be missing?', text: 'Builds the opposing case. Tests the assumptions that deserve a second look.', tag: 'Challenge the thesis', icon: '↔' },
  { name: 'Position Sizing', title: 'How much risk belongs here?', text: 'Considers conviction and risk to put a potential position in perspective.', tag: 'Consider the exposure', icon: '◫' },
]
function Node({ index }: { index: number }) {
  const agent = agents[index]
  return <><div className="wa-agent-meta"><span>AGENT 0{index + 1}</span><span aria-hidden="true">{agent.icon}</span></div><h3>{agent.name}</h3><h4>{agent.title}</h4><p>{agent.text}</p><span className="wa-agent-tag">{agent.tag}</span></>
}
function AnimatedNode({ index, progress }: { index: number; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [index * .3, index * .3 + .15], [.45, 1])
  const y = useTransform(progress, [index * .3, index * .3 + .15], [16, 0])
  return <motion.article className="wa-agent" style={{ opacity, y }}><Node index={index} /></motion.article>
}
function AnimatedFlow({ mobile }: { mobile: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 85%', 'end 45%'] })
  const position = useTransform(scrollYProgress, [0, .25, .55, .85, 1], ['0%', '0%', '50%', '100%', '100%'])
  const first = useTransform(scrollYProgress, [.25, .55], [1, 0])
  const second = useTransform(scrollYProgress, [.55, .85], [1, 0])
  return <div ref={ref} className="wa-agent-flow"><div className="wa-agent-rail" aria-hidden="true"><svg viewBox={mobile ? '0 0 2 100' : '0 0 100 2'} preserveAspectRatio="none"><path d={mobile ? 'M1 0V100' : 'M0 1H100'} stroke="var(--wa-dark-line)" fill="none" vectorEffect="non-scaling-stroke" />{[first, second].map((offset, i) => <motion.path key={i} d={mobile ? `M1 ${i * 50}V${(i + 1) * 50}` : `M${i * 50} 1H${(i + 1) * 50}`} stroke="var(--wa-sage)" strokeWidth="2" fill="none" pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: offset }} vectorEffect="non-scaling-stroke" />)}</svg><motion.span className="wa-ticker" style={mobile ? { top: position } : { left: position }}>SHOP <span>↗</span></motion.span></div><div className="wa-agents-grid">{agents.map((agent, index) => <AnimatedNode key={agent.name} index={index} progress={scrollYProgress} />)}</div></div>
}
export default function Agents({ reduced }: { reduced: boolean }) {
  const mobile = useMedia('(max-width: 760px)')
  return <section id="agents" className="wa-agents wa-dark" aria-labelledby="agents-title"><div className="wa-container"><div className="wa-agents-heading"><p className="wa-eyebrow"><span /> 03 / A team for your thinking</p><h2 id="agents-title">Good ideas deserve<br /><span>a little interrogation.</span></h2><p className="wa-section-copy">One ticker. Three different perspectives.<br />Meet the agents that help you look a little closer.</p></div>{reduced ? <div className="wa-agent-flow wa-agent-static"><div className="wa-static-ticker">SHOP · Illustrative research sequence <span aria-hidden="true">→</span></div><div className="wa-agents-grid">{agents.map((agent, index) => <article className="wa-agent" key={agent.name}><Node index={index} /></article>)}</div></div> : <AnimatedFlow mobile={mobile} />}<div className="wa-agents-foot"><span>Illustrative research workflow · SHOP</span><p>Research to inform your thinking. The decision stays yours.</p><a className="wa-text-link" href="/login?mode=signup">Meet your research team <span aria-hidden="true">↗</span></a></div></div></section>
}
