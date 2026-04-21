import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

function portfolioDoc(uid) {
  return doc(db, 'users', uid, 'portfolio', 'current')
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
  }
}

export async function savePortfolio(uid, {
  fileName,
  rows,
  lastPriceRefreshAt = null,
  markUploaded = false,
}) {
  if (!uid || !Array.isArray(rows)) return

  const payload = {
    fileName: fileName ?? '',
    rows,
    positionCount: rows.length,
    updatedAt: serverTimestamp(),
    lastPriceRefreshAt: lastPriceRefreshAt ?? serverTimestamp(),
  }

  if (markUploaded) {
    payload.uploadedAt = serverTimestamp()
  }

  await setDoc(portfolioDoc(uid), payload, { merge: true })
}
