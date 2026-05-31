#!/usr/bin/env node

/**
 * NBC Wealth Headless Browser Sync
 *
 * Logs into NBC Direct Brokerage, downloads the holdings CSV,
 * parses it, and saves to Firestore.
 *
 * Usage:
 *   node scripts/sync-broker.mjs              # auto (headed if session expired)
 *   node scripts/sync-broker.mjs --headless   # force headless
 *   node scripts/sync-broker.mjs --headed     # force visible browser
 *
 * First-time setup:
 *   1. Download Firebase service account key from Firebase Console
 *      → Project Settings → Service accounts → Generate new private key
 *   2. Save to: ~/.wallai-session/firebase-service-account.json
 *   3. Set your Firebase UID in env: export WALLAI_UID="your-firebase-uid"
 *      (find it in Firebase Console → Authentication → Users)
 */

import { chromium } from 'playwright'
import { resolve, join } from 'path'
import { homedir } from 'os'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { savePortfolioToFirestore } from './firebase-admin.mjs'

// ─── Config ─────────────────────────────────────────────────────────────────

const NBC_HOME_URL = 'https://client.bnc.ca/nbdb/home'
const NBC_LOGIN_URL = 'https://client.bnc.ca/nbdb/login'
const SESSION_DIR = resolve(homedir(), '.wallai-session', 'nbc')
const DOWNLOAD_DIR = resolve(homedir(), '.wallai-session', 'downloads')
const UID = process.env.WALLAI_UID

if (!UID) {
  console.error('Error: WALLAI_UID env var is required. Set it to your Firebase user UID.')
  console.error('Find it at: Firebase Console → Authentication → Users')
  process.exit(1)
}

// ─── Parse CLI flags ────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const forceHeaded = args.includes('--headed')
const forceHeadless = args.includes('--headless')

// ─── CSV Parsing (mirrors src/utils/parseSpreadsheet.js logic) ──────────────

const COLUMN_ALIASES = {
  'ACCOUNT NUMBER': ['account number', 'account', 'account no', 'account #', 'no. de compte'],
  'ACCOUNT CURRENCY': ['account currency', 'currency', 'devise'],
  SYMBOL: ['symbol', 'ticker', 'symbole'],
  DESCRIPTION: ['description', 'security', 'security description', 'name', 'titre'],
  QUANTITY: ['quantity', 'shares', 'units', 'quantité', 'qté'],
  'AVERAGE UNIT COST': ['average unit cost', 'avg cost', 'average cost', 'cost basis per share', 'coût moyen', 'prix moyen'],
  'BOOK VALUE': ['book value', 'cost basis', 'total cost', 'valeur comptable'],
  'MARKET PRICE': ['market price', 'price', 'last price', 'prix du marché', 'cours'],
  'MARKET VALUE': ['market value', 'mkt value', 'value', 'valeur marchande', 'valeur au marché'],
  'UNREALIZED GAIN/LOSS': ['unrealized gain/loss', 'unrealized gain loss', 'unrealized p&l', 'p&l', 'gain/perte non réalisé'],
  'UNREALIZED GAIN/LOSS %': ['unrealized gain/loss %', 'unrealized gain loss %', 'unrealized p&l %', 'p&l %'],
}

const CASH_HINTS = ['cash', 'settled cash', 'unsettled cash', 'cash balance', 'encaisse', 'solde', 'espèces', 'buying power']

function buildHeaderMap(headers) {
  const map = {}
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const idx = headers.findIndex((h) => h.toLowerCase().trim() === alias)
      if (idx !== -1) { map[canonical] = idx; break }
    }
  }
  return map
}

