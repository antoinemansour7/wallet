import Brand from './Brand'

export default function Closing() {
  return <section className="wa-closing wa-dark" aria-labelledby="closing-title"><div className="wa-container"><div className="wa-closing-content"><span className="wa-closing-mark" aria-hidden="true">✳</span><p className="wa-eyebrow">A clearer view of what investing costs</p><h2 id="closing-title">See your costs.<br /><span>Find your clarity.</span></h2><p>Withholding, fund fees, FX costs and contribution room.<br />Get to know the Tax & costs side of your portfolio.</p><a href="/login?mode=signup" className="wa-button wa-button-light">Understand your costs <span aria-hidden="true">↗</span></a><small>Free during beta. No money moves.</small></div><footer className="wa-footer"><Brand /><nav aria-label="Footer navigation"><a href="#features">Tax & costs</a><a href="#research-engine">Research engine</a><a href="/login">Log in ↗</a></nav><span>© {new Date().getFullYear()} WallAI</span></footer></div></section>
}
