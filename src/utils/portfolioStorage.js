import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  buildAccountPortfolio,
  flattenAccountRows,
  hasAccountPortfolio,
  normalizeStoredAccounts,
} from './accountPortfolio'
import { IS_PREVIEW, IS_PREVIEW_EMPTY, PREVIEW_PORTFOLIO } from '../preview/mockMode'

function localStorageKey(uid) {
  return `wallai:portfolio:${uid}`
}

function portfolioDoc(uid) {
  return doc(db, 'users', uid, 'portfolio', 'current')
}

function toIsoDate(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value.toDate === 'function') return value.toDate().toISOString()

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function normalizeStoredPortfolio(data) {
  if (!data) return null

  const rows = Array.isArray(data.rows) ? data.rows : []
  const accounts = data.accounts && typeof data.accounts === 'object'
    ? normalizeStoredAccounts(data.accounts)
    : buildAccountPortfolio({ rows })
  const flattenedRows = rows.length > 0 ? rows : flattenAccountRows(accounts)

  if (!flattenedRows.length && !hasAccountPortfolio(accounts)) return null

  return {
    fileName: data.fileName ?? '',
    rows: flattenedRows,
    accounts,
    lastPriceRefreshAt: toIsoDate(data.lastPriceRefreshAt),
    uploadedAt: toIsoDate(data.uploadedAt),
    updatedAt: toIsoDate(data.updatedAt),
  }
}

export function loadLocalPortfolio(uid) {
  if (!uid) return null
  // Seeded rather than empty: a UI reviewed against blank states hides
  // every problem that only appears with real content in it.
  if (IS_PREVIEW) return IS_PREVIEW_EMPTY ? null : normalizeStoredPortfolio(PREVIEW_PORTFOLIO)
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(localStorageKey(uid))
    if (!raw) return null

    const parsed = JSON.parse(raw)
    return normalizeStoredPortfolio(parsed)
  } catch {
    return null
  }
}

export function saveLocalPortfolio(uid, portfolio) {
  // Preview data is a fixture. Persisting it would leave sample holdings
  // in a real browser profile that outlive the preview session.
  if (IS_PREVIEW) return
  if (!uid || !portfolio) return
  if (typeof window === 'undefined') return

  try {
    const accounts = normalizeStoredAccounts(portfolio.accounts)
    const rows = Array.isArray(portfolio.rows) && portfolio.rows.length > 0
      ? portfolio.rows
      : flattenAccountRows(accounts)
    if (!rows.length && !hasAccountPortfolio(accounts)) return

    const payload = {
      fileName: portfolio.fileName ?? '',
      rows,
      accounts,
      lastPriceRefreshAt: toIsoDate(portfolio.lastPriceRefreshAt),
      updatedAt: toIsoDate(portfolio.updatedAt) ?? new Date().toISOString(),
    }

    window.localStorage.setItem(localStorageKey(uid), JSON.stringify(payload))
  } catch {
    // Local storage can be unavailable in private browsing or quota pressure.
  }
}

/**
 * Empty the portfolio, both copies.
 *
 * savePortfolio deliberately refuses to write an empty payload — that guard is
 * what stops a failed parse wiping a good portfolio — so clearing cannot go
 * through it. Removing the last account is the one case where empty is the
 * intended state, and it has to survive a reload: leave the local copy behind
 * and the next load restores everything the person just removed.
 */
export async function clearPortfolio(uid) {
  if (IS_PREVIEW) return
  if (!uid) return

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(localStorageKey(uid))
    } catch {
      // Private browsing; the remote delete below is still worth attempting.
    }
  }

  await deleteDoc(portfolioDoc(uid))
}

export async function loadSavedPortfolio(uid) {
  if (!uid) return null
  // The mock user has no Firestore document, and asking for one would fail
  // on rules before it failed on absence.
  if (IS_PREVIEW) return IS_PREVIEW_EMPTY ? null : normalizeStoredPortfolio(PREVIEW_PORTFOLIO)

  const snapshot = await getDoc(portfolioDoc(uid))
  if (!snapshot.exists()) return null

  return normalizeStoredPortfolio(snapshot.data())
}

export async function loadSavedPortfolioWithTimeout(uid, timeoutMs = 2500) {
  const setTimer = typeof window === 'undefined' ? setTimeout : window.setTimeout

  return Promise.race([
    loadSavedPortfolio(uid),
    new Promise((_, reject) => {
      setTimer(() => reject(new Error('Saved portfolio lookup timed out')), timeoutMs)
    }),
  ])
}

export async function savePortfolio(uid, {
  fileName,
  rows,
  accounts = {},
  lastPriceRefreshAt = null,
  markUploaded = false,
}) {
  // Never write the fixture to a real account. The mock uid is not a real
  // user, but the write would still hit Firestore under whoever is signed in.
  if (IS_PREVIEW) return
  if (!uid) return

  const normalizedAccounts = normalizeStoredAccounts(accounts)
  const nextRows = Array.isArray(rows) && rows.length > 0
    ? rows
    : flattenAccountRows(normalizedAccounts)
  if (!nextRows.length && !hasAccountPortfolio(normalizedAccounts)) return

  saveLocalPortfolio(uid, {
    fileName,
    rows: nextRows,
    accounts: normalizedAccounts,
    lastPriceRefreshAt,
  })

  const payload = {
    fileName: fileName ?? '',
    rows: nextRows,
    accounts: normalizedAccounts,
    positionCount: nextRows.length,
    accountCount: Object.keys(normalizedAccounts).length,
    updatedAt: serverTimestamp(),
    lastPriceRefreshAt: lastPriceRefreshAt ?? null,
  }

  if (markUploaded) {
    payload.uploadedAt = serverTimestamp()
  }

  await setDoc(portfolioDoc(uid), payload, { merge: true })
}
