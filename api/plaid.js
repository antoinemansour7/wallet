// ─── Plaid API Router ─────────────────────────────────────────────────────────
// Single serverless function handling all Plaid operations via `action` field.
// Actions: link-token, exchange-token, holdings, disconnect
// ────────────────────────────────────────────────────────────────────────────────

import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

/**
 * Plaid retired the `development` environment; the SDK now ships only
 * `sandbox` and `production`. An unrecognised name made PlaidEnvironments
 * return undefined, so basePath was undefined and every call failed with a
 * generic transport error that named neither the cause nor the setting.
 */
function resolvePlaidBasePath() {
  const requested = (process.env.PLAID_ENV || 'sandbox').toLowerCase()
  const basePath = PlaidEnvironments[requested]
  if (basePath) return basePath

  const known = Object.keys(PlaidEnvironments).join(', ')
  throw new Error(
    `PLAID_ENV is "${requested}", which this Plaid SDK does not recognise. `
    + `Use one of: ${known}.`
    + (requested === 'development'
      ? ' Plaid retired the development environment — sandbox for test data, production for real accounts.'
      : ''),
  )
}

function getPlaidClient() {
  const config = new Configuration({
    basePath: resolvePlaidBasePath(),
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  })
  return new PlaidApi(config)
}

/**
 * Service-account JSON arrives as an environment variable, which means it has
 * been through a shell, a clipboard and a dashboard field before it gets here.
 * A Windows toolchain will happily prepend a byte-order mark on the way, and
 * JSON.parse then fails on an invisible character with a message that names
 * neither the variable nor the cause. Strip it, and say what is wrong when the
 * value is missing rather than letting cert() complain about `project_id`.
 */
