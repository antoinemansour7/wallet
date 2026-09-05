/**
 * Historical USD/CAD rates, for converting a trade at the rate that existed
 * on its own date rather than today's.
 *
 * Source is the Bank of Canada's Valet API — free, keyless, and the rate the
 * CRA itself points at, which matters more here than a marginally tighter
 * number from elsewhere: a figure someone can reconcile against the same
 * source their accountant uses is worth more than a more precise one they
 * cannot check.
 *
 *   https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json
 *     ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *
 * Confirmed against the live endpoint before writing this: weekends and
 * holidays are simply absent from `observations` rather than carrying a
 * zero or a repeated value, which is why resolution has to walk backward to
 * the last published date instead of expecting one for every calendar day.
 *
 * Three rules, load-bearing enough to repeat here as well as in the tests:
 *
 *   · **One range, not one request per date.** Plaid can hand this module 24
 *     months of trade dates in one import; fetching each individually would
 *     be hundreds of requests for a fact the API already returns as a range.
 *   · **A rate never changes once published**, so anything resolved is
 *     permanently cacheable — there is no TTL here the way there is for a
 *     live quote.
 *   · **Never forward, never defaulted.** A date resolves only to a rate
 *     published on or before it. A gap returns `null` and stays `null`
 *     rather than becoming 1 or today's rate — a tax figure that is visibly
 *     missing is recoverable; one that is silently wrong is not.
 */

const BOC_SERIES = 'FXUSDCAD'
const BOC_BASE = 'https://www.bankofcanada.ca/valet/observations'

/** Enough to cross a long weekend and still resolve backward to a rate. */
const FETCH_PAD_DAYS = 7

function shiftIsoDate(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

/** The Valet response into plain `{ date, rate }` pairs. */
export function parseObservations(raw) {
  const observations = raw?.observations
  if (!Array.isArray(observations)) return []

  const parsed = []
  for (const obs of observations) {
    const value = obs?.[BOC_SERIES]?.v
    // A day with no published rate omits the field rather than sending a
    // zero. Treating a missing value as 0 would corrupt every figure that
    // reads it, so it is skipped rather than parsed.
    if (value === undefined || value === null) continue
    const rate = Number(value)
    if (!Number.isFinite(rate)) continue
    parsed.push({ date: obs.d, rate })
  }
  return parsed
}

/** Sorted ascending by date, which is what resolution walks over. */
export function buildRateIndex(observations) {
  return [...observations].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * The last published rate on or before `date`, via binary search since an
 * import's index can span hundreds of trading days.
 *
 * Deliberately one-directional. Resolving forward — using a rate from days
 * after the requested date because it happened to be closer — would answer a
 * different question than the one asked: what rate applied *on* this trade.
 */
export function resolveRateForDate(index, date) {
  let lo = 0
  let hi = index.length - 1
  let found = -1

  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (index[mid].date <= date) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  if (found === -1) return null
  return { rate: index[found].rate, asOf: index[found].date }
}

/**
 * The range to fetch for a batch of dates: one call spanning all of them.
 *
 * No padding by default — this is a pure description of the requested span,
 * and a caller that wants headroom for weekend/holiday resolution at the
 * edge asks for it explicitly via `padDays`.
 */
export function windowFor(dates, { padDays = 0 } = {}) {
  if (!dates.length) return null
  const sorted = [...dates].sort()
  return {
    startDate: padDays ? shiftIsoDate(sorted[0], -padDays) : sorted[0],
    endDate: sorted[sorted.length - 1],
  }
}

/** The live call. Kept thin — every rule that matters lives in the pure functions above. */
export async function fetchFxRange({ startDate, endDate }) {
  const url = `${BOC_BASE}/${BOC_SERIES}/json?start_date=${startDate}&end_date=${endDate}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Bank of Canada FX request failed: ${response.status}`)
  return response.json()
}

/**
 * Resolves a rate for every requested date, fetching at most one range for
 * whatever the cache does not already cover.
 *
 * `cache` is `{ getMany(dates) => Map, setMany(entries) }` or `null` to skip
 * caching (a fresh serverless invocation with nothing configured still works
 * correctly — it just fetches every time, which one range per import already
 * makes cheap).
 */
export async function getRatesForDates(dates, { fetchRange = fetchFxRange, cache = null } = {}) {
  const unique = [...new Set(dates)]
  const result = new Map()
  if (!unique.length) return result

  let toFetch = unique
  if (cache) {
    const cached = await cache.getMany(unique)
    for (const [date, value] of cached) result.set(date, value)
    toFetch = unique.filter((date) => !cached.has(date))
  }

  if (toFetch.length) {
    const window = windowFor(toFetch, { padDays: FETCH_PAD_DAYS })
    const raw = await fetchRange(window)
    const index = buildRateIndex(parseObservations(raw))

    const newEntries = []
    for (const date of toFetch) {
      const resolved = resolveRateForDate(index, date)
      const value = resolved ? { rate: resolved.rate, source: 'boc', asOf: resolved.asOf } : null
      result.set(date, value)
      // A resolved rate is cached; a gap is not. A date that resolves once
      // the index eventually reaches further back should get the chance to
      // resolve on a later call rather than being pinned to null forever.
      if (value) newEntries.push([date, value])
    }

    if (cache && newEntries.length) await cache.setMany(newEntries)
  }

  return result
}

export async function getRateForDate(date, options) {
  const result = await getRatesForDates([date], options)
  return result.get(date) ?? null
}
