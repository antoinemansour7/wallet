// ─── Plaid Disconnect ─────────────────────────────────────────────────────────
// Removes a Plaid item (disconnects a linked bank/brokerage).
// ────────────────────────────────────────────────────────────────────────────────

import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

function getPlaidClient() {
  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  })
  return new PlaidApi(config)
}

function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}')),
    })
  }
  return getFirestore()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { userId, itemId } = req.body || {}
  if (!userId || !itemId) return res.status(400).json({ error: 'userId and itemId are required' })

  try {
    const db = getDb()
    const docRef = db.collection('users').doc(userId).collection('plaid').doc(itemId)
    const docSnap = await docRef.get()

    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Plaid connection not found' })
    }

    // Remove the item from Plaid
    const { accessToken } = docSnap.data()
    if (accessToken) {
      try {
        const client = getPlaidClient()
        await client.itemRemove({ access_token: accessToken })
      } catch (err) {
        console.warn('[plaid-disconnect] Plaid itemRemove failed (may already be removed):', err.message)
      }
    }

    // Delete from Firestore
    await docRef.delete()

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('[plaid-disconnect] error:', err.message)
    return res.status(500).json({ error: 'Failed to disconnect' })
  }
}
