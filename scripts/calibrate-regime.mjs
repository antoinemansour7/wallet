/**
 * Does the regime score actually predict anything, on this account's own picks?
 *
 * Weights invented by eye are just another arbitrary number wearing a lab coat.
 * This replays the score over every date the pipeline has tracked picks for and
 * checks whether a poor tape really did precede worse outcomes.
 *
 * No lookahead: the regime for a pick made overnight on date D is computed from
 * data through D-1, which is all the pipeline could have seen at 03:00 UTC.
 *
 *   node scripts/calibrate-regime.mjs
 */
import { getAllPerformanceRecords } from '../src/server/agents/signalHistoryTools.js'
import {
  REGIME_SYMBOLS,
  REGIME_WEIGHTS,
  fetchRegimeSeries,
  computeRegime,
} from '../src/server/marketRegime.js'

const HORIZONS = ['return_day1', 'return_day3', 'return_day5', 'return_day10']

function prevDay(date) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Spearman rank correlation — robust to outliers and to a non-linear link. */
function spearman(xs, ys) {
  const n = xs.length
  if (n < 4) return null
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
    const r = new Array(n)
    for (let i = 0; i < n;) {
      let j = i
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j += 1
      const avg = (i + j) / 2 + 1
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg
      i = j + 1
    }
    return r
  }
  const rx = rank(xs)
  const ry = rank(ys)
  const mx = mean(rx)
  const my = mean(ry)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my)
    dx += (rx[i] - mx) ** 2
    dy += (ry[i] - my) ** 2
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null
}

const records = await getAllPerformanceRecords()
if (records.length === 0) {
  console.error('No performance records found — nothing to calibrate against.')
  process.exit(1)
}

const byDate = new Map()
for (const r of records) {
  if (!r.pickDate) continue
  if (!byDate.has(r.pickDate)) byDate.set(r.pickDate, [])
  byDate.get(r.pickDate).push(r)
}
const dates = [...byDate.keys()].sort()

console.log(`records: ${records.length} across ${dates.length} dates (${dates[0]} -> ${dates.at(-1)})`)
console.log('fetching macro series...')

const series = Object.fromEntries(await Promise.all(
  Object.entries(REGIME_SYMBOLS).map(async ([key, symbol]) => {
    const s = await fetchRegimeSeries(symbol)
    return [key, s]
  })
))
for (const [k, v] of Object.entries(series)) {
  if (v.length === 0) console.warn(`  WARNING: no data for ${k} (${REGIME_SYMBOLS[k]})`)
}

// One row per date: the regime that was knowable, and what the picks then did.
const rows = []
for (const date of dates) {
  const regime = computeRegime(series, prevDay(date))
  if (!regime) continue
  const picks = byDate.get(date)
  const row = { date, score: regime.score, n: picks.length, components: {} }
  for (const c of regime.components) row.components[c.key] = c.score
  for (const h of HORIZONS) {
    const vals = picks.map((p) => p[h]).filter(Number.isFinite)
    row[h] = vals.length ? mean(vals) : null
    row[`${h}_n`] = vals.length
  }
  rows.push(row)
}

console.log()
console.log('DATE         regime   n    d1      d3      d5     d10')
console.log('-'.repeat(60))
for (const r of rows) {
  const f = (v) => (v == null ? '   -  ' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`.padStart(7))
  console.log(`${r.date}  ${String(r.score).padStart(5)}  ${String(r.n).padStart(3)} ${f(r.return_day1)} ${f(r.return_day3)} ${f(r.return_day5)} ${f(r.return_day10)}`)
}

console.log()
console.log('CORRELATION — composite regime vs mean forward return')
console.log('-'.repeat(60))
for (const h of HORIZONS) {
  const usable = rows.filter((r) => r[h] != null)
  const rho = spearman(usable.map((r) => r.score), usable.map((r) => r[h]))
  console.log(`  ${h.padEnd(14)} n=${String(usable.length).padStart(3)}  spearman=${rho == null ? 'n/a' : (rho >= 0 ? '+' : '') + rho.toFixed(3)}`)
}

console.log()
console.log('CORRELATION — each component vs return_day5 (which component carries the signal?)')
console.log('-'.repeat(60))
const usable5 = rows.filter((r) => r.return_day5 != null)
const perComponent = []
for (const key of Object.keys(REGIME_WEIGHTS)) {
  const have = usable5.filter((r) => r.components[key] != null)
  if (have.length < 5) { console.log(`  ${key.padEnd(14)} insufficient data`); continue }
  const rho = spearman(have.map((r) => r.components[key]), have.map((r) => r.return_day5))
  perComponent.push({ key, rho, n: have.length })
  console.log(`  ${key.padEnd(14)} n=${String(have.length).padStart(3)}  spearman=${rho == null ? 'n/a' : (rho >= 0 ? '+' : '') + rho.toFixed(3)}  weight=${REGIME_WEIGHTS[key]}`)
}

console.log()
console.log('SPLIT — picks made on the worst vs best half of tapes')
console.log('-'.repeat(60))
const ranked = [...rows].sort((a, b) => a.score - b.score)
const half = Math.floor(ranked.length / 2)
for (const h of HORIZONS) {
  const lo = ranked.slice(0, half).map((r) => r[h]).filter(Number.isFinite)
  const hi = ranked.slice(-half).map((r) => r[h]).filter(Number.isFinite)
  if (!lo.length || !hi.length) continue
  const l = mean(lo)
  const g = mean(hi)
  console.log(`  ${h.padEnd(14)} weak tape ${(l >= 0 ? '+' : '') + l.toFixed(2)}%   strong tape ${(g >= 0 ? '+' : '') + g.toFixed(2)}%   spread ${(g - l >= 0 ? '+' : '') + (g - l).toFixed(2)}pp`)
}

console.log()
console.log('READ THIS BEFORE TRUSTING THE NUMBERS')
console.log('-'.repeat(60))
console.log(`  Every pick on a date shares one regime score, so the effective sample is`)
console.log(`  ${rows.length} tapes, not ${records.length} picks. At that size a |rho| under about 0.4 is`)
console.log('  indistinguishable from noise, and the window covers a single month —')
console.log('  one regime, not a cycle. Treat a weak result as "unproven", not "refuted".')
