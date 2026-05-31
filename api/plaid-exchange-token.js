// ─── Plaid Token Exchange ─────────────────────────────────────────────────────
// Exchanges the Plaid Link public_token for a persistent access_token.
// Stores the access_token in Firestore so we can refresh holdings later.
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

  const { publicToken, userId } = req.body || {}
  if (!publicToken || !userId) {
    return res.status(400).json({ error: 'publicToken and userId are required' })
  }

  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return res.status(500).json({ error: 'Plaid credentials not configured' })
  }

  try {
    const client = getPlaidClient()

    // Exchange public token for access token
    const exchangeResponse = await client.itemPublicTokenExchange({ public_token: publicToken })
    const accessToken = exchangeResponse.data.access_token
    const itemId = exchangeResponse.data.item_id

    // Get account info to identify account types (TFSA, FHSA, RRSP, etc.)
    const accountsResponse = await client.accountsGet({ access_token: accessToken })
    const accounts = accountsResponse.data.accounts.map((a) => ({
      id: a.account_id,
      name: a.name,
      officialName: a.official_name,
      type: a.type,
      subtype: a.subtype,
      mask: a.mask,
    }))

    // Store access token securely in Firestore
    const db = getDb()
    await db.collection('users').doc(userId).collection('plaid').doc(itemId).set({
      accessToken,
      itemId,
      accounts,
      institution: req.body.institutionName || null,
      connectedAt: new Date().toISOString(),
    })

    return res.status(200).json({
      success: true,
      itemId,
      accounts,
    })
  } catch (err) {
    console.error('[plaid-exchange-token] error:', err.response?.data || err.message)
    return res.status(500).json({ error: 'Failed to exchange token' })
  }
}
