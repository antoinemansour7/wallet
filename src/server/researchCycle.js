// ─── Research cycles ───────────────────────────────────────────────────────────
// research:latest is a single key, so every run used to replace the one before
// it. That is right for the scheduled run but wrong for a rerun triggered
// between scheduled runs: a manual run twelve minutes later reads a slightly
// different tape, produces a different five, and the earlier board is gone even
// where it scored better.
//
// A cycle is the span between scheduled runs. Within one, runs accumulate and
// picks compete on finalScore; the next scheduled hour starts a clean board, so
// nothing carries from yesterday into today and the board still rotates with
// the tape.

export const DEFAULT_CYCLE_HOUR_UTC = 7

/**
 * The scheduled hour that opens a cycle, matching the cron in vercel.json.
 *
 * The empty string is checked before the conversion because Number('') is 0,
 * which is a valid hour — an unset or blank variable would otherwise move every
 * cycle boundary to midnight rather than falling back here.
 */
export function cycleHourUtc() {
  const raw = process.env.RESEARCH_CYCLE_HOUR_UTC
  if (raw == null || String(raw).trim() === '') return DEFAULT_CYCLE_HOUR_UTC
  const configured = Number(raw)
  return Number.isInteger(configured) && configured >= 0 && configured <= 23
    ? configured
    : DEFAULT_CYCLE_HOUR_UTC
}

/** Start of the cycle `now` falls in: the most recent scheduled hour at or before it. */
export function cycleStart(now = new Date(), hourUtc = cycleHourUtc()) {
  const start = new Date(now)
  start.setUTCHours(hourUtc, 0, 0, 0)
  if (start.getTime() > now.getTime()) start.setUTCDate(start.getUTCDate() - 1)
  return start
}

/** Whether a stored payload belongs to the cycle in progress. */
export function isSameCycle(generatedAt, now = new Date(), hourUtc = cycleHourUtc()) {
  if (!generatedAt) return false
  const at = new Date(generatedAt).getTime()
  if (!Number.isFinite(at)) return false
  return at >= cycleStart(now, hourUtc).getTime()
}

/**
 * The score a pick competes on. finalizePicks writes finalScore; the fallback
 * mirrors the one runPremarketCheck already uses, so a pick that never reached
 * finalizePicks still ranks somewhere sensible rather than last.
 */
export function pickScore(pick) {
  const score = Number(pick?.finalScore)
  if (Number.isFinite(score)) return score
  const conviction = Number(pick?.conviction)
  return (Number.isFinite(conviction) ? conviction : 5) * 1.5
}

/**
 * Combine the picks already stored this cycle with the ones this run produced,
 * keeping the highest scorers.
 *
 * A ticker in both is kept whole from whichever run scored it higher, rather
 * than assembled from both. The score belongs to the evidence that produced it,
 * so pairing one run's score with another run's report, price and catalyst
 * verification would describe a pick that no run actually made. Ties go to the
 * current run, whose evidence is fresher.
 *
 * The board never shrinks below what either side held, so a run whose
 * extraction came back empty leaves the cycle's board standing instead of
 * clearing it.
 */
export function mergePicksByScore(carried = [], current = [], { limit } = {}) {
  const best = new Map()
  for (const pick of [...current, ...carried]) {
    if (!pick?.ticker) continue
    const held = best.get(pick.ticker)
    if (!held || pickScore(pick) > pickScore(held)) best.set(pick.ticker, pick)
  }

  const size = Number.isFinite(limit) ? limit : Math.max(current.length, carried.length)
  return [...best.values()]
    .sort((a, b) => pickScore(b) - pickScore(a) || a.ticker.localeCompare(b.ticker))
    .slice(0, Math.max(0, size))
}
