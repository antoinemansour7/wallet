import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

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

export function loadLocalPortfolio(uid) {
  if (!uid) return null
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(localStorageKey(uid))
    if (!raw) return null

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.rows) ? parsed : null
  } catch {
    return null
  }
}

export function saveLocalPortfolio(uid, portfolio) {
  if (!uid || !portfolio?.rows?.length) return
  if (typeof window === 'undefined') return

  try {
    const payload = {
      fileName: portfolio.fileName ?? '',
      rows: portfolio.rows,
      lastPriceRefreshAt: toIsoDate(portfolio.lastPriceRefreshAt),
      updatedAt: toIsoDate(portfolio.updatedAt) ?? new Date().toISOString(),
    }

    window.localStorage.setItem(localStorageKey(uid), JSON.stringify(payload))
  } catch {
    // Local storage can be unavailable in private browsing or quota pressure.
  }
}

export async function loadSavedPortfolio(uid) {
  if (!uid) return null

  const snapshot = await getDoc(portfolioDoc(uid))
  if (!snapshot.exists()) return null

  const data = snapshot.data()
  return {
    fileName: data.fileName ?? '',
    rows: Array.isArray(data.rows) ? data.rows : [],
    lastPriceRefreshAt: data.lastPriceRefreshAt ?? null,
    uploadedAt: data.uploadedAt ?? null,
    updatedAt: data.updatedAt ?? null,
  }
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
  lastPriceRefreshAt = null,
  markUploaded = false,
}) {
  if (!uid || !Array.isArray(rows)) return

  saveLocalPortfolio(uid, {
    fileName,
    rows,
    lastPriceRefreshAt,
  })

  const payload = {
    fileName: fileName ?? '',
    rows,
    positionCount: rows.length,
    updatedAt: serverTimestamp(),
    lastPriceRefreshAt: lastPriceRefreshAt ?? null,
  }

  if (markUploaded) {
    payload.uploadedAt = serverTimestamp()
  }

  await setDoc(portfolioDoc(uid), payload, { merge: true })
}
