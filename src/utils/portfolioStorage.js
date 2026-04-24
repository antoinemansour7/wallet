import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  buildAccountPortfolio,
  flattenAccountRows,
  hasAccountPortfolio,
  normalizeStoredAccounts,
} from './accountPortfolio'

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

export async function loadSavedPortfolio(uid) {
  if (!uid) return null

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