function loadServiceAccount() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').replace(/^﻿/, '').trim()
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not set. Generate a key in Firebase Console → '
      + 'Project Settings → Service Accounts and add it to the environment.',
    )
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${err.message}`)
  }
}

function getDb() {
  if (!getApps().length) {
    initializeApp({ credential: cert(loadServiceAccount()) })
  }
  return getFirestore()
}

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

// ─── Link Token ───────────────────────────────────────────────────────────────

async function handleLinkToken(req, res) {
  const { userId } = req.body
  if (!userId) return res.status(400).json({ error: 'userId is required' })

  const client = getPlaidClient()
  const response = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'WallAI',
    products: [Products.Investments],
    country_codes: [CountryCode.Ca, CountryCode.Us],
    language: 'en',
    // Without this, Link offers every account at the institution and some
    // banks make chequing mandatory to proceed. This app only ever reads
    // holdings, so asking for a chequing account is both useless and a
    // reason not to connect at all.
    account_filters: {
      investment: { account_subtypes: ['all'] },
    },
  })

  return res.status(200).json({ link_token: response.data.link_token })
}

// ─── Exchange Token ───────────────────────────────────────────────────────────

async function handleExchangeToken(req, res) {
  const { publicToken, userId, institutionName } = req.body
  if (!publicToken || !userId) {
    return res.status(400).json({ error: 'publicToken and userId are required' })
  }

  const client = getPlaidClient()
  const exchangeResponse = await client.itemPublicTokenExchange({ public_token: publicToken })
  const accessToken = exchangeResponse.data.access_token
  const itemId = exchangeResponse.data.item_id

  const accountsResponse = await client.accountsGet({ access_token: accessToken })
  const accounts = accountsResponse.data.accounts.map((a) => ({
    id: a.account_id,
    name: a.name,
    officialName: a.official_name,
    type: a.type,
    subtype: a.subtype,
    mask: a.mask,
  }))

  // Not every institution honours account_filters — Wealthsimple returns the
  // chequing account regardless — so the authoritative filter is ours, applied
  // on read. Default to the investment accounts only.
  const investmentAccounts = accounts.filter((a) => a.type === 'investment')
  const defaultEnabled = (investmentAccounts.length ? investmentAccounts : accounts).map((a) => a.id)

  const db = getDb()
  await db.collection('users').doc(userId).collection('plaid').doc(itemId).set({
    accessToken,
    itemId,
    accounts,
    enabledAccountIds: defaultEnabled,
    institution: institutionName || null,
    connectedAt: new Date().toISOString(),
  })

  return res.status(200).json({ success: true, itemId, accounts, enabledAccountIds: defaultEnabled })
}

// ─── Select accounts ──────────────────────────────────────────────────────────

async function handleSelectAccounts(req, res) {
  const { userId, itemId, accountIds } = req.body
  if (!userId || !itemId) return res.status(400).json({ error: 'userId and itemId are required' })
  if (!Array.isArray(accountIds)) return res.status(400).json({ error: 'accountIds must be an array' })

  const db = getDb()
  const docRef = db.collection('users').doc(userId).collection('plaid').doc(itemId)
  const snap = await docRef.get()
  if (!snap.exists) return res.status(404).json({ error: 'Plaid connection not found' })

  // Only ids that belong to this item, so a bad payload cannot widen access.
  const known = new Set((snap.data().accounts || []).map((a) => a.id))
  const enabled = accountIds.filter((id) => known.has(id))
  if (enabled.length === 0) return res.status(400).json({ error: 'Select at least one account' })

  await docRef.update({ enabledAccountIds: enabled })
  return res.status(200).json({ success: true, enabledAccountIds: enabled })
}

// ─── Holdings ─────────────────────────────────────────────────────────────────

async function handleHoldings(req, res) {
  const { userId } = req.body
  if (!userId) return res.status(400).json({ error: 'userId is required' })

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
    const { accessToken, accounts: storedAccounts, institution, enabledAccountIds } = doc.data()
    // Absent means an older connection made before the picker existed; treat
    // that as "everything", which is what it was already doing.
    const isEnabled = (accountId) => !enabledAccountIds || enabledAccountIds.includes(accountId)

    try {
      const holdingsResponse = await client.investmentsHoldingsGet({ access_token: accessToken })
      const { holdings, securities, accounts } = holdingsResponse.data

      const securityMap = new Map(securities.map((s) => [s.security_id, s]))
      const accountMap = new Map(accounts.map((a) => [a.account_id, a]))

      for (const holding of holdings) {
        const security = securityMap.get(holding.security_id)
        const account = accountMap.get(holding.account_id)
        if (!security) continue
        if (!isEnabled(holding.account_id)) continue

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
        if (!isEnabled(account.account_id)) continue
        connectedAccounts.push({
          id: account.account_id,
          name: account.official_name || account.name,
          type: mapAccountType(account),
          institution: institution || 'Connected',
          mask: account.mask,
        })
      }
    } catch (err) {
      console.error(`[plaid] holdings failed for item ${doc.id}:`, err.response?.data || err.message)
    }
  }

  return res.status(200).json({ rows: allRows, cashEntries: allCashEntries, connectedAccounts })
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

async function handleDisconnect(req, res) {
  const { userId, itemId } = req.body
  if (!userId || !itemId) return res.status(400).json({ error: 'userId and itemId are required' })

  const db = getDb()
  const docRef = db.collection('users').doc(userId).collection('plaid').doc(itemId)
  const docSnap = await docRef.get()

  if (!docSnap.exists) {
    return res.status(404).json({ error: 'Plaid connection not found' })
  }

  const { accessToken } = docSnap.data()
  if (accessToken) {
    try {
      const client = getPlaidClient()
      await client.itemRemove({ access_token: accessToken })
    } catch (err) {
      console.warn('[plaid] itemRemove failed (may already be removed):', err.message)
    }
  }

  await docRef.delete()
  return res.status(200).json({ success: true })
}

// ─── Router ───────────────────────────────────────────────────────────────────

const ACTIONS = {
  'link-token': handleLinkToken,
  'exchange-token': handleExchangeToken,
  'select-accounts': handleSelectAccounts,
  'holdings': handleHoldings,
  'disconnect': handleDisconnect,
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return res.status(500).json({ error: 'Plaid credentials not configured' })
  }

  const { action } = req.body || {}
  const actionHandler = ACTIONS[action]
  if (!actionHandler) {
    return res.status(400).json({ error: `Invalid action. Use: ${Object.keys(ACTIONS).join(', ')}` })
  }

  try {
    return await actionHandler(req, res)
  } catch (err) {
    // Plaid says exactly what went wrong in err.response.data; returning a bare
    // "Plaid exchange-token failed" threw that away and left the real cause
    // visible only in server logs nobody was reading.
    const plaid = err.response?.data
    console.error(`[plaid:${action}] error:`, plaid || err.message)
    return res.status(500).json({
      error: plaid?.error_message || err.message || `Plaid ${action} failed`,
      code: plaid?.error_code ?? null,
      type: plaid?.error_type ?? null,
      action,
    })
  }
}
