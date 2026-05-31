// ─── Plaid Link Token ─────────────────────────────────────────────────────────
// Creates a link_token for the Plaid Link widget. The client sends this token
// to open the Link modal and let the user connect their brokerage.
// ────────────────────────────────────────────────────────────────────────────────

import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid'

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { userId } = req.body || {}
  if (!userId) return res.status(400).json({ error: 'userId is required' })

  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return res.status(500).json({ error: 'Plaid credentials not configured' })
  }

  try {
    const client = getPlaidClient()
    const response = await client.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: 'WallAI',
      products: [Products.Investments],
      country_codes: [CountryCode.Ca, CountryCode.Us],
      language: 'en',
    })

    return res.status(200).json({ link_token: response.data.link_token })
  } catch (err) {
    console.error('[plaid-link-token] error:', err.response?.data || err.message)
    return res.status(500).json({ error: 'Failed to create link token' })
  }
}
