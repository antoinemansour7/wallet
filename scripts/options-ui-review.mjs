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

const output = await mkdtemp(resolve(tmpdir(), 'options-ui-review-'))
const mockAuth = resolve(output, 'auth.js')
await writeFile(mockAuth, `const user = { uid: 'review-owner', getIdToken: async () => 'fixture' }; export const useAuth = () => ({ user, isResearchOwner: true, signOut: async () => {} });`)
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
import React from 'react'; import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Options from '/src/pages/Options.jsx'; import Operations from '/src/pages/OptionsOperations.jsx'; import Navbar from '/src/components/Navbar.jsx'; import '/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter, null, React.createElement(Navbar), React.createElement('main', {className: 'pb-20 lg:pb-0'}, React.createElement(Routes, null,
React.createElement(Route, {path: '/options', element: React.createElement(Options)}),
React.createElement(Route, {path: '/options/operations', element: React.createElement(Operations)}),
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
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.clock.setFixedTime(new Date(now()))
  let state = 'theoretical', deny = false, failReload = false
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    let body = {}, status = 200
    if (deny) { status = 403; body = { error: 'Owner required' } }
    else if (url.searchParams.has('owner')) body = { owner: true }
    else if (failReload) { status = 503; body = { error: 'Raw Redis provider error', referenceId: 'options-test-reference' } }
    else if (route.request().method() === 'POST') body = { detail: { refresh: { status: 'rejected', availableAt: '2026-09-22T14:00:00Z' } } }
    else if (url.searchParams.get('view') === 'operations') body = { operations: { status: 'ok', checkedAt: new Date(now()).toISOString(), stageTimings: [{ metrics: { provider429Count: 2 } }] } }
    else if (url.searchParams.has('contractId')) body = { research: details[url.searchParams.get('contractId')] }
    else body = { research: { ...research, summary: { ...research.summary, state },
      morning: state === 'unavailable' ? null : { ...research.morning, observationMode: ['live', 'delayed'].includes(state) ? state : 'theoretical', completeness: state === 'partial' ? 'partial' : 'complete', result: state === 'empty' ? 'empty' : 'candidates' },
      candidates: ['empty', 'unavailable'].includes(state) ? [] : research.candidates } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page must not scroll horizontally')
  const screenshot = async (name) => { await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true }); await noOverflow() }
  for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844], [320, 760]]) {
    await page.setViewportSize({ width, height })
    await page.goto(`${base}/options`, { waitUntil: 'networkidle' })
    await page.getByRole('article').first().waitFor()
    assert.equal(await page.getByText('Delta', { exact: true }).count(), 0)
    await screenshot(`default-${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const first = page.getByRole('article').first()
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
  for (state of ['theoretical', 'delayed', 'live', 'stale', 'partial', 'closed', 'empty', 'unavailable']) {
    await page.goto(`${base}/options`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Reload record' }).waitFor()
    await screenshot(`state-${state}`)
  }
  state = 'theoretical'
  await page.goto(`${base}/options`, { waitUntil: 'networkidle' })
  await page.getByRole('article').first().waitFor()
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await screenshot('desktop-dark')
  failReload = true
  await page.getByRole('button', { name: 'Reload record' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('article').count(), 2)
  assert(!(await page.locator('body').innerText()).includes('Raw Redis'))
  await screenshot('reload-unavailable')
  failReload = false
  await page.goto(`${base}/options/operations`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Options operations' }).waitFor()
  await screenshot('operations')
  deny = true
  for (const path of ['/options', '/options/operations']) {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
    await page.getByText('Portfolio destination').waitFor()
    assert.equal(await page.getByRole('heading', { name: 'Morning opportunities' }).count(), 0)
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ output, result: 'passed', widths: [1440, 768, 390, 320], states: 8, keyboard: 'Enter/Space disclosures; native selects', errors }))
} finally { await browser?.close(); await server.close() }
