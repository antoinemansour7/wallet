// Pure presentation math over the shadow rows the server evaluated. Every
// aggregate carries its own denominator; unknown outcomes are counted as
// unknown, never as zero.
export const SCORE_BANDS = Object.freeze([
  { id: '80', label: '80 and above', min: 80, max: Infinity },
  { id: '60', label: '60–79', min: 60, max: 80 },
  { id: '40', label: '40–59', min: 40, max: 60 },
  { id: '0', label: 'Below 40', min: -Infinity, max: 40 },
])
export const DTE_COHORTS = Object.freeze([
  { id: '14', label: '14 days or fewer', min: -Infinity, max: 15 },
  { id: '30', label: '15–30 days', min: 15, max: 31 },
  { id: '45', label: '31–45 days', min: 31, max: 46 },
  { id: 'long', label: 'Over 45 days', min: 46, max: Infinity },
])
export const ROW_STATUSES = Object.freeze(['open', 'completed', 'expired', 'missing'])
const NOT_MATURED = new Set(['unexpired_horizon', 'unavailable', 'contract_expired_before_endpoint', 'unknown_expiry_session'])
const NOT_SCHEDULED = new Set(['unavailable', 'contract_expired_before_endpoint', 'unknown_expiry_session'])

const band = (bands, value) => Number.isFinite(value) ? bands.find((item) => value >= item.min && value < item.max)?.id ?? null : null
export const scoreBand = (score) => band(SCORE_BANDS, score)
export const dteCohort = (dte) => band(DTE_COHORTS, dte)
export const checkpointFor = (row, key) => row.checkpoints?.find((item) => item.key === key) || null

export function filterShadowRows(rows, { date = 'all', ticker = 'all', direction = 'all', score = 'all', dte = 'all', horizon = 'latest', status = 'all' } = {}) {
  return rows.filter((row) => (date === 'all' || row.tradingDate === date)
    && (ticker === 'all' || row.ticker === ticker)
    && (direction === 'all' || row.direction === direction)
    && (score === 'all' || scoreBand(row.score) === score)
    && (dte === 'all' || dteCohort(row.dteAtSelection) === dte)
    && (status === 'all' || row.status === status)
    // A horizon narrows to picks it applies to; picks without outcome data stay visible.
    && (horizon === 'latest' || row.status === 'missing' || !NOT_SCHEDULED.has(checkpointFor(row, horizon)?.status ?? 'unavailable')))
}

const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const extreme = (items, pick) => items.reduce((best, item) => (!best || pick(item.returnPct, best.returnPct) ? item : best), null)

export function summarizeShadowRows(rows, checkpoints) {
  const horizons = checkpoints.map(({ key, label }) => {
    const matured = rows.filter((row) => { const point = checkpointFor(row, key); return point && !NOT_MATURED.has(point.status) })
    const observed = matured.map((row) => ({ row, returnPct: checkpointFor(row, key).returnPct })).filter((item) => Number.isFinite(item.returnPct))
    const values = observed.map((item) => item.returnPct)
    const describe = (item) => item && { ticker: item.row.ticker, direction: item.row.direction, tradingDate: item.row.tradingDate, contractId: item.row.contractId, returnPct: item.returnPct }
    return {
      key, label, matured: matured.length, observed: observed.length, unknown: matured.length - observed.length,
      positive: values.filter((value) => value > 0).length, negative: values.filter((value) => value < 0).length,
      flat: values.filter((value) => value === 0).length,
      medianReturnPct: median(values), meanReturnPct: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      best: describe(extreme(observed, (a, b) => a > b)), worst: describe(extreme(observed, (a, b) => a < b)),
    }
  })
  const covered = rows.filter((row) => row.path?.observed > 0)
  const targetPcts = [...new Set(rows.flatMap((row) => (row.targets || []).map((target) => target.targetPct)))].sort((a, b) => a - b)
  const targets = targetPcts.map((targetPct) => {
    const hits = covered.filter((row) => row.targets.some((target) => target.targetPct === targetPct && target.state === 'observed_hit'))
    return { targetPct, covered: covered.length, hits: hits.length,
      hitsWhileOtm: hits.filter((row) => row.targets.find((target) => target.targetPct === targetPct).whileOtm === true).length }
  })
  const determinable = rows.filter((row) => row.gainedWhileOtm !== null && row.gainedWhileOtm !== undefined)
  return {
    published: rows.length,
    statusCounts: Object.fromEntries(ROW_STATUSES.map((status) => [status, rows.filter((row) => row.status === status).length])),
    horizons, targets,
    gainedWhileOtm: { count: determinable.filter((row) => row.gainedWhileOtm).length, determinable: determinable.length },
  }
}
