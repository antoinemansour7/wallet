import { doc, getDoc, setDoc } from 'firebase/firestore'
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
