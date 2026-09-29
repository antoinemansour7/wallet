import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { OPTIONS_API, useOptionsResource } from './options/useOptionsResource'
import { words } from './options/display'
import '../components/landing/tokens.css'
import './Options.css'
import './OptionsResults.css'

// Plain-language results for the morning options picks: every number comes
// from the server (see src/server/options/resultsView.js); this page only
// words and formats it.

const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
const utcNoon = (date) => new Date(`${date}T12:00:00Z`)
const NY_MOMENT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
// "Thu Oct 1, 3:55 PM ET": an older pick's last price may be from another day.
const moment = (instant) => (instant && Number.isFinite(Date.parse(instant)) ? `${NY_MOMENT.format(new Date(instant)).replace(/^(\w+),/, '$1')} ET` : 'an unknown time')
const dayName = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(date || '') ? WEEKDAY.format(utcNoon(date)).replace(',', '') : 'Unknown day')
const monthDay = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(date || '') ? MONTH_DAY.format(utcNoon(date)) : 'unknown date')
const usd = (value) => (Number.isFinite(value) ? `$${value.toLocaleString('en-US', { maximumFractionDigits: value < 10 ? 2 : 0, minimumFractionDigits: value < 10 ? 2 : 0 })}` : '—')
const pct = (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%` : '—')
const tone = (value) => (value > 0 ? 'up' : 'down')
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const strike = (value) => (Number.isFinite(value) ? `$${Number.isInteger(value) ? value : value.toFixed(2)}` : 'unknown strike')

const UNTRACKED = { outcome_plan_unavailable: 'its tracking plan was never saved', frozen_entry_quote_unavailable: 'its buy price was not saved' }
const EMPTY_DAY = { empty: 'No picks that morning', degraded: 'The scan was incomplete, so no picks', missing: 'No scan that morning', pending: 'Picks not published yet' }

function dayStatus(day) {
  if (!day.picks.length) return EMPTY_DAY[day.status] || 'No picks'
  const { up, down, won, lost } = day.counts
  if (won + lost) return `Day 3: ${won} won · ${lost} lost`
  return [up + down ? `Right now ${up} up · ${down} down` : 'No prices yet', day.day3Date && `Day 3 result on ${dayName(day.day3Date)}`].filter(Boolean).join('  ·  ')
}

function Days({ data }) {
  return <>
    <header className="results-header"><div>
      <span className="options-label">Options · morning picks</span><h1>How the picks are doing</h1>
      <p>Each morning the app picks a few options. Here is what each one would be worth if you had bought it.</p>
    </div></header>
    <ol className="results-days" aria-label="Mornings">{data.days.map((day) => <li key={day.tradingDate}>
      {day.picks.length
        ? <Link to={`/options/results/${day.tradingDate}`}><strong>{dayName(day.tradingDate)}</strong><span>{plural(day.picks.length, 'pick')}</span><span>{dayStatus(day)}</span><span aria-hidden="true">→</span></Link>
        : <div className="results-day-empty"><strong>{dayName(day.tradingDate)}</strong><span>{dayStatus(day)}</span></div>}
    </li>)}</ol>
  </>
}

function DayResult({ point }) {
  if (point.state === 'observed') return <span data-tone={tone(point.returnPct)}>{pct(point.returnPct)}</span>
  if (point.state === 'pending') return <span className="results-muted">on {dayName(point.date)}</span>
  if (point.state === 'expired') return <span className="results-muted">expired before</span>
  if (point.state === 'not_tracked') return <span className="results-muted">—</span>
  return <span className="results-muted">not recorded</span>
}

function Pick({ pick }) {
  return <article className="results-pick" aria-label={`${pick.ticker} ${pick.direction}`}>
    <div className="results-pick-head">
      <div><h2>#{pick.rank} {pick.ticker}</h2>
        <p>Bet the stock goes {pick.direction === 'call' ? 'up' : 'down'} · {strike(pick.strikePrice)} by {monthDay(pick.expirationDate)}</p></div>
      {pick.result && <span className="results-badge" data-result={pick.result}>{pick.result === 'won' ? '✓ Won' : '✗ Lost'}</span>}
    </div>
    {pick.tracked ? <>
      <dl className="results-money">
        <div><dt>Paid</dt><dd>{usd(pick.paidUsd)}</dd></div>
        <div><dt>Worth now</dt><dd>{pick.now ? usd(pick.now.valueUsd) : 'No price yet'}</dd></div>
        {pick.now && <div><dt>Change</dt><dd data-tone={tone(pick.now.returnPct)}>{pct(pick.now.returnPct)} {pick.now.returnPct > 0 ? '▲' : '▼'}</dd></div>}
      </dl>
      {pick.now && <p className="results-muted">{pick.expired ? 'Expired · last price' : 'Price as of'} {moment(pick.now.at)}</p>}
    </> : <p className="results-untracked">Not tracked: {UNTRACKED[pick.untrackedReason] || words(pick.untrackedReason).toLowerCase()}.</p>}
    <ul className="results-by-day" aria-label="Results by day">{Object.entries(pick.days).map(([day, point]) => <li key={day}><span>Day {day}</span><DayResult point={point} /></li>)}</ul>
  </article>
}

function Morning({ day }) {
  if (!day) return <p className="results-empty">This morning isn’t in the results.</p>
  const { up, down, won, lost, notTracked } = day.counts
  const sentences = [
    up + down ? `Right now ${up} ${up === 1 ? 'is' : 'are'} up and ${down} ${down === 1 ? 'is' : 'are'} down.` : null,
    won + lost ? `Day 3: ${won} won, ${lost} lost.` : day.day3Date ? `Day 3 result on ${dayName(day.day3Date)}.` : null,
    notTracked ? `${plural(notTracked, 'pick')} ${notTracked === 1 ? 'is' : 'are'} not tracked.` : null,
  ].filter(Boolean)
  return <>
    <header className="results-header"><div>
      <span className="options-label">Options · morning picks</span>
      <h1>{dayName(day.tradingDate)} · {plural(day.picks.length, 'pick')}</h1>
    </div></header>
    {day.picks.length
      ? <>
        <section className="results-summary" aria-label="How this morning is doing"><p>{sentences.join(' ')}</p></section>
        {day.picks.map((pick) => <Pick key={pick.id} pick={pick} />)}
      </>
      : <p className="results-empty">{EMPTY_DAY[day.status] || 'No picks'}.</p>}
  </>
}

function Results({ user }) {
  const { date } = useParams()
  const { verified, denied, error, data } = useOptionsResource(user, `${OPTIONS_API}&view=results`)
  if (denied) return <Navigate to="/portfolio" replace />
  if (!verified) return error ? <Navigate to="/portfolio" replace /> : null
  const results = data?.results
  return <div className="wallai-system options-workspace results-workspace">
    <nav className="results-nav" aria-label="Options pages">
      {date ? <Link to="/options/results">← All days</Link> : <Link to="/options">← Today’s picks</Link>}
    </nav>
    {error && <p className="options-notice" role="alert">{error.message}</p>}
    {results && (date ? <Morning day={results.days.find((day) => day.tradingDate === date)} /> : <Days data={results} />)}
    {results && <footer className="results-footer">
      <p>“Paid” is what one contract (100 shares) cost, including the fee. “Worth now” is what you would get selling it now, after the fee. A pick wins if it is worth more than you paid at the close of day 3.</p>
      <p><Link to="/options/testing">Full data</Link> · no real money involved</p>
    </footer>}
  </div>
}

export default function OptionsResults() {
  const { user } = useAuth()
  return <Results key={user?.uid || 'signed-out'} user={user} />
}