function parseNum(val) {
  if (!val) return 0
  const cleaned = String(val).replace(/[$,%\s]/g, '').replace(/[()]/g, '-').replace(/,/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function parseCsv(text) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return { rows: [], cashEntries: [] }

  // Detect delimiter (NBC defaults to semicolons)
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  const headers = lines[0].split(delimiter).map((h) => h.replace(/^["']|["']$/g, '').trim())
  const headerMap = buildHeaderMap(headers)

  const rows = []
  const cashEntries = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map((c) => c.replace(/^["']|["']$/g, '').trim())
    if (cols.length < 3) continue

    const get = (key) => headerMap[key] !== undefined ? cols[headerMap[key]] : ''

    const symbol = get('SYMBOL')
    const description = get('DESCRIPTION')

    // Check if this is a cash row
    const isCash = CASH_HINTS.some((hint) =>
      (symbol || '').toLowerCase().includes(hint) || (description || '').toLowerCase().includes(hint)
    )

    if (isCash) {
      cashEntries.push({
        account: get('ACCOUNT NUMBER') || 'default',
        amount: parseNum(get('MARKET VALUE')) || parseNum(get('BOOK VALUE')),
        currency: get('ACCOUNT CURRENCY') || 'CAD',
      })
      continue
    }

    if (!symbol && !description) continue

    rows.push({
      'ACCOUNT NUMBER': get('ACCOUNT NUMBER') || 'NBC',
      'ACCOUNT CURRENCY': get('ACCOUNT CURRENCY') || 'CAD',
      SYMBOL: symbol,
      DESCRIPTION: description,
      QUANTITY: parseNum(get('QUANTITY')),
      'AVERAGE UNIT COST': parseNum(get('AVERAGE UNIT COST')),
      'BOOK VALUE': parseNum(get('BOOK VALUE')),
      'MARKET PRICE': parseNum(get('MARKET PRICE')),
      'MARKET VALUE': parseNum(get('MARKET VALUE')),
      'UNREALIZED GAIN/LOSS': parseNum(get('UNREALIZED GAIN/LOSS')),
      'UNREALIZED GAIN/LOSS %': parseNum(get('UNREALIZED GAIN/LOSS %')),
    })
  }

  return { rows, cashEntries }
}

// ─── Build account structure (mirrors accountPortfolio.js) ──────────────────

function buildAccounts(rows, cashEntries) {
  const accounts = {}
  for (const row of rows) {
    const acct = row['ACCOUNT NUMBER'] || 'NBC'
    if (!accounts[acct]) {
      accounts[acct] = { name: acct, currency: row['ACCOUNT CURRENCY'] || 'CAD', positions: [], cash: 0 }
    }
    accounts[acct].positions.push(row)
  }

  // Map cash by type (FHSA/TFSA) to CSV accounts. NBC uses account suffixes:
  // typically Q = FHSA, W = TFSA, but we distribute in order if we can't match.
  const acctKeys = Object.keys(accounts)
  const TYPE_SUFFIX_MAP = { FHSA: 'Q', TFSA: 'W', RRSP: 'R' }

  for (const entry of cashEntries) {
    const suffix = TYPE_SUFFIX_MAP[entry.account] || ''
    let matched = suffix ? acctKeys.find((k) => k.endsWith(suffix)) : null
    if (!matched) {
      // Fallback: assign to first account without cash, or first account
      matched = acctKeys.find((k) => accounts[k].cash === 0) || acctKeys[0] || entry.account
    }
    if (!accounts[matched]) accounts[matched] = { name: matched, currency: entry.currency, positions: [], cash: 0 }
    accounts[matched].cash += entry.amount
    // Store friendly name
    if (entry.account && !accounts[matched].accountType) {
      accounts[matched].accountType = entry.account
    }
  }
  return accounts
}

// ─── Main Script ────────────────────────────────────────────────────────────

async function main() {
  // Ensure directories exist
  mkdirSync(SESSION_DIR, { recursive: true })
  mkdirSync(DOWNLOAD_DIR, { recursive: true })

  console.log('[sync] launching browser...')

  // Start with headless first (if not forced headed)
  // Note: NBC blocks pure headless, so "headless" mode uses a virtual display trick:
  // we run headed but offscreen. Only --headed shows the window for manual login.
  let headless = forceHeaded ? false : true
  if (forceHeadless) headless = true

  const launchOptions = {
    headless: false,
    channel: 'chrome', // Use real installed Chrome, not Playwright's Chromium
    acceptDownloads: true,
    viewport: { width: 1280, height: 800 },
    args: [],
  }

  let context = await chromium.launchPersistentContext(SESSION_DIR, launchOptions)

  const page = await context.newPage()

  // Navigate to home — will redirect to login if session expired
  console.log('[sync] navigating to NBC...')
  await page.goto(NBC_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(3000)

  // Check if we need to log in
  const url = page.url()
  const needsLogin = url.includes('login') || url.includes('auth') || url.includes('signon')

  if (needsLogin) {
    if (forceHeadless) {
      console.error('[sync] ERROR: session expired and running in forced headless mode. Run with --headed first.')
      await context.close()
      process.exit(1)
    }

    const loginPage = headless ? await (async () => {
      await context.close()
      const headedContext = await chromium.launchPersistentContext(SESSION_DIR, {
        ...launchOptions,
        args: [],
      })
      const p = await headedContext.newPage()
      await p.goto(NBC_LOGIN_URL, { waitUntil: 'domcontentloaded' })
      await p.waitForTimeout(2000)
      context = headedContext
      return p
    })() : page

    console.log('[sync] >>> Please log in manually (credentials + 2FA) <<<')

    console.log('[sync] Waiting for you to reach the dashboard...')
    await loginPage.waitForURL((url) => !url.href.includes('login') && !url.href.includes('auth') && !url.href.includes('signon'), {
      timeout: 300000,
    })
    console.log('[sync] logged in! Continuing...')
    return continueAfterLogin(context, loginPage)
  } else {
    console.log('[sync] already logged in (session reused)')
  }

  // Continue in the same context
  await continueAfterLogin(context, page)
}

async function continueAfterLogin(context, page) {
  // ─── Navigate to holdings page ─────────────────────────────────────────
  console.log('[sync] navigating to holdings...')
  await page.goto('https://client.bnc.ca/nbdb/accounts/holdings', { waitUntil: 'domcontentloaded', timeout: 30000 })

  // Wait for actual content to load (skeleton loaders disappear, Export button appears)
  console.log('[sync] waiting for holdings data to load...')
  await page.waitForFunction(() => {
    const text = document.body.innerText
    return text.includes('Cash') && text.includes('Export')
  }, { timeout: 30000 }).catch(() => {
    console.log('[sync] timeout waiting for content — proceeding anyway')
  })
  await page.waitForTimeout(1000) // small extra buffer for any final renders

  // ─── Scrape cash balances (visible on holdings page) ───────────────────
  console.log('[sync] scraping cash balances...')
  const cashEntries = await page.evaluate(() => {
    const cash = []
    const bodyText = document.body.innerText
    // Match patterns like "CAD FHSA\n68BB39Q\n...\nCash\n2,779.48" or "Cash\n6,711.04"
    // Each account section has "CAD FHSA" or "CAD TFSA" followed by cash amount
    const sections = bodyText.split(/(?=CAD\s+(?:FHSA|TFSA|RRSP|MARGIN))/i)
    for (const section of sections) {
      const typeMatch = section.match(/CAD\s+(FHSA|TFSA|RRSP|MARGIN)/i)
      if (!typeMatch) continue
      const cashMatch = section.match(/Cash\s*([\d,]+\.\d{2})/i)
      if (cashMatch) {
        cash.push({
          account: typeMatch[1].toUpperCase(),
          amount: parseFloat(cashMatch[1].replace(/,/g, '')),
          currency: 'CAD',
        })
      }
    }
    return cash
  })

  console.log(`[sync] scraped ${cashEntries.length} cash balances:`,
    cashEntries.map(c => `${c.account}: $${c.amount}`).join(', '))

  // ─── Click Export button on the page ───────────────────────────────────
  console.log('[sync] clicking Export button...')

  const exportTrigger = page.locator('button:has-text("Export"), a:has-text("Export")').first()
  if (!(await exportTrigger.isVisible({ timeout: 10000 }).catch(() => false))) {
    console.error('[sync] ERROR: could not find Export button on home page.')
    console.error('[sync] Current URL:', page.url())
    const screenshotPath = resolve(DOWNLOAD_DIR, 'debug-screenshot.png')
    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.error(`[sync] Screenshot saved to: ${screenshotPath}`)
    await context.close()
    process.exit(1)
  }

  await exportTrigger.click()
  await page.waitForTimeout(1500)

  // ─── Handle Export modal: change delimiter to comma, then confirm ──────
  console.log('[sync] export modal opened, configuring...')

  // Change delimiter from ";" to "," for easier parsing
  const delimiterSelect = page.locator('select').first()
  if (await delimiterSelect.isVisible().catch(() => false)) {
    await delimiterSelect.selectOption(',')
    await page.waitForTimeout(500)
  }

  // Click the blue "Export" confirm button inside the modal
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('button:has-text("Export")').last().click(),
  ])

  const downloadPath = resolve(DOWNLOAD_DIR, download.suggestedFilename() || 'holdings.csv')
  await download.saveAs(downloadPath)
  console.log(`[sync] CSV downloaded: ${downloadPath}`)

  await context.close()

  // ─── Parse CSV ─────────────────────────────────────────────────────────
  console.log('[sync] parsing CSV...')
  const csvText = readFileSync(downloadPath, 'utf-8')
  console.log('[sync] CSV preview:', csvText.slice(0, 300))

  const { rows, cashEntries: csvCashEntries } = parseCsv(csvText)

  if (rows.length === 0) {
    console.error('[sync] WARNING: parsed 0 positions from CSV. Check the file format.')
    console.error('[sync] First 500 chars:', csvText.slice(0, 500))
  }

  console.log(`[sync] parsed ${rows.length} positions, ${csvCashEntries.length} cash entries from CSV`)

  // Merge: use scraped cash from home page (more reliable), fall back to CSV cash
  const allCashEntries = cashEntries.length > 0 ? cashEntries : csvCashEntries

  // ─── Build accounts and save ───────────────────────────────────────────
  const accounts = buildAccounts(rows, allCashEntries)
  console.log(`[sync] ${Object.keys(accounts).length} accounts: ${Object.keys(accounts).join(', ')}`)

  await savePortfolioToFirestore(UID, {
    fileName: `NBC-sync-${new Date().toISOString().slice(0, 10)}`,
    rows,
    accounts,
  })

  console.log('[sync] done! Portfolio synced to Firestore.')
}

main().catch((err) => {
  console.error('[sync] FATAL:', err.message)
  process.exit(1)
})
