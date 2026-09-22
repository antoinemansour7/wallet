export const OPTIONS_CALENDAR_VERSION = 'cboe-us-equity-options-2026-v1'
export const OPTIONS_TIME_ZONE = 'America/New_York'

export const OPTIONS_CALENDAR_2026 = Object.freeze({
  version: OPTIONS_CALENDAR_VERSION,
  availableAt: '2026-09-22T00:00:00.000Z',
  validFrom: '2026-01-01',
  validThrough: '2026-12-31',
  timeZone: OPTIONS_TIME_ZONE,
  source: Object.freeze({
    provider: 'cboe',
    url: 'https://www.cboe.com/about/hours/us-options',
    retrievedAt: '2026-09-22T00:00:00.000Z',
  }),
  regular: Object.freeze({ open: '09:30', close: '16:00' }),
  extended: Object.freeze({ gthOpen: '07:30', gthClose: '09:25', transitionClose: '09:30', curbOpen: '16:00', curbClose: '16:15' }),
  holidays: Object.freeze({
    '2026-01-01': "New Year's Day",
    '2026-01-19': 'Martin Luther King Jr. Day',
    '2026-02-16': "Presidents' Day",
    '2026-04-03': 'Good Friday',
    '2026-05-25': 'Memorial Day',
    '2026-06-19': 'Juneteenth',
    '2026-07-03': 'Independence Day observed',
    '2026-09-07': 'Labor Day',
    '2026-11-26': 'Thanksgiving Day',
    '2026-12-25': 'Christmas Day',
  }),
  earlyCloses: Object.freeze({
    '2026-11-27': Object.freeze({ name: 'Thanksgiving early close', close: '13:00' }),
    '2026-12-24': Object.freeze({ name: 'Christmas early close', close: '13:00' }),
  }),
})

const WATCHLIST = Object.freeze(['SNDK', 'ASTS', 'MU', 'RKLB', 'MRVL', 'IREN', 'CRDO', 'SOFI', 'CRWV', 'SPCX', 'NBIS', 'PLTR', 'HOOD', 'NVDA', 'AMD', 'ORCL', 'MSTR', 'AVGO', 'VST', 'INTC', 'SMCI', 'NOW', 'APP', 'AMZN', 'AAOI'])
const ANNOUNCED = new Set(['AMD', 'AMZN', 'AVGO', 'HOOD', 'INTC', 'MU', 'NVDA', 'ORCL', 'PLTR'])

export const OPTIONS_ELIGIBILITY_2026_09_22 = Object.freeze({
  version: 'cboe-equity-options-eligibility-2026-09-22-v1',
  availableAt: '2026-09-22T00:00:00.000Z',
  source: Object.freeze({
    provider: 'cboe',
    url: 'https://cdn.cboe.com/data/us/options/market_statistics/symbol_reference/cone-underlying.csv',
    retrievedAt: '2026-09-22T00:00:00.000Z',
    sha256: '1cf90860e2740c71c88e91d4cc90c091a3558d44e1573e948ab50b2ddf98d718',
  }),
  plannedExpansion: Object.freeze({
    effectiveAt: '2026-10-19T07:30:00-04:00',
    source: 'https://www.cboe.com/document/tech-spec/document/technical-specifications/cboe-titanium-u.s.-options-opening-process-specification',
  }),
  entries: Object.freeze(Object.fromEntries(WATCHLIST.map((symbol) => [symbol, Object.freeze({
    symbol,
    effectiveFrom: '2026-09-22T00:00:00.000Z',
    extendedHoursEligible: false,
    gthEligible: false,
    curbEligible: false,
    announcedCandidate: ANNOUNCED.has(symbol),
  })]))),
})

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: OPTIONS_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function localParts(instant) {
  const values = Object.fromEntries(formatter.formatToParts(new Date(instant)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}

export function optionsLocalParts(instant) {
  return localParts(instant)
}

function timeMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error(`Invalid market time: ${value}`)
  return Number(match[1]) * 60 + Number(match[2])
}

export function zonedMarketInstant(date, time, timeZone = OPTIONS_TIME_ZONE) {
  if (timeZone !== OPTIONS_TIME_ZONE) throw new Error('Only the versioned America/New_York options calendar is supported')
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) throw new Error('Invalid local market date/time')
  const desired = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), Number(timeMatch[1]), Number(timeMatch[2]))
  let guess = desired
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(guess)
    const actualUtcShape = Date.UTC(Number(actual.date.slice(0, 4)), Number(actual.date.slice(5, 7)) - 1, Number(actual.date.slice(8, 10)), actual.hour, actual.minute)
    const difference = desired - actualUtcShape
    guess += difference
    if (!difference) break
  }
  const resolved = localParts(guess)
  if (resolved.date !== date || resolved.hour !== Number(timeMatch[1]) || resolved.minute !== Number(timeMatch[2])) throw new Error('Local market time cannot be resolved')
  return new Date(guess).toISOString()
}

