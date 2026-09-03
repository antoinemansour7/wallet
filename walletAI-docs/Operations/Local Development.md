# Local Development

Three things about this repo that are not obvious and each cost real debugging
time before they were written down.

## Preview mode

Every page except `/login` sits behind Firebase Google sign-in, so a dev server
alone shows nothing.

```bash
VITE_MOCK_AUTH=true npx vite
```

Signs in a mock user and seeds a fixture portfolio. `?empty` on any preview URL
renders the app with nothing in it, for looking at empty states.

The fixture is deliberately awkward rather than tidy — designing against clean
data tells you almost nothing. It carries two accounts, three imports, a CDR, a
Canadian leveraged ETF, a long name that has to truncate, a US holding bought at
a loss with no recorded currency, a cash-only account with no imports, and a
holding no price provider will resolve. Every one of those shapes broke something
once.

Both write paths are guarded, so the fixture can never reach Firestore or
localStorage.

The switch is `Boolean(import.meta.hot) && import.meta.env.VITE_MOCK_AUTH === 'true'`
— `import.meta.hot`, **not** `import.meta.env.DEV`. Something in this environment
exports `NODE_ENV=production`, which makes `DEV` false even under `vite dev`, so
the bypass silently failed to engage. `vite build` strips `import.meta.hot`, so
the branch cannot exist in a real bundle.

## `api/plaid.js` does not run locally

`vite.config.js` hand-registers a dev middleware for each API route it supports:
`extract-pdf`, `live-prices`, `live-quote`, `refresh-prices`, `get-research`,
`nightly-research`.

**There is no plaid plugin.** So a request to `/api/plaid` from localhost leaves
the machine and hits the *deployed* function, while the rest of the app is your
local build. New frontend against old backend, and nothing says so.

That produced the currency bug above: a client change assumed a server field the
deployed route did not yet send, and the broken combination existed **only** in
the local pairing — it could not be reproduced in preview mode and would not have
appeared in production.

Until a dev route exists, exercise the connect flow in preview mode, which
answers the Plaid calls from the fixture and involves no server at all.

Six routes are now hand-written copies of serverless handlers. Any of them can
drift from its deployed twin and nothing would catch it.

## The test suite needs Node 20.19+

`vite.config.js` sets `test.environment: 'jsdom'` globally, and jsdom 29 pulls
`html-encoding-sniffer` → `@exodus/bytes`, which needs `require(esm)` — landed in
Node **20.19**. On older 20.x every vitest worker dies at startup with
`ERR_REQUIRE_ESM` before a single test file loads.

CI pins `node-version: 20`, which resolves to a newer 20.x, so GitHub Actions is
unaffected. This is an environment ceiling, not a repo defect — do not chase it
as a bug.

Below 20.19, most of the signal is still available:

```bash
NODE_ENV=test npx vitest run src --environment=node
```

Everything that does not need a DOM runs. Exactly three files fail, and they fail
*because of* the environment: `ProtectedRoute.test.jsx`, `Login.test.jsx`, and
the `FileReader` case in `parseSpreadsheet.test.js`. Treat that set as the green
baseline; anything outside it is a real regression.

## Two Windows shell traps

`NODE_ENV=production` is set in the shell, so a plain `npm install` silently
omits devDependencies — use `--include=dev --include=optional`. And the `test`
scripts use POSIX `NODE_ENV=x` prefixes that cmd.exe cannot parse; `cross-env`
handles it in the npm scripts, but a hand-typed command needs a POSIX shell.

## Seeing the UI

Screenshots need care: account cards and most panels are wrapped in `Reveal`,
which holds children at opacity 0 until IntersectionObserver fires. A full-page
screenshot does **not** scroll, so everything below the fold captures blank and
looks like a rendering bug. Scroll in steps, return to top, then capture.
