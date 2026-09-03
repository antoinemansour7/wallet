// ─── Plaid API Router ─────────────────────────────────────────────────────────
// Single serverless function handling all Plaid operations via `action` field.
// Actions: link-token, exchange-token, holdings, disconnect
// ────────────────────────────────────────────────────────────────────────────────

import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid'
import { fetchMarketQuotes } from '../src/server/marketQuotes.js'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { withRunLog } from '../src/server/runLog.js'

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
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').replace(/^\uFEFF/, '').trim()
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

/**
 * Whether a security is a Canadian Depositary Receipt, decided from what the
 * institution reports rather than from how it worded the name.
 *
 * This matters more than it looks. A CDR quoted against its US underlying is
 * priced several times too high — NVDA's receipt trades near a quarter of the
 * US share — and the error compounds, because a CDR mistaken for a US holding
 * also gets the exchange rate applied on top. Downstream this used to be
 * decided by searching the description for the word "CDR", which is a
 * statement's convention and not something Plaid promises.
 *
 * Three independent signals, any one of which settles it:
 *   · the ticker already carries the Cboe Canada suffix
 *   · the security trades on a Canadian venue in CAD
 *   · the name says so, which is the statement convention and the last resort
 */
function isCdrSecurity(security) {
  const ticker = String(security?.ticker_symbol || '').toUpperCase()
  if (ticker.endsWith('.NE')) return true

  const currency = String(security?.iso_currency_code || '').toUpperCase()
  const mic = String(security?.market_identifier_code || '').toUpperCase()
  // NEOE is Cboe Canada, where every CDR is listed.
  if (currency === 'CAD' && mic === 'NEOE') return true

  return /\bCDR\b/i.test(String(security?.name || ''))
}

/**
 * The symbol to price this security by. A CDR reported without its exchange
 * suffix would otherwise resolve to the US listing of the same ticker.
 */
function tickerFor(security) {
  const ticker = String(security?.ticker_symbol || security?.name || 'UNKNOWN')
  if (!isCdrSecurity(security)) return ticker
  return ticker.includes('.') ? ticker : `${ticker}.NE`
}

/**
 * What to call a connected account, and the name has to be unique.
 *
 * This used to be `mask || account_id.slice(-4)` — four characters, and the
 * app keys its accounts map by exactly this string. Two accounts sharing a
 * mask, which happens across account types at one institution, collapsed into
 * a single WallAI account with their holdings pooled and their cash summed.
 * The failure is silent and the total looks plausible.
 *
 * Leading with the registration type fixes both problems at once: it is unique
 * where a bare mask is not, and "TFSA 8830" is what a person recognises where
 * "17K9" is not.
 */
function accountLabel(account) {
  const type = mapAccountType(account)
  const mask = account?.mask || account?.account_id?.slice(-4) || ''
  return [type, mask].filter(Boolean).join(' ') || 'Investment'
}

/** What the account itself is denominated in. Defaults Canadian, like the app. */
function accountBaseCurrency(account) {
  return String(
    account?.balances?.iso_currency_code
    || account?.balances?.unofficial_currency_code
    || 'CAD',
  ).toUpperCase()
}

/**
 * Today's USD->CAD rate, or null if it cannot be had. Null means values pass
 * through unconverted but tagged with their real currency, which the live price
 * refresh then corrects - wrong for a moment beats wrong silently forever.
 */
async function getUsdCadRate() {
  try {
    const { quotes } = await fetchMarketQuotes(['USDCAD=X'])
    const fx = quotes?.find((q) => Number.isFinite(q?.price))
    return fx ? fx.price : null
  } catch (err) {
    console.warn('[plaid] USDCAD lookup failed, importing unconverted:', err.message)
    return null
  }
}

/**
 * Whether these two currencies can actually be reconciled right now. Without
 * it a failed FX lookup still labelled rows with the account currency while
 * their figures stayed in the security's — market value converted downstream,
 * cost basis not, and a losing position reporting a profit.
 */
function canConvert(from, to, usdCadRate) {
  if (from === to) return true
  if (!usdCadRate) return false
  return (from === 'USD' && to === 'CAD') || (from === 'CAD' && to === 'USD')
}

