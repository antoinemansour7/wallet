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
import { writeAccessToken, readAccessToken, deleteAccessToken } from '../src/server/plaidTokens.js'
import { syncInvestmentTransactions, dedupeEnabledAccounts } from '../src/server/plaidTransactions.js'
import { getRatesForDates } from '../src/server/historicalFx.js'
import { historicalFxCache } from '../src/server/historicalFxCache.js'

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

/**
 * Firebase Admin, initialised exactly once per container.
 *
 * This used to live inside getDb(), which meant the app was only created when a
 * handler asked for Firestore. verifyCaller runs *before* any handler — it is
 * the first thing realHandler does — so on a cold container getAuth() was
 * reached with no app and threw `app/no-app`, which the catch reported as
 * "Invalid or expired session". A perfectly valid token, rejected because
 * nothing had touched the database yet.
 *
 * Auth and Firestore are now both fronted by this, so the order handlers happen
 * to call things in cannot decide whether authentication works.
 */
function ensureFirebaseApp() {
  if (!getApps().length) {
    initializeApp({ credential: cert(loadServiceAccount()) })
  }
}

function getDb() {
  ensureFirebaseApp()
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

  // The credential goes to a top-level collection, not into the user's own
  // subtree beside the connection metadata. A Firestore rule as ordinary as
  // `match /users/{uid}/{document=**}` would otherwise hand a signed-in
  // browser its own live Plaid token — which is exactly what this project was
  // running until the rules were rewritten.
  await writeAccessToken({ db, uid: userId, itemId, accessToken })

  await db.collection('users').doc(userId).collection('plaid').doc(itemId).set({
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


/**
 * Fetch and shape holdings for one connection. Throws on failure — the caller
 * decides what a failed connection means for the rest of the batch, this just
 * does the one connection's work in isolation so it can run concurrently with
 * every other connection's.
 */
async function fetchHoldingsForItem(client, doc, usdCadRate) {
  const { accounts: storedAccounts, institution, enabledAccountIds, ...legacyData } = doc.data()

  // The token now lives outside the user's subtree. Connections made before
  // that split still carry it here, so the read falls back and migrates them
  // in passing — no batch migration, and either location answers while it is
  // half done.
  const uid = doc.ref.parent.parent?.id
  const accessToken = await readAccessToken({
    db: doc.ref.firestore,
    uid,
    itemId: doc.id,
    legacyData,
  })
  if (!accessToken) throw new Error(`No access token for Plaid item ${doc.id}`)
  // Absent means an older connection made before the picker existed; treat
  // that as "everything", which is what it was already doing.
  const isEnabled = (accountId) => !enabledAccountIds || enabledAccountIds.includes(accountId)

  const rows = []
  const cashEntries = []
  const connectedAccounts = []

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
      cashEntries.push({
        __plaidAccountId: account.account_id,
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

    rows.push({
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

  return { rows, cashEntries, connectedAccounts }
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

  // Each connection is an independent Plaid round trip against a single
  // function timeout. Run them concurrently rather than one after another —
  // with one connection (the only case any caller hits today) this changes
  // nothing; with several, it is the difference between the slowest round
  // trip and their sum. allSettled rather than all so one failed connection
  // is reported (see #55) instead of dropping every other one with it.
  const settled = await Promise.allSettled(
    docs.map((doc) => fetchHoldingsForItem(client, doc, usdCadRate)),
  )

  const allRows = []
  const allCashEntries = []
  const connectedAccounts = []
  const errors = []

  settled.forEach((result, i) => {
    const doc = docs[i]
    if (result.status === 'fulfilled') {
      allRows.push(...result.value.rows)
      allCashEntries.push(...result.value.cashEntries)
      connectedAccounts.push(...result.value.connectedAccounts)
      return
    }

    const err = result.reason
    const message = err.response?.data?.error_message || err.message
    console.error(`[plaid] holdings failed for item ${doc.id}:`, err.response?.data || err.message)
    // A failed fetch used to disappear into this log line while the response
    // still came back 200 — the client had no way to tell "nothing here" from
    // "this one didn't load". Reported here instead, so it can say so.
    errors.push({ itemId: doc.id, institution: doc.data().institution || 'Connected', message })
  })

  return res.status(200).json({ rows: allRows, cashEntries: allCashEntries, connectedAccounts, errors })
}

// ─── Sync transactions ──────────────────────────────────────────────────────

/**
 * Pulls investment transactions for one Plaid item and writes them into the
 * ledger. Isolated the same way fetchHoldingsForItem is: this does one
 * connection's work so it can run concurrently with every other connection's,
 * and a failure here reports as an error entry rather than losing every
 * other connection's import with it (#55).
 */
async function syncTransactionsForItem({ client, db, uid, doc, resolveFxRates, since = null, enabledAccountIds }) {
  const effectiveEnabled = enabledAccountIds ?? doc.data().enabledAccountIds

  const accessToken = await readAccessToken({ db, uid, itemId: doc.id, legacyData: doc.data() })
  if (!accessToken) throw new Error(`No access token for Plaid item ${doc.id}`)

  return syncInvestmentTransactions({
    client,
    accessToken,
    db,
    uid,
    enabledAccountIds: effectiveEnabled,
    accountTypeFor: mapAccountType,
    resolveFxRates,
    since,
  })
}

async function handleSyncTransactions(req, res) {
  const { userId, itemId } = req.body
  if (!userId) return res.status(400).json({ error: 'userId is required' })

  const db = getDb()
  const plaidDocs = await db.collection('users').doc(userId).collection('plaid').get()

  if (plaidDocs.empty) {
    return res.status(200).json({ written: 0, fetched: 0, skipped: 0, errors: [] })
  }

  const docs = itemId ? plaidDocs.docs.filter((d) => d.id === itemId) : plaidDocs.docs
  if (itemId && docs.length === 0) {
    return res.status(404).json({ error: 'Plaid connection not found' })
  }

  const client = getPlaidClient()
  // One resolver shared across every connection in this call. getRatesForDates
  // already batches every date it is given into a single Bank of Canada
  // request per connection; sharing the resolver additionally means a date
  // that recurs across two connections' transactions (a dividend on the same
  // day, in two accounts) is only asked for once per Redis round trip, not
  // once per connection.
  const resolveFxRates = (dates) => getRatesForDates(dates, { cache: historicalFxCache() })

  // The same brokerage connected twice reports the same real accounts under
  // two items; claim each real account for one item so its transactions are
  // imported once, not once per connection. Computed over every item (not just
  // the filtered set) so a single-item sync still respects that ownership.
  const enabledByItem = dedupeEnabledAccounts(
    plaidDocs.docs.map((d) => {
      const data = d.data()
      return { itemId: d.id, institution: data.institution, accounts: data.accounts || [], enabledAccountIds: data.enabledAccountIds }
    }),
  )

  const settled = await Promise.allSettled(
    docs.map((doc) => syncTransactionsForItem({ client, db, uid: userId, doc, resolveFxRates, enabledAccountIds: enabledByItem.get(doc.id) })),
  )

  let written = 0
  let fetched = 0
  let skipped = 0
  // Every fetched transaction lands in exactly one of these, so the numbers
  // reconcile. Reporting "81 fetched, 3 written, 3 skipped" leaves 75
  // unaccounted for and reads like data loss, when in fact they belong to Plaid
  // accounts that were never enabled here — usually a brokerage connected more
  // than once, where only the current connection's accounts are active.
  let notEnabled = 0
  const skippedReasons = {}
  const errors = []

  settled.forEach((result, i) => {
    const doc = docs[i]
    if (result.status === 'fulfilled') {
      written += result.value.written
      fetched += result.value.fetched
      skipped += result.value.skipped
      notEnabled += result.value.notEnabled ?? 0
      for (const [reason, count] of Object.entries(result.value.skippedReasons ?? {})) {
        skippedReasons[reason] = (skippedReasons[reason] || 0) + count
      }
      return
    }

    const err = result.reason
    const message = err.response?.data?.error_message || err.message
    console.error(`[plaid] transaction sync failed for item ${doc.id}:`, err.response?.data || err.message)
    errors.push({ itemId: doc.id, institution: doc.data().institution || 'Connected', message })
  })

  return res.status(200).json({ written, fetched, skipped, notEnabled, skippedReasons, errors })
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
  // The token collection is keyed by item id, so the id has to be tracked
  // through the institution fallback below rather than read back off the
  // snapshot afterwards.
  let resolvedItemId = itemId || null

  // Connections imported before rows carried Plaid's item id have only the
  // institution name to go on, and the client used to send that slug *as* the
  // item id — which matched no document, so the disconnect 404'd silently and
  // the connection kept syncing. Resolving it here retires those too.
  // A known item id is authoritative. A retry for an already removed item
  // must never fall through to a different connection at the same brokerage.
  if (!itemId && institution) {
    const all = await collection.get()
    const match = all.docs.find((d) => slugify(d.data().institution) === slugify(institution))
    if (match) {
      docRef = match.ref
      docSnap = match
      resolvedItemId = match.id
    }
  }

  if (!docSnap?.exists) {
    return res.status(404).json({ error: 'Plaid connection not found' })
  }

  // Migration is off here: this token is about to be revoked and deleted, so
  // copying it to the safe collection first would only create something to
  // clean up.
  const accessToken = await readAccessToken({
    db,
    uid: userId,
    itemId: resolvedItemId,
    legacyData: docSnap.data(),
    migrate: false,
  })

  if (accessToken) {
    try {
      const client = getPlaidClient()
      await client.itemRemove({ access_token: accessToken })
    } catch (err) {
      const code = err.response?.data?.error_code
      if (code !== 'INVALID_ACCESS_TOKEN' && code !== 'ITEM_NOT_FOUND') {
        console.warn('[plaid] itemRemove failed:', err.message)
        return res.status(502).json({ error: 'The brokerage could not be disconnected. Please try again.' })
      }
    }
  }

  // Deleted after the revoke attempt, and unconditionally: a token whose item
  // is gone is dead weight, and one left behind outlives the connection it
  // belonged to.
  await deleteAccessToken({ db, itemId: resolvedItemId })
  await docRef.delete()
  return res.status(200).json({ success: true })
}


// ─── Scheduled re-sync (#87) ──────────────────────────────────────────────────

/**
 * Keeps every connected item's ledger current, on a cron.
 *
 * Not a route of its own: this deployment is at its serverless-function
 * ceiling, and the sync logic already lives here. It is reached at
 * `/api/plaid?mode=scheduled-sync` and authorised by CRON_SECRET rather than a
 * Firebase ID token, because a cron has no session — which is why the check
 * below runs *before* verifyCaller rather than alongside it.
 *
 * Two properties the issue asks for, and one it implies:
 *
 *   · **Incremental.** The window is derived from each item's own
 *     `lastSyncedAt`, with a few days of overlap, rather than re-pulling 24
 *     months every night. Re-fetching the overlap is free — ledger ids are
 *     derived from the transaction, so writing one twice is the same write.
 *
 *   · **A failure for one item does not abandon the others**, and is reported
 *     rather than swallowed (#55). Every item is settled independently and the
 *     response carries the per-item errors.
 *
 *   · `lastSyncedAt` is written **only after** that item succeeds. Advancing it
 *     on failure would step the next run's window past the days that were
 *     never imported, turning a transient outage into a permanent gap.
 */
async function handleScheduledSync(req, res) {
  const db = getDb()
  const client = getPlaidClient()
  const resolveFxRates = (dates) => getRatesForDates(dates, { cache: historicalFxCache() })

  // Every connection, across every user. The parent of a `plaid` document's
  // parent collection is the user document, which is where the uid comes from.
  const items = await db.collectionGroup('plaid').get()
  if (items.empty) return res.status(200).json({ items: 0, written: 0, errors: [] })

  const settled = await Promise.allSettled(items.docs.map(async (doc) => {
    const uid = doc.ref.parent.parent?.id
    if (!uid) throw new Error(`Plaid item ${doc.id} has no owning user`)

    const result = await syncTransactionsForItem({
      client, db, uid, doc, resolveFxRates, since: doc.data()?.lastSyncedAt ?? null,
    })
    await doc.ref.set({ lastSyncedAt: new Date().toISOString() }, { merge: true })
    return { uid, itemId: doc.id, ...result }
  }))

  const errors = settled
    .map((outcome, index) => (outcome.status === 'rejected'
      ? { itemId: items.docs[index].id, error: outcome.reason?.message ?? String(outcome.reason) }
      : null))
    .filter(Boolean)

  const written = settled.reduce((sum, outcome) => sum + (outcome.status === 'fulfilled' ? outcome.value.written : 0), 0)
  const fetched = settled.reduce((sum, outcome) => sum + (outcome.status === 'fulfilled' ? outcome.value.fetched : 0), 0)

  if (errors.length) console.error('[plaid:scheduled-sync] item failures:', errors)
  console.log(`[plaid:scheduled-sync] ${items.size} items, ${written} written, ${fetched} fetched, ${errors.length} failed`)

  // A run where every connection failed is not a success, and #55 established
  // that a partial Plaid failure must not be reported as one either.
  return res.status(errors.length === items.size ? 503 : 200).json({
    items: items.size, written, fetched, errors,
  })
}

// ─── Router ───────────────────────────────────────────────────────────────────

const ACTIONS = {
  'link-token': handleLinkToken,
  'exchange-token': handleExchangeToken,
  'select-accounts': handleSelectAccounts,
  'holdings': handleHoldings,
  'sync-transactions': handleSyncTransactions,
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
    // Before getAuth(), not after: this is the first code to run in the
    // request, so nothing else has created the app yet.
    ensureFirebaseApp()
    const decoded = await getAuth().verifyIdToken(token)
    return decoded.uid
  } catch (err) {
    // The caller is told nothing beyond "not signed in" — a rejection reason is
    // an oracle for anyone probing the route. The server, though, has to record
    // why, because the reasons are not interchangeable: an expired token is the
    // user's problem and clears on re-login, while a service account issued for
    // a different Firebase project rejects *every* token forever and no amount
    // of signing in again will fix it. Firebase names both projects in that
    // second case, and throwing the error away left a permanent misconfiguration
    // indistinguishable from an ordinary expiry.
    console.error('[plaid:auth] token verification failed:', err?.code || err?.errorInfo?.code || 'unknown', '-', err?.message)
    // The project the service account actually belongs to, so a mismatch is
    // visible in one line rather than inferred from an audience claim. Wrapped
    // because reading it must never turn a 401 into a crash — the diagnostic
    // exists to explain a failure, not to add one.
    try {
      console.error('[plaid:auth] admin project:', loadServiceAccount()?.project_id ?? 'unknown')
    } catch { /* the service account is unreadable, which the 500 path reports */ }
    throw Object.assign(new Error('Invalid or expired session'), { status: 401, cause: err })
  }
}

async function realHandler(req, res) {
  // The scheduled re-sync is the one caller with no user session, so it is
  // authorised by CRON_SECRET and answered before the Firebase gate below.
  // Kept narrow deliberately: it runs one fixed action for every user, takes
  // nothing from the request, and cannot name a uid.
  if (req.query?.mode === 'scheduled-sync') {
    if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
      return res.status(500).json({ error: 'Plaid credentials not configured' })
    }
    try {
      return await handleScheduledSync(req, res)
    } catch (err) {
      console.error('[plaid:scheduled-sync] failed:', err.response?.data || err.message)
      return res.status(500).json({ error: err.message })
    }
  }

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
