import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'

// Load service account key from ~/.wallai-session/firebase-service-account.json
const SERVICE_ACCOUNT_PATH = resolve(homedir(), '.wallai-session', 'firebase-service-account.json')

let db

export function getDb() {
  if (db) return db
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'))
  initializeApp({ credential: cert(serviceAccount) })
  db = getFirestore()
  return db
}

export async function savePortfolioToFirestore(uid, { fileName, rows, accounts }) {
  const firestore = getDb()
  const docRef = firestore.doc(`users/${uid}/portfolio/current`)

  const payload = {
    fileName: fileName || '',
    rows,
    accounts,
    positionCount: rows.length,
    accountCount: Object.keys(accounts).length,
    updatedAt: FieldValue.serverTimestamp(),
    lastPriceRefreshAt: new Date().toISOString(),
  }

  await docRef.set(payload, { merge: true })
  console.log(`[firebase] saved ${rows.length} positions to Firestore for user ${uid}`)
}
