// ─── Plaid Holdings ──────────────────────────────────────────────────────────
// Fetches investment holdings from all connected Plaid items for a user.
// Returns data in the same row format the portfolio page expects.
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

// Map Plaid account subtypes to friendly Canadian account names
function mapAccountType(account) {
  const subtype = (account.subtype || '').toLowerCase()
  const name = (account.officialName || account.name || '').toLowerCase()

  if (name.includes('tfsa') || subtype === 'tfsa') return 'TFSA'
  if (name.includes('fhsa') || subtype === 'fhsa') return 'FHSA'
  if (name.includes('rrsp') || subtype === 'rrsp') return 'RRSP'
  if (name.includes('resp') || subtype === 'resp') return 'RESP'
  if (name.includes('lira') || subtype === 'lira') return 'LIRA'
  if (subtype === 'rrif') return 'RRIF'
  if (subtype === '401k') return '401K'
  if (subtype === 'ira' || subtype === 'roth') return 'IRA'
  return account.type === 'investment' ? 'Non-Registered' : (account.subtype || 'Investment').toUpperCase()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { userId } = req.body || {}
  if (!userId) return res.status(400).json({ error: 'userId is required' })

  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return res.status(500).json({ error: 'Plaid credentials not configured' })
  }

  try {
    const db = getDb()
    const plaidDocs = await db.collection('users').doc(userId).collection('plaid').get()

    if (plaidDocs.empty) {
      return res.status(200).json({ rows: [], accounts: [], cashEntries: [] })
    }

    const client = getPlaidClient()
    const allRows = []
    const allCashEntries = []
    const connectedAccounts = []

    for (const doc of plaidDocs.docs) {
      const { accessToken, accounts: storedAccounts, institution } = doc.data()

      try {
        const holdingsResponse = await client.investmentsHoldingsGet({ access_token: accessToken })
        const { holdings, securities, accounts } = holdingsResponse.data

        // Build security lookup
        const securityMap = new Map(securities.map((s) => [s.security_id, s]))
        // Build account lookup
        const accountMap = new Map(accounts.map((a) => [a.account_id, a]))

        for (const holding of holdings) {
          const security = securityMap.get(holding.security_id)
          const account = accountMap.get(holding.account_id)
          if (!security) continue

          // Skip cash-like instruments, report as cash entries instead
          if (security.type === 'cash' || security.ticker_symbol === 'CUR:CAD' || security.ticker_symbol === 'CUR:USD') {
            allCashEntries.push({
              account: mapAccountType(account),
              accountNumber: account?.mask || account?.account_id?.slice(-4) || '',
              currency: security.iso_currency_code || 'CAD',
              value: holding.institution_value || 0,
            })
            continue
          }

          const ticker = security.ticker_symbol || security.name || 'UNKNOWN'
          const quantity = holding.quantity || 0
          const price = holding.institution_price || security.close_price || 0
          const marketValue = holding.institution_value || quantity * price
          const costBasis = holding.cost_basis || 0
          const unrealizedPnl = marketValue - costBasis
          const unrealizedPnlPct = costBasis > 0 ? ((unrealizedPnl / costBasis) * 100) : 0

          const storedAccount = storedAccounts?.find((a) => a.id === holding.account_id)

          allRows.push({
            'SYMBOL': ticker,
            'DESCRIPTION': security.name || ticker,
            'QUANTITY': quantity,
            'MARKET PRICE': price,
            'MARKET VALUE': marketValue,
            'BOOK VALUE': costBasis,
            'UNREALIZED GAIN/LOSS': unrealizedPnl,
            'UNREALIZED GAIN/LOSS %': unrealizedPnlPct,
            'ACCOUNT TYPE': mapAccountType(storedAccount || account),
            'ACCOUNT NUMBER': account?.mask || account?.account_id?.slice(-4) || '',
            'CURRENCY': security.iso_currency_code || 'CAD',
            '_source': 'plaid',
            '_institution': institution || 'Connected',
          })
        }

        for (const account of accounts) {
          connectedAccounts.push({
            id: account.account_id,
            name: account.official_name || account.name,
            type: mapAccountType(account),
            institution: institution || 'Connected',
            mask: account.mask,
          })
        }
      } catch (err) {
        console.error(`[plaid-holdings] failed for item ${doc.id}:`, err.response?.data || err.message)
        // Continue with other items
      }
    }

    return res.status(200).json({
      rows: allRows,
      cashEntries: allCashEntries,
      connectedAccounts,
    })
  } catch (err) {
    console.error('[plaid-holdings] error:', err.message)
    return res.status(500).json({ error: 'Failed to fetch holdings' })
  }
}
