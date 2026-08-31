import { collection, doc, getDocs, orderBy, query, setDoc, limit } from 'firebase/firestore'
import { db } from '../firebase/config'

const LOCAL_KEY = 'wallai:portfolio-history'
const MAX_DAYS = 365

function historyCollection(uid) {
  return collection(db, 'users', uid, 'portfolio-history')
}

function todayKey() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

/**
 * Device-local snapshot history. Kept alongside Firestore so the performance
 * chart still accumulates data when the cloud write is rejected (e.g. by
 * security rules) — those failures were previously swallowed silently.
 */
export function loadLocalHistory() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveLocalSnapshot(entry) {
  try {
    const history = loadLocalHistory().filter((d) => d.date !== entry.date)
    history.push(entry)
    history.sort((a, b) => a.date.localeCompare(b.date))
    localStorage.setItem(LOCAL_KEY, JSON.stringify(history.slice(-MAX_DAYS)))
  } catch {
    // localStorage unavailable or full — cloud copy is still attempted
  }
}

/** Merge remote and local histories: dedupe by date, remote wins, sorted. */
export function mergeHistory(remote, local) {
  const byDate = new Map()
  for (const entry of [...local, ...remote]) {
    if (entry?.date) byDate.set(entry.date, entry)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Save a daily snapshot of portfolio value.
 * Writes at most once per day (keyed by date), to localStorage always and to
 * Firestore when permitted. Cloud failures are logged loudly — a silent
 * failure here cost two weeks of history once.
 */
/**
 * Cash is stored alongside the total rather than folded into it. A snapshot
 * that only records one number cannot tell a deposit apart from a gain, so a
 * day where $5k was paid in looks identical to a day where the holdings rose
 * $5k — which is exactly the ambiguity the reconstructed chart inherits when it
 * applies today's cash balance across all of history. Recording the split now
 * is what makes a contribution-adjusted return possible later; it cannot be
 * backfilled once the day has passed.
 */
export async function saveDailySnapshot(uid, {
  totalMarketValue,
  totalBookValue,
  totalPnl,
  totalCashValue,
  positionMarketValue,
}) {
  if (!uid || !totalMarketValue) return

  const entry = {
    date: todayKey(),
    marketValue: totalMarketValue,
    bookValue: totalBookValue ?? 0,
    pnl: totalPnl ?? 0,
    cashValue: totalCashValue ?? 0,
    positionValue: positionMarketValue ?? (totalMarketValue - (totalCashValue ?? 0)),
    ts: Date.now(),
  }

  saveLocalSnapshot(entry)

  try {
    await setDoc(doc(db, 'users', uid, 'portfolio-history', entry.date), entry, { merge: true })
  } catch (err) {
    console.error(
      `[portfolioHistory] Firestore snapshot write failed (${err.code || err.message}).`
      + ' If this is permission-denied, allow the "portfolio-history" subcollection'
      + ' under users/{uid} in your Firestore security rules.'
    )
  }
}

// ─── Intraday tracking (device-local) ──────────────────────────────────────
// Points recorded while the app is open power the 1D chart view, so the
// performance chart shows a live line on day one instead of waiting for
// daily snapshots to accumulate.

const INTRADAY_KEY = 'wallai:intraday-history'
const INTRADAY_MIN_GAP_MS = 2 * 60 * 1000
const INTRADAY_MAX_POINTS = 300

export function recordIntradayPoint({ totalMarketValue } = {}) {
  if (!Number.isFinite(totalMarketValue) || totalMarketValue <= 0) return
  try {
    const today = todayKey()
    const raw = localStorage.getItem(INTRADAY_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    const data = parsed && parsed.date === today && Array.isArray(parsed.points)
      ? parsed
      : { date: today, points: [] }

    const last = data.points[data.points.length - 1]
    if (last && Date.now() - last.ts < INTRADAY_MIN_GAP_MS) return

    data.points.push({ ts: Date.now(), marketValue: totalMarketValue })
    data.points = data.points.slice(-INTRADAY_MAX_POINTS)
    localStorage.setItem(INTRADAY_KEY, JSON.stringify(data))
  } catch {
    // non-critical
  }
}

export function loadIntradayPoints() {
  try {
    const raw = localStorage.getItem(INTRADAY_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && parsed.date === todayKey() && Array.isArray(parsed.points)) {
      return parsed.points
    }
    return []
  } catch {
    return []
  }
}

/**
 * Load portfolio value history (up to 365 days), merging the Firestore copy
 * with the device-local fallback.
 */
export async function loadHistory(uid) {
  const local = loadLocalHistory()
  if (!uid) return local

  try {
    const q = query(
      historyCollection(uid),
      orderBy('date', 'asc'),
      limit(MAX_DAYS),
    )
    const snap = await getDocs(q)
    return mergeHistory(snap.docs.map((d) => d.data()), local)
  } catch (err) {
    console.error(
      `[portfolioHistory] Firestore history read failed (${err.code || err.message})`
      + ' — using device-local history only. Check Firestore security rules for'
      + ' the "portfolio-history" subcollection.'
    )
    return local
  }
}
