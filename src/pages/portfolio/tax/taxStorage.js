import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { IS_PREVIEW } from '../../../preview/mockMode'

const settingsDoc = (uid) => doc(db, 'users', uid, 'portfolio', 'tax')
export async function loadTaxSettings(uid) {
  if (!uid || IS_PREVIEW) return {}
  const snapshot = await getDoc(settingsDoc(uid))
  return snapshot.exists() ? snapshot.data() : {}
}
export async function saveTaxSettings(uid, settings) {
  if (IS_PREVIEW) return
  if (!uid) throw new Error('Sign in to save tax settings')
  await setDoc(settingsDoc(uid), { ...settings, updatedAt: new Date().toISOString() })
}
export async function loadTaxTransactions(uid) {
  if (!uid || IS_PREVIEW) return { transactions: [], limited: false }
  const transactions = []
  let cursor = null
  // Bound the browser's working set and disclose truncation. Ledger documents
  // remain read-only; this screen never creates a sale from portfolio changes.
  for (let page = 0; page < 10; page++) {
    const constraints = [orderBy('tradeDate', 'desc'), limit(500)]
    if (cursor) constraints.push(startAfter(cursor))
    const snapshot = await getDocs(query(collection(db, 'users', uid, 'transactions'), ...constraints))
    transactions.push(...snapshot.docs.map((document) => ({ ...document.data(), id: document.id })))
    if (snapshot.docs.length < 500) return { transactions, limited: false }
    cursor = snapshot.docs.at(-1)
  }
  return { transactions, limited: true }
}
