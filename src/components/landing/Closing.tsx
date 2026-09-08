import Brand from './Brand'

export default function Closing() {
  return <section className="wa-closing wa-dark" aria-labelledby="closing-title"><div className="wa-container"><div className="wa-closing-content"><span className="wa-closing-mark" aria-hidden="true">✳</span><p className="wa-eyebrow">Your next chapter starts with clarity</p><h2 id="closing-title">Take a step back.<br /><span>See a little further.</span></h2><p>Your investments, your research, your perspective.<br />All together with WallAI.</p><a href="/login?mode=signup" className="wa-button wa-button-light">Make room for clarity <span aria-hidden="true">↗</span></a><small>Free during beta. No money moves.</small></div><footer className="wa-footer"><Brand /><nav aria-label="Footer navigation"><a href="#one-view">Your portfolio</a><a href="#agents">Your research</a><a href="/login">Log in ↗</a></nav><span>© {new Date().getFullYear()} WallAI</span></footer></div></section>
}
