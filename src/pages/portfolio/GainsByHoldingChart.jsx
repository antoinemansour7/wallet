import { useState } from 'react'
import { fmtCurrency } from '../../utils/portfolioStats'
import { holdingDrivers } from './chartAnalytics'
import ChartPanel from './ChartPanel'

export default function GainsByHoldingChart({ rows, currency }) {
  const [mode, setMode] = useState('Open gains')
  const [expanded, setExpanded] = useState(false)
  const { items, missing } = holdingDrivers(rows, mode === 'Today' ? 'DAY CHANGE' : 'UNREALIZED GAIN/LOSS')
  const visible = expanded ? items : items.slice(0, 6)
  const max = Math.max(...items.map((item) => Math.abs(item.value)), 1)
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const signed = (value) => `${value >= 0 ? '+' : '−'}${fmtCurrency(Math.abs(value))}`
  return <ChartPanel title="Gains by holding" meta={currency} className="drivers-panel">
    <div className="analytics-subhead"><p>Which investments made the difference</p><div className="analytics-segmented">{['Open gains', 'Today'].map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setExpanded(false) }}>{value}</button>)}</div></div>
    <div className="drivers-total"><strong className={total > 0 ? 'analytics-gain' : total < 0 ? 'analytics-loss' : ''}>{items.length ? signed(total) : '—'}</strong><span>{mode === 'Today' ? 'Reported daily change' : 'Reported unrealized gain / loss'}</span></div>
    {items.length ? <><div className="drivers-scale"><span>Loss</span><span>0</span><span>Gain</span></div><ol className="drivers-list">{visible.map((item) => <li key={item.symbol}><div className="driver-label"><strong>{item.symbol}</strong><span title={item.description}>{item.description}</span></div><div className="driver-track" aria-hidden="true"><span className={item.value >= 0 ? 'is-gain' : 'is-loss'} style={{ width: `${Math.abs(item.value) / max * 50}%`, left: item.value >= 0 ? '50%' : `${50 - Math.abs(item.value) / max * 50}%` }} /></div><span className={`driver-value ${item.value > 0 ? 'analytics-gain' : item.value < 0 ? 'analytics-loss' : ''}`}>{signed(item.value)}</span></li>)}</ol>{items.length > 6 && <button type="button" className="analytics-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : `View all ${items.length} holdings`} <span aria-hidden="true">{expanded ? '−' : '+'}</span></button>}</> : <div className="analytics-empty"><p>{mode === 'Today' ? 'Daily changes aren’t available for these holdings yet.' : 'No open gains have been reported for these holdings.'}</p></div>}
    <p className="analytics-panel-note">{mode === 'Today' ? 'Daily price changes from the latest available quotes. Holdings may update at different times.' : 'Gains on investments you still own. Excludes sold investments, income, and fees.'}{missing > 0 ? ` ${missing} position${missing === 1 ? ' has' : 's have'} no reported ${mode === 'Today' ? 'daily change' : 'gain or loss'}.` : ''}</p>
  </ChartPanel>
}
