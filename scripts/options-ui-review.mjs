// Local, fixture-only browser review; no real auth, provider or storage calls.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'
import { optionsResearchFixture } from '../src/test/optionsResearchFixture.js'
import { buildOptionsResearchView } from '../src/server/options/researchView.js'
import { optionsShadowFixture } from '../src/test/optionsShadowFixture.js'
import { buildOptionsShadowView } from '../src/server/options/shadowView.js'

const output = await mkdtemp(resolve(tmpdir(), 'options-ui-review-'))
const mockAuth = resolve(output, 'auth.js')
await writeFile(mockAuth, `const user = { uid: 'review-owner', getIdToken: async () => 'fixture' }; export const useAuth = () => ({ user, isResearchOwner: true, signOut: async () => {} });`)
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
import React from 'react'; import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Options from '/src/pages/Options.jsx'; import Operations from '/src/pages/OptionsOperations.jsx'; import Shadow from '/src/pages/OptionsShadow.jsx'; import Navbar from '/src/components/Navbar.jsx'; import '/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter, null, React.createElement(Navbar), React.createElement('main', {className: 'pb-20 lg:pb-0'}, React.createElement(Routes, null,
React.createElement(Route, {path: '/options', element: React.createElement(Options)}),
React.createElement(Route, {path: '/options/operations', element: React.createElement(Operations)}),
React.createElement(Route, {path: '/options/testing', element: React.createElement(Shadow)}),
React.createElement(Route, {path: '/portfolio', element: React.createElement('p', null, 'Portfolio destination')})))));
</script></body></html>`
const server = await createServer({ configFile: false, root: process.cwd(), logLevel: 'error',
  plugins: [react(), { name: 'fixture-review', configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (!/^\/(options|portfolio)(\/|\?|$)/.test(req.url)) return next()
    res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, html))
  }) } }],
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-router-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'] },
  resolve: { alias: [{ find: /^.*context\/AuthContext$/, replacement: mockAuth }] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd(), output] } },
})
let browser
try {
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  const fixture = optionsResearchFixture()
  const now = () => Date.parse('2026-09-22T13:32:21Z')
  const research = await buildOptionsResearchView({ ...fixture, now })
  const details = Object.fromEntries(await Promise.all(fixture.contracts.map(async (contract) => [contract.contractId, await buildOptionsResearchView({ ...fixture, now, contractId: contract.contractId })])))
  const seeded = await optionsShadowFixture()
  const shadow = await buildOptionsShadowView({ archive: seeded.archive, now: () => Date.parse('2026-09-28T15:00:00Z') })
  let shadowState = 'running'
  // Realistic lists of 1, 3 and 10: distinct tickers, strikes, drivers and
  // risks, each detail read served by the fixture contract of its direction.
  const detailFor = new Map(fixture.contracts.map((contract) => [contract.contractId, contract.contractId]))
  const TICKERS = [['CRDO', 195, 5.3], ['MU', 142, 4.1], ['RKLB', 32.5, 1.85], ['NVDA', 185, 6.2], ['AMD', 170, 4.75], ['PLTR', 150, 5.05], ['SMCI', 48, 2.35], ['TSLA', 430, 12.4], ['META', 780, 14.1], ['SHOP', 160, 4.6]]
  const DRIVERS = [['underlyingSetup', 'convexity'], ['liquidity', 'deltaExposure'], ['expectedMoveCompatibility', 'thetaEfficiency'], ['underlyingSetup', 'liquidity'], ['technicalConfirmation', 'convexity']]
  const RISKS = [['iv_above_90th_percentile', 'missing_input_uses_existing_worst_case_penalty'], ['wide_spread', 'spread_in_upper_gate_band'], ['decay_above_horizon_limit', 'carry_loss_above_horizon_limit'], ['full_premium_at_risk', null], ['volume_only_by_prior_session', 'passed_volume_gate_on_prior_session_only']]
  const [callRow, putRow] = ['call', 'put'].map((direction) => research.candidates.find((row) => row.direction === direction))
  const candidates = (count) => TICKERS.slice(0, count).map(([ticker, strikePrice, ask], index) => {
    const row = index % 3 === 2 ? putRow : callRow
    const contractId = `osi:${ticker}261016${row.direction === 'call' ? 'C' : 'P'}${String(strikePrice * 1000).padStart(8, '0')}`
    detailFor.set(contractId, row.contractId)
    const spreadPct = 1.4 + (index * 0.9) % 6
    return { ...row, ticker, contractId, rank: index + 1, score: Number((61.4 - index * 2.35).toFixed(3)),
      contract: { ...row.contract, contractId, strikePrice, expirationDate: '2026-10-16' },
      observed: { ...row.observed, ask, bid: Number((ask * (1 - spreadPct / 100)).toFixed(2)), mid: Number((ask * (1 - spreadPct / 200)).toFixed(3)), spreadPct },
      selectedScenario: { ...row.selectedScenario, askEntryModeledBidReturnPct: Number((44.2 - index * 3.7).toFixed(2)) },
      drivers: DRIVERS[index % DRIVERS.length].map((component) => ({ component, points: 8, max: 10 })),
      risk: RISKS[index % RISKS.length][0], riskReason: RISKS[index % RISKS.length][1] }
  })
  // The next session before its scan: the latest record is the previous day's.
  const nextSession = (opening) => ({ ...research, candidates: candidates(3),
    summary: { ...research.summary, tradingDate: '2026-09-23', state: 'unavailable', reason: 'no_scan_for_current_session' },
    opening: { tradingDate: '2026-09-23', scheduledAt: '2026-09-23T13:31:00.000Z', deadlineAt: '2026-09-23T13:35:00.000Z', ...opening } })
  const today = (extra = {}, morning = {}) => ({ ...research, ...extra, morning: { ...research.morning, ...morning } })
  const SCENARIOS = {
    three: { view: today({ candidates: candidates(3) }), rows: 3 },
    ten: { view: today({ candidates: candidates(10) }), rows: 10 },
    one: { view: today({ candidates: candidates(1) }), rows: 1 },
    empty: { view: today({ candidates: [] }, { result: 'empty', state: 'empty' }), heading: 'No contracts passed today’s scan.' },
    degraded: { view: today({ candidates: candidates(3), evidenceStatus: 'partial' }, { completeness: 'partial', state: 'partial' }), rows: 3 },
    stale: { view: today({ candidates: candidates(3) }), rows: 3, at: '2026-09-22T13:40:00Z' },
    pending: { view: nextSession({ status: 'scheduled' }), heading: 'No scan yet today.', at: '2026-09-23T12:00:00Z' },
    failed: { view: nextSession({ status: 'failed', at: '2026-09-23T13:33:10.000Z' }), heading: 'Today’s scan failed.', at: '2026-09-23T13:40:00Z' },
    missed: { view: nextSession({ status: 'missed' }), heading: 'Scan missed the opening window.', at: '2026-09-23T13:40:00Z' },
    closed: { view: { ...nextSession({}), opening: null, summary: { ...research.summary, tradingDate: '2026-09-26', state: 'closed' } }, heading: 'Markets are closed today.', at: '2026-09-26T14:00:00Z' },
    historical: { view: nextSession({ status: 'failed', at: '2026-09-23T13:33:10.000Z' }), rows: 3, path: `?morning=${research.manifestId}`, at: '2026-09-23T13:40:00Z' },
    loading: { view: today({ candidates: candidates(3) }), hold: true },
  }
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.setFixedTime(new Date(now()))
  let view = SCENARIOS.three.view, deny = false, failReload = false, release = null
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    let body = {}, status = 200
    if (deny) { status = 403; body = { error: 'Owner required' } }
    else if (url.searchParams.has('owner')) body = { owner: true }
    else if (failReload) { status = 503; body = { error: 'Raw Redis provider error', referenceId: 'options-test-reference' } }
    else if (route.request().method() === 'POST') body = { detail: { refresh: { status: 'rejected', availableAt: '2026-09-22T14:00:00Z' } } }
    else if (url.searchParams.get('view') === 'shadow') body = { shadow: shadowState === 'not-started' ? { ...shadow, window: null, days: [], rows: [] } : shadow }
    else if (url.searchParams.get('view') === 'operations') body = { operations: { status: 'ok', checkedAt: new Date(now()).toISOString(), stageTimings: [{ metrics: { provider429Count: 2 } }] } }
    else if (url.searchParams.has('contractId')) body = { research: details[detailFor.get(url.searchParams.get('contractId'))] }
    else { if (release) await release.promise; body = { research: view } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page must not scroll horizontally')
  const screenshot = async (name) => { await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true }); await noOverflow() }
  const WIDTHS = [[1440, 1000], [768, 1024], [390, 844], [320, 760]]
  const firstViewport = {}
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of WIDTHS) {
      await page.setViewportSize({ width, height })
      for (const [name, scenario] of Object.entries(SCENARIOS)) {
        view = scenario.view
        await page.clock.setFixedTime(new Date(scenario.at || now()))
        if (scenario.hold) { release = {}; release.promise = new Promise((done) => { release.done = done }) }
        await page.goto(`${base}/options${scenario.path || ''}`, { waitUntil: scenario.hold ? 'domcontentloaded' : 'networkidle' })
        await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark')
        if (scenario.hold) {
          await page.getByText('Loading today’s scan…').waitFor()
          await screenshot(`${name}-${width}-${theme}`)
          release.done(); release = null
          await page.getByRole('article').first().waitFor()
          continue
        }
        if (scenario.rows) {
          await page.getByRole('article').first().waitFor()
          assert.equal(await page.getByRole('article').count(), scenario.rows, `${name} rows`)
          assert.equal(await page.getByText('Delta', { exact: true }).count(), 0)
          // The answer and the first contract are inside the first viewport.
          const box = await page.getByRole('article').first().boundingBox()
          firstViewport[`${name}-${width}`] = Math.round(box.y + box.height)
          assert(box.y + box.height <= height, `${name} at ${width}: first contract must be in the first viewport`)
        } else {
          await page.getByRole('heading', { name: scenario.heading }).waitFor()
          assert.equal(await page.getByRole('article').count(), 0, `${name} must not render contract rows`)
          assert.equal(await page.getByRole('group', { name: 'Direction' }).count(), 0, `${name} must not render the direction filter`)
        }
        if (name === 'stale') await page.getByText(/Quotes are now stale/).waitFor()
        if (name === 'historical') await page.getByText(/You’re viewing an earlier scan/).waitFor()
        await screenshot(`${name}-${width}-${theme}`)
      }
    }
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  view = SCENARIOS.three.view
  await page.clock.setFixedTime(new Date(now()))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/options`, { waitUntil: 'networkidle' })
  const first = page.getByRole('article').first()
  const toggle = first.getByRole('button', { name: /^Details for/ })
  await toggle.focus(); await page.keyboard.press('Enter')
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  const scenarios = first.locator('summary', { hasText: 'View scenarios' })
  await scenarios.focus(); await page.keyboard.press('Enter')
  await first.getByRole('table', { name: 'Archived scenario matrix' }).waitFor()
  await first.getByRole('combobox', { name: 'IV assumption' }).selectOption('0.9')
  assert.equal(await first.getByRole('table', { name: 'Archived scenario matrix' }).locator('tbody tr').count(), 7)
  await screenshot('mobile-scenarios')
  await scenarios.focus(); await page.keyboard.press('Space')
  assert.equal(await first.locator('details').first().getAttribute('open'), null)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const contract = first.locator('summary', { hasText: 'Contract details' })
  await contract.focus(); await page.keyboard.press('Enter')
  await first.getByText('Delta', { exact: true }).waitFor()
  await screenshot('desktop-contract')
  for (const label of ['Why it ranked', 'Chain comparison', 'Data lineage']) {
    const summary = first.locator('summary', { hasText: label }).first()
    await summary.focus(); await page.keyboard.press('Enter')
    assert.equal(await summary.evaluate((node) => node.parentElement.open), true)
    await noOverflow()
    await page.keyboard.press('Space')
  }
  await page.goto(`${base}/options`, { waitUntil: 'networkidle' })
  await page.getByRole('article').first().waitFor()
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  failReload = true
  await page.getByRole('button', { name: 'Reload', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('article').count(), 3)
  assert(!(await page.locator('body').innerText()).includes('Raw Redis'))
  await screenshot('reload-unavailable')
  failReload = false
  await page.goto(`${base}/options/operations`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Options operations' }).waitFor()
  await screenshot('operations')
  for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844], [320, 760]]) {
    await page.setViewportSize({ width, height })
    await page.goto(`${base}/options/testing`, { waitUntil: 'networkidle' })
    await page.getByRole('article').first().waitFor()
    await screenshot(`shadow-${width}`)
  }
  const pick = page.getByRole('article').first()
  const checkpoints = pick.locator('summary', { hasText: 'Checkpoints' })
  await checkpoints.focus(); await page.keyboard.press('Enter')
  await pick.getByRole('region', { name: 'EX checkpoints' }).waitFor()
  await screenshot('shadow-320-checkpoints')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await screenshot('shadow-desktop-dark')
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  assert.equal(await page.locator('.options-workspace').getByRole('button').filter({ hasNotText: 'Reload' }).count(), 0)
  shadowState = 'not-started'
  await page.goto(`${base}/options/testing`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'The shadow test has not started' }).waitFor()
  await screenshot('shadow-not-started')
  deny = true
  for (const path of ['/options', '/options/operations', '/options/testing']) {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
    await page.getByText('Portfolio destination').waitFor()
    assert.equal(await page.getByRole('heading', { name: 'Morning opportunities' }).count(), 0)
    assert.equal(await page.getByRole('heading', { name: 'Shadow test' }).count(), 0)
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ output, result: 'passed', widths: WIDTHS.map(([width]) => width), themes: ['light', 'dark'], states: Object.keys(SCENARIOS), firstContractBottom: firstViewport, keyboard: 'Enter details toggle; Enter/Space disclosures; native selects', errors }))
} finally { await browser?.close(); await server.close() }