function convert(amount, from, to, usdCadRate) {
  const value = Number(amount) || 0
  if (!value || from === to || !usdCadRate) return value
  if (from === 'USD' && to === 'CAD') return value * usdCadRate
  if (from === 'CAD' && to === 'USD') return value / usdCadRate
  return value
}


async function handleHoldings(req, res) {
  const { userId, itemId } = req.body
  if (!userId) return res.status(400).json({ error: 'userId is required' })

  const db = getDb()
  const plaidDocs = await db.collection('users').doc(userId).collection('plaid').get()

  if (plaidDocs.empty) {
    return res.status(200).json({ rows: [], accounts: [], cashEntries: [], errors: [] })
  }

  const client = getPlaidClient()
  const allRows = []
  const allCashEntries = []
  const connectedAccounts = []
  const errors = []

  // An import brings in the connection the person just linked, so it asks for
  // that one. Without the filter this returned every stored item's holdings, so
  // a second link to the same brokerage (a retried connection leaves its first
  // document behind) reported every holding twice - and all of them were tagged
  // with the institution of whichever link happened to be last. Absent means
  // "everything", which is what older callers expect.
  const docs = itemId ? plaidDocs.docs.filter((d) => d.id === itemId) : plaidDocs.docs
  if (itemId && docs.length === 0) {
    return res.status(404).json({ error: 'Plaid connection not found' })
  }

  const usdCadRate = await getUsdCadRate()

  for (const doc of docs) {
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

        const accountCurrency = accountBaseCurrency(account)

        if (security.type === 'cash' || security.ticker_symbol === 'CUR:CAD' || security.ticker_symbol === 'CUR:USD') {
          const cashCurrency = String(security.iso_currency_code || accountCurrency).toUpperCase()
          const statedCashCurrency = canConvert(cashCurrency, accountCurrency, usdCadRate)
            ? accountCurrency
            : cashCurrency
          allCashEntries.push({
            account: mapAccountType(account),
            accountNumber: accountLabel(account),
            currency: statedCashCurrency,
            // `amount` is what a parsed statement calls it, and the only name
            // the client ever read. Emitting `value` meant every connected cash
            // balance summed to zero and vanished on import.
            amount: convert(holding.institution_value || 0, cashCurrency, statedCashCurrency, usdCadRate),
          })
          continue
        }

        const ticker = tickerFor(security)
        const quantity = holding.quantity || 0
        // What the security trades in, which is not what the account is
        // denominated in: a Canadian account holding RKLB reports a USD price
        // against a CAD balance.
        const securityCurrency = String(
          holding.iso_currency_code || security.iso_currency_code || accountCurrency,
        ).toUpperCase()

        // The currency these figures actually end up in — the account's when the
        // conversion is available, otherwise the security's. Stating one while
        // reporting the other is what turned a loss into a profit.
        const statedCurrency = canConvert(securityCurrency, accountCurrency, usdCadRate)
          ? accountCurrency
          : securityCurrency

        const price = convert(holding.institution_price || security.close_price || 0, securityCurrency, statedCurrency, usdCadRate)
        const marketValue = convert(holding.institution_value || 0, securityCurrency, statedCurrency, usdCadRate)
          || price * quantity
        // Plaid states cost basis in the security's currency; a statement states
        // book value in the account's, and everything downstream assumes the
        // statement's convention. Converting here keeps one convention per
        // ledger instead of two.
        const costBasis = convert(holding.cost_basis || 0, securityCurrency, statedCurrency, usdCadRate)
        const unrealizedPnl = marketValue - costBasis
        const unrealizedPnlPct = costBasis > 0 ? ((unrealizedPnl / costBasis) * 100) : 0

        const storedAccount = storedAccounts?.find((a) => a.id === holding.account_id)

        allRows.push({
          'SYMBOL': ticker,
          'DESCRIPTION': security.name || ticker,
          // Settled here from what the institution reports, because the name it
          // gives a CDR need not contain the word.
          '__isCdr': isCdrSecurity(security),
          'QUANTITY': quantity,
          'MARKET PRICE': price,
          'MARKET VALUE': marketValue,
          'BOOK VALUE': costBasis,
          'UNREALIZED GAIN/LOSS': unrealizedPnl,
          'UNREALIZED GAIN/LOSS %': unrealizedPnlPct,
          'ACCOUNT TYPE': mapAccountType(storedAccount || account),
          'ACCOUNT NUMBER': accountLabel(account),
          // Plaid's own id for the account, which is unique by contract. The
          // label above is for people; this is what identity is checked on.
          '__plaidAccountId': account?.account_id || '',
          // The currency these figures are now stated in. Every consumer reads
          // this key; the route emitted only CURRENCY, so the live price refresh
          // could not tell a Canadian account from a US one and so converted
          // nothing.
          'ACCOUNT CURRENCY': statedCurrency,
          'CURRENCY': securityCurrency,
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
      const message = err.response?.data?.error_message || err.message
      console.error(`[plaid] holdings failed for item ${doc.id}:`, err.response?.data || err.message)
      // A failed fetch used to disappear into this log line while the response
      // still came back 200 — the client had no way to tell "nothing here" from
      // "this one didn't load". Reported here instead, so it can say so.
      errors.push({ itemId: doc.id, institution: institution || 'Connected', message })
    }
  }

  return res.status(200).json({ rows: allRows, cashEntries: allCashEntries, connectedAccounts, errors })
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

/** Same shape sourceIdFor builds on the client, so the two agree. */
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function handleDisconnect(req, res) {
  const { userId, itemId, institution } = req.body
  if (!userId) return res.status(400).json({ error: 'userId is required' })
  if (!itemId && !institution) {
    return res.status(400).json({ error: 'itemId or institution is required' })
  }

  const db = getDb()
  const collection = db.collection('users').doc(userId).collection('plaid')

  let docRef = itemId ? collection.doc(itemId) : null
  let docSnap = docRef ? await docRef.get() : null

  // Connections imported before rows carried Plaid's item id have only the
  // institution name to go on, and the client used to send that slug *as* the
  // item id — which matched no document, so the disconnect 404'd silently and
  // the connection kept syncing. Resolving it here retires those too.
  if (!docSnap?.exists && institution) {
    const all = await collection.get()
    const match = all.docs.find((d) => slugify(d.data().institution) === slugify(institution))
    if (match) {
      docRef = match.ref
      docSnap = match
    }
  }

  if (!docSnap?.exists) {
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

/**
 * Every handler below reads `const { userId } = req.body` — until now, that
 * meant the caller could name any Firebase UID and this route would act as
 * that person: read their brokerage holdings, disconnect their bank, or
 * attach a new connection to their account. Firestore's security rules never
 * saw any of this, because these calls go through firebase-admin on the
 * server, which bypasses rules by design.
 *
 * A Firebase ID token proves who is actually asking, and the client already
 * has one — every signed-in user holds a token from `getIdToken()`. This
 * verifies it and returns the real uid, or throws a tagged error the caller
 * turns into a 401 before anything downstream — Firestore included — runs.
 */
async function verifyCaller(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    throw Object.assign(new Error('Missing Authorization header'), { status: 401 })
  }
  try {
    const decoded = await getAuth().verifyIdToken(token)
    return decoded.uid
  } catch (err) {
    throw Object.assign(new Error('Invalid or expired session'), { status: 401, cause: err })
  }
}

async function realHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // First gate, ahead of even the action name: an unauthenticated request
  // learns nothing about this route beyond "you are not signed in", not which
  // action names exist or whether Plaid is configured.
  try {
    // Overwritten, not merely checked. Every handler below still reads
    // `userId` from the body — rather than editing each one to read it from
    // somewhere else, the body's claim is replaced with the verified truth
    // before any handler sees it, so a request naming someone else's uid acts
    // as the caller's own account instead of failing loudly or silently
    // succeeding as the wrong person.
    req.body = req.body || {}
    req.body.userId = await verifyCaller(req)
  } catch (err) {
    return res.status(err.status ?? 401).json({ error: err.message })
  }

  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    return res.status(500).json({ error: 'Plaid credentials not configured' })
  }

  const { action } = req.body
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

export default withRunLog('plaid', realHandler)
