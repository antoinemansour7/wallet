import { collection, doc, getDocs, orderBy, query, setDoc, limit } from 'firebase/firestore'
import { db } from '../firebase/config'

function historyCollection(uid) {
  return collection(db, 'users', uid, 'portfolio-history')
}

function todayKey() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

/**
 * Save a daily snapshot of portfolio value.
 * Writes at most once per day (keyed by date).
 */
export async function saveDailySnapshot(uid, { totalMarketValue, totalBookValue, totalPnl }) {
  if (!uid || !totalMarketValue) return

  const key = todayKey()
  const ref = doc(db, 'users', uid, 'portfolio-history', key)

  await setDoc(ref, {
    date: key,
    marketValue: totalMarketValue,
    bookValue: totalBookValue,
    pnl: totalPnl,
    ts: Date.now(),
  }, { merge: true })
}

/**
 * Load portfolio value history (up to 365 days).
 */
export async function loadHistory(uid) {
  if (!uid) return []

  try {
    const q = query(
      historyCollection(uid),
      orderBy('date', 'asc'),
      limit(365),
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => d.data())
  } catch {
    return []
  }
}
