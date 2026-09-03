# Local Development

The local boundaries that are not obvious from `npm run dev`, and have each
cost real debugging time before they were written down.

## Preview mode

Every page except `/login` sits behind Firebase sign-in, so a dev server alone
shows nothing. Google is the only implemented provider today; the approved
email/password direction and its identity constraint live in
[[Architecture/Authentication and Identity]].

```bash
VITE_MOCK_AUTH=true npx vite
```

This signs in a mock user and seeds a fixture portfolio. Add `?empty` to a
preview URL to render the app with nothing in it.

The fixture is deliberately awkward rather than tidy. It carries multiple
accounts and imports, a CDR, a Canadian leveraged ETF, a long name, a US holding
bought at a loss, a cash-only account, and a symbol no price provider resolves.
Every one of those shapes broke something once.

Both write paths are guarded, so the fixture can never reach Firestore or
localStorage.

The switch requires both `Boolean(import.meta.hot)` and
`import.meta.env.VITE_MOCK_AUTH === 'true'`. It uses `import.meta.hot`, not
`import.meta.env.DEV`. `vite build` strips the HMR branch, so setting the
environment variable cannot disable authentication in a production bundle.

## API routes in local development

Seven routes are mounted by `vite.config.js`: `extract-pdf`, `live-prices`,
`refresh-prices`, `get-research`, `nightly-research`, `plaid` and
`market-regime`.

Plaid and market regime use `serverlessHandlerPlugin`, a request/response
adapter that imports the real file under `api/`. The development server and
Vercel therefore execute one handler rather than two copies that can drift.
The older split — local frontend against the deployed Plaid function — is
closed.

A real local Plaid round trip needs sandbox `PLAID_CLIENT_ID`, `PLAID_SECRET`
and `PLAID_ENV`, plus `FIREBASE_SERVICE_ACCOUNT` for the server handler. Without
those credentials, preview mode is the honest path: it answers the connection
from fixtures and never leaves the machine.

`get-research-history`, `position-sizing`, `slack-events` and
`track-performance` remain Vercel-only. A client change that depends on one of
those must be exercised in a deployed preview rather than assumed local.

## Test environment

Node 20 is the repository baseline. The suite deliberately stays on jsdom 26:
jsdom 29's dependency chain needs Node 20.19+, while development and CI need to
work across Node 20 rather than whichever patch version happens to be newest.

The npm scripts force `VITE_MOCK_AUTH=false`, and Vite does not mirror `.env`
secrets into `process.env` during test mode. Tests cannot silently enter preview
auth or touch real Plaid, Redis and Firebase services because a developer's
local `.env` happens to contain them.

```bash
npm run lint
npm run test:run
```

## Two Windows shell traps

`NODE_ENV=production` may be set in the shell, so a plain `npm install` can omit
devDependencies. Use `--include=dev --include=optional` when repairing an
installation. The test scripts use `cross-env`, so prefer the npm commands above
to hand-typing platform-specific environment prefixes.

## Seeing the UI

Financial data and charts render at their final state immediately; the old
scroll-triggered `Reveal` wrapper was removed because it hid dashboard numbers
and produced blank screenshots. Motion is limited to changed-value feedback,
user-triggered disclosures and modal transitions. Test those once with
`prefers-reduced-motion` enabled as well as at normal speed.
