# WallAI

A portfolio tracker for Canadian retail investors. Connect a brokerage or import a
statement, and it keeps one view of what you own across every account and
institution — with live prices, currency handled properly, and Canadian
instruments (CDRs, TSX listings, registered accounts) treated as first-class
rather than as edge cases.

There is also a nightly research pipeline that produces daily stock ideas. It is
the older half of the app and is being deliberately kept separate from the
portfolio side.

## Contents

- [What it does](#what-it-does)
- [Running it](#running-it)
- [Preview mode](#preview-mode-no-credentials-needed)
- [Environment variables](#environment-variables)
- [How the portfolio is modelled](#how-the-portfolio-is-modelled)
- [Statement format](#statement-format)
- [API routes](#api-routes)
- [Tests](#tests)
- [Deploying](#deploying)

## What it does

**Accounts.** An account is one or more *imports* stacked on top of each other —
a connected brokerage, a CSV, a PDF statement. Each import keeps its own
identity, so you can remove one without losing the others, and see what an
account is actually made of.

**Connect a brokerage** through Plaid, or **import a statement** (CSV, XLSX, or
PDF). A connected brokerage reports which account each holding belongs to, so
those accounts are created as they come. A file cannot say that reliably, so it
asks where the statement should land, and states what the merge will do before
doing it.

**Live prices** refresh on load and every five minutes, cached in Redis by
ticker. Holdings whose price could not be refreshed say when they were last
priced rather than presenting an old number as current.

**Currency.** Rows carry two separate facts: `ACCOUNT CURRENCY` — what the
figures are denominated in — and `CURRENCY`, what the security trades in. A US
holding in a Canadian account is converted, its cost basis converted with it, so
the return is a return and not the exchange rate.

**Canadian instruments.** Canadian Depositary Receipts are identified from what
the institution reports and priced against their Cboe Canada listing, not the US
share. TSX-listed securities that providers will not resolve bare are retried
with `.TO`.

**Light and dark themes**, following the system preference unless overridden.

**Research** (separate from the above): a nightly pipeline reads X, news and
screeners, extracts candidate tickers, and generates reports.

## Running it

Requires **Node 22**.

```bash
git clone https://github.com/antoinemansour7/wallet.git
cd wallet
npm install
cp .env.example .env     # then fill it in — see below
npm run dev
```

The fastest way to see the app working is **preview mode**, which needs no
credentials at all.

## Preview mode (no credentials needed)

```bash
VITE_MOCK_AUTH=true npx vite
```

Every page except `/login` sits behind Firebase Google sign-in, so a dev server
alone shows you nothing. Preview mode signs in a mock user and seeds a fixture
portfolio — deliberately awkward data rather than tidy data: two accounts, three
imports, a CDR, a leveraged ETF, a US holding bought at a loss, a cash-only
account, and a holding no price provider will resolve. Those shapes are the ones
that break things.

Both write paths are guarded, so the fixture can never reach Firestore or
localStorage.

| URL | Shows |
|---|---|
| `/portfolio` | The seeded portfolio |
| `/portfolio?empty` | The app with nothing in it, for empty states |

Preview mode also answers the Plaid calls from the fixture. It is the
credential-free way to exercise the connect flow locally; use the regular dev
server with Plaid sandbox credentials when the real API round trip is what you
need to test. See [API routes](#api-routes).

## Environment variables

### Required to run at all

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID    # optional
```

Create a project at [console.firebase.google.com](https://console.firebase.google.com),
enable **Authentication → Sign-in method → Google** and **Firestore Database**,
register a web app, and copy the config.

Firestore rules:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

The recursive wildcard covers the `portfolio-history` subcollection the
performance chart writes to. If the browser console reports `permission-denied`
against it, the deployed rules are narrower than the ones above.

### Connecting a brokerage

```
PLAID_CLIENT_ID
PLAID_SECRET
PLAID_ENV                       # sandbox | production
FIREBASE_SERVICE_ACCOUNT        # service-account JSON, as one line
```

`FIREBASE_SERVICE_ACCOUNT` is what the serverless functions use to reach
Firestore, from Firebase Console → Project Settings → Service Accounts. Plaid
retired the `development` environment; only `sandbox` and `production` are valid.

### Market data

```
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
POLYGON_API_KEY                 # optional — preferred for US equities
POLYGON_API_BASE_URL            # optional
MASSIVE_API_KEY                 # optional
MASSIVE_API_BASE_URL            # optional
```

Yahoo Finance needs no key and is the fallback, the source for CDR (`.NE`)
listings, and where the USD/CAD rate comes from. Without Redis, every refresh
calls the providers directly.

### Research pipeline

```
GROQ_API_KEY                    # ticker extraction from statements and signals
OPENAI_API_KEY
ANTHROPIC_API_KEY
EXA_API_KEY                     # discovery search
X_BEARER_TOKEN                  # app-only read access to the X API
X_PROVIDER                      # which read path to use
X_API_BASE_URL
TWITTERAPI_IO_KEY               # alternative X read path
TWITTERAPI_IO_BASE
CRON_SECRET                     # guards the scheduled endpoints
```

`GROQ_API_KEY` is also used by PDF statement extraction, so it is worth setting
even if you never run research.

### Tuning (all optional)

```
QUOTE_CACHE_TTL_SECONDS=300
QUOTE_CACHE_RETENTION_SECONDS=86400
QUOTE_REFRESH_CONCURRENCY=5
QUOTE_REFRESH_LIMIT=100
NEWS_MAX_AGE_HOURS
RESEARCH_EFFORT
SCREENER_MAX_PAGES
TWITTERAPI_IO_DELAY_MS
TWITTERAPI_IO_MAX_PAGES
```

## How the portfolio is modelled

Worth knowing before changing anything in `src/utils/`:

- **An account is a set of imports.** Every position carries `__sourceId`
  identifying which import it came from. Removing an import removes only its
  positions; removing the last one removes the account.
- **A new import adds, a repeat replaces.** A statement from a source not seen
  before is added alongside. A fresher statement from the same source replaces
  what that source loaded last time.
- **A merge states its effects before running**, so combining two brokerages is
  not a gamble.
- **A price refresh is not a statement.** `buildAccountPortfolio` does not infer
  trades. Rows missing from a refresh are a gap in the data, not a sale — reading
  them as sales once emptied an account and credited it with proceeds nobody
  received.
- **Same-symbol rows are pooled**, so two accounts holding one ETF import as a
  single line with the quantities added rather than as a duplicate.

## Statement format

CSV, XLSX and PDF are accepted. Columns are matched case-insensitively against
these names and a set of aliases, and only `SYMBOL` (or `DESCRIPTION`) plus a
value is really needed — anything missing is derived or left empty.

| Column | Also accepted as | Example |
|---|---|---|
| `SYMBOL` | ticker | `VFV.TO` |
| `DESCRIPTION` | security, name | `VANGUARD S&P 500 INDEX ETF` |
| `QUANTITY` | shares, units | `96` |
| `MARKET PRICE` | price, last price | `148.20` |
| `MARKET VALUE` | mkt value, value | `14227.20` |
| `BOOK VALUE` | cost basis, total cost | `12100.00` |
| `AVERAGE UNIT COST` | avg cost, cost basis per share | `126.04` |
| `ACCOUNT NUMBER` | account, account no | `68BB39Q` |
| `ACCOUNT CURRENCY` | currency | `CAD` |
| `DAY CHANGE` | today change | `58.90` |
| `DAY CHANGE %` | change % | `0.41%` |
| `UNREALIZED GAIN/LOSS` | unrealized p&l, p&l | `2127.20` |
| `UNREALIZED GAIN/LOSS %` | p&l % | `17.58%` |

Rows whose symbol or description reads as cash are pulled out as a cash balance
rather than treated as a holding.

> A CDR row must stay on its Canadian listing. A row like `MSTR` with `CDR` in
> the description is priced as `MSTR.NE`, not the US Nasdaq `MSTR` — the two
> differ by several times.

## API routes

Eleven serverless functions live under `api/`, one below the Vercel Hobby limit.

| Route | Runs locally? | Notes |
|---|---|---|
| `extract-pdf` | yes | Vite middleware |
| `live-prices` | yes | Vite middleware |
| `refresh-prices` | yes | Vite middleware |
| `get-research` | yes | Vite middleware |
| `nightly-research` | yes | Vite middleware |
| `plaid` | yes | The same `api/plaid.js` handler as production; needs Plaid sandbox and Firebase service-account credentials |
| `market-regime` | yes | Same real-handler pattern as `plaid` — split out of `get-research` in #68 so each route stays to one job |
| `get-research-history`, `position-sizing`, `track-performance` | no | Vercel only |

The dev server hand-registers a middleware for each route it supports, in
`vite.config.js`. The Plaid middleware is an adapter rather than a second
implementation: it parses the local request, supplies Vercel's response helpers,
and invokes the default export from `api/plaid.js`. A client and Plaid handler
change can therefore be tested together on one machine. Without Plaid or
Firebase credentials, use [preview mode](#preview-mode-no-credentials-needed),
which keeps the whole connect flow inside fixtures.

## Tests

```bash
npm run test:run
```

Node 22 is the project and Vercel runtime baseline. Tests use jsdom 26 so the full suite works
across Node 22 patch releases. The npm scripts also force mock auth off, and
Vite does not mirror `.env` secrets into the test process, so local credentials
cannot silently turn unit tests into integration tests.

The deterministic catalyst pipeline smoke test is part of that command. It
uses fixed service adapters while running the real discovery, admission,
review-validation, catalyst, ranking, publication, API, and React UI code.

To diagnose the configured live research services with a known upcoming event:

```bash
npm run research:e2e:live -- --ticker ABC --event "earnings on October 22 after close" --date 2026-10-22
```

The live smoke is opt-in and never runs in CI. It prints the first failing stage
and keeps its persistence check in memory, so it cannot replace the published
`research:latest` payload. Use `--help` for the accepted arguments.

## Deploying

Vercel hosts both the static build and the functions in `api/`. `vercel.json`
holds the SPA rewrite and four cron schedules.

Two deploy paths exist and only one of them works:

- **Vercel's Git integration** deploys on push to `main`. This is what actually
  ships.
- **GitHub Actions** (`.github/workflows/cd.yml`) deploys after CI succeeds on
  `main`, but only if `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are
  set as repository secrets. Without them every step skips and the job still
  reports success.

CI (`.github/workflows/ci.yml`) runs on pull requests and pushes to `main`,
installing, testing and building.

Set the same environment variables in Vercel Project Settings that you set
locally.