export function eligibilityFor(symbol, { asOf = Date.now(), snapshot = OPTIONS_ELIGIBILITY_2026_09_22 } = {}) {
  const ticker = String(symbol || '').trim().toUpperCase()
  if (Date.parse(snapshot.availableAt) > new Date(asOf).getTime()) return { symbol: ticker, known: false, reason: 'eligibility_snapshot_not_available' }
  const entry = snapshot.entries[ticker]
  if (!entry) return { symbol: ticker, known: false, reason: 'class_not_in_snapshot' }
  const refreshRequired = new Date(asOf).getTime() >= Date.parse(snapshot.plannedExpansion.effectiveAt)
  return { ...entry, known: true, snapshotVersion: snapshot.version, observedAt: snapshot.availableAt, refreshRequired,
    reason: refreshRequired ? 'planned_effective_date_reached_refresh_required' : null }
}

export function marketDay(date, calendar = OPTIONS_CALENDAR_2026) {
  if (date < calendar.validFrom || date > calendar.validThrough) return { date, known: false, open: false, reason: 'calendar_out_of_range' }
  const noon = zonedMarketInstant(date, '12:00', calendar.timeZone)
  const weekday = localParts(noon).weekday
  if (weekday === 'Sat' || weekday === 'Sun') return { date, known: true, open: false, reason: 'weekend' }
  if (calendar.holidays[date]) return { date, known: true, open: false, reason: 'holiday', name: calendar.holidays[date] }
  const early = calendar.earlyCloses[date]
  return { date, known: true, open: true, openTime: calendar.regular.open, closeTime: early?.close ?? calendar.regular.close,
    earlyClose: Boolean(early), name: early?.name ?? null }
}

export function optionMarketState(instant, {
  symbol,
  calendar = OPTIONS_CALENDAR_2026,
  eligibility = eligibilityFor(symbol, { asOf: instant }),
  seriesState = 'open',
} = {}) {
  const local = localParts(instant)
  const day = marketDay(local.date, calendar)
  const base = { instant: new Date(instant).toISOString(), localDate: local.date, timeZone: calendar.timeZone,
    calendarVersion: calendar.version, eligibilityVersion: eligibility.snapshotVersion ?? null, classEligibility: eligibility,
    seriesState, session: 'closed', executable: false }
  if (!day.known || !day.open) return { ...base, reason: day.reason, marketDay: day }

  const minute = local.hour * 60 + local.minute + local.second / 60
  const regularOpen = timeMinutes(day.openTime)
  const regularClose = timeMinutes(day.closeTime)
  const gthOpen = timeMinutes(calendar.extended.gthOpen)
  const gthClose = timeMinutes(calendar.extended.gthClose)
  const transitionClose = timeMinutes(calendar.extended.transitionClose)
  const curbOpen = timeMinutes(calendar.extended.curbOpen)
  const curbClose = timeMinutes(calendar.extended.curbClose)
  let session = 'closed', classAllowed = false, reason = 'outside_session'

  if (!day.earlyClose && minute >= gthOpen && minute < gthClose) {
    session = 'gth'; classAllowed = eligibility.known && eligibility.gthEligible && !eligibility.refreshRequired
    reason = classAllowed ? null : eligibility.refreshRequired ? 'eligibility_refresh_required' : 'class_not_gth_eligible'
  } else if (!day.earlyClose && minute >= gthClose && minute < transitionClose) {
    session = 'transition'; reason = 'gth_rth_transition_gap'
  } else if (minute >= regularOpen && minute < regularClose) {
    session = 'rth'; classAllowed = true; reason = null
  } else if (!day.earlyClose && minute >= curbOpen && minute < curbClose) {
    session = 'curb'; classAllowed = eligibility.known && eligibility.curbEligible && !eligibility.refreshRequired
    reason = classAllowed ? null : eligibility.refreshRequired ? 'eligibility_refresh_required' : 'class_not_curb_eligible'
  }

  const seriesAllowed = seriesState === 'open'
  if (classAllowed && !seriesAllowed) reason = seriesState === 'halted' ? 'series_halted' : 'series_not_open'
  return { ...base, session, classAllowed, seriesAllowed, executable: classAllowed && seriesAllowed, reason, marketDay: day }
}

export function regularSessionClose(date, calendar = OPTIONS_CALENDAR_2026) {
  const day = marketDay(date, calendar)
  if (!day.known || !day.open) throw new Error(`No regular options session on ${date}: ${day.reason}`)
  return zonedMarketInstant(date, day.closeTime, calendar.timeZone)
}
