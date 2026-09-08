import { useState } from 'react'

// Institution profiles already represented in currencyConversion.js. A profile
// doesn't guarantee Plaid coverage; copy explicitly includes statement import.
const brokerages = ['Wealthsimple', 'Questrade', 'Interactive Brokers', 'RBC Direct Investing', 'TD Direct Investing', 'BMO InvestorLine']
export default function Brokerages({ reduced }: { reduced: boolean }) {
  const [paused, setPaused] = useState(false)
  return <section className="wa-brokerages" aria-labelledby="brokerages-title">
    <div className="wa-container wa-brokerage-heading"><h2 id="brokerages-title">Different brokerages. One view of your costs.</h2>{!reduced && <button type="button" className="wa-marquee-control" onClick={() => setPaused(value => !value)} aria-pressed={paused}>{paused ? 'Resume' : 'Pause'} <span aria-hidden="true">{paused ? '▷' : 'Ⅱ'}</span><span className="wa-sr-only"> brokerage animation</span></button>}</div>
    <div className={`wa-marquee ${reduced ? 'wa-marquee-static' : ''}`} data-paused={paused}>
      <div className="wa-marquee-track">{[0, ...(reduced ? [] : [1])].map(copy => <ul key={copy} aria-hidden={copy === 1 ? true : undefined}>{brokerages.map(name => <li key={name}><span aria-hidden="true">✳</span>{name}</li>)}</ul>)}</div>
    </div>
    <p className="wa-container wa-brokerage-note">Connect or import. Direct connection availability varies by institution and account.</p>
  </section>
}
