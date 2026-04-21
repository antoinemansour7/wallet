# Wallet

A stock portfolio tracker with daily research. Built with React + Firebase.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite |
| Auth | Firebase (Google sign-in only) |
| User data | Firebase Firestore |
| Routing | React Router v6 |
| Styling | Tailwind CSS |
| AI extraction | Groq-hosted model |
| Excel parsing | xlsx |
| PDF parsing | pdfjs-dist |
| Stock API | Polygon/Massive for US stocks, Yahoo Finance fallback/CDRs |
| Quote cache | Upstash Redis |

## Setup

### 1. Clone & install

```bash
git clone https://github.com/antoinemansour7/wallet.git
cd wallet
npm install
```

### 2. Configure Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication → Sign-in method → Google**
3. Enable **Firestore Database**
4. Register a web app and copy the config
5. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required env vars:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
GROQ_API_KEY
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
POLYGON_API_KEY
```

Optional server-side cache controls:

```
QUOTE_CACHE_TTL_SECONDS=300
QUOTE_CACHE_RETENTION_SECONDS=86400
QUOTE_REFRESH_CONCURRENCY=5
QUOTE_REFRESH_LIMIT=100
CRON_SECRET=your_cron_secret
```

Recommended Firestore rule for saved portfolios:

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

### 3. Run

```bash
npm run dev
```

### 4. Deploy on Vercel

Set the same Firebase `VITE_*`, `GROQ_API_KEY`, and Upstash Redis variables in Vercel Project Settings.
Set `POLYGON_API_KEY` if you want normal US equities to price through Polygon/Massive instead of Yahoo.
The app includes Vercel serverless functions under `api/` for AI extraction and market price refresh.
The scheduled `/api/refresh-prices` function is configured in `vercel.json`.

## CI/CD

GitHub Actions runs the pipeline in `.github/workflows/ci-cd.yml`.

- Pull requests to `main`: install dependencies, run tests, build, then deploy a Vercel preview if Vercel GitHub secrets are configured.
- Pushes to `main`: install dependencies, run tests, build, then deploy production to Vercel if Vercel GitHub secrets are configured.
- Manual runs: available from the GitHub Actions tab through `workflow_dispatch`.

Required GitHub repository secrets for Actions-based Vercel deployments:

```
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

If you use Vercel's built-in Git integration instead, leave those GitHub secrets unset. The CI job will still run, and the deploy jobs will skip without failing.

## Features

### Portfolio
- Upload a CSV, Excel (.xlsx/.xls), or PDF document of your holdings
- Dashboard renders after upload with KPI cards, charts, and grouped holdings
- Saved portfolios reload automatically when the same Google user signs back in
- Polygon/Massive refreshes normal US equity prices when `POLYGON_API_KEY` is configured
- Yahoo Finance still handles Canadian CDRs (`.NE`) and USD/CAD FX, and remains the fallback if Polygon is unavailable
- Market quote refresh updates market price, market value, day change, and unrealized P&L when symbols match
- Redis caches quotes by ticker so repeated refreshes reuse fresh prices instead of calling providers every time

> Uploaded files remain the source for share counts, account numbers, and book values.
> Canadian CDR rows must stay on their CAD listing. A CSV row like `MSTR` with `CDR` in the description is priced as `MSTR.NE`, not the US Nasdaq `MSTR`.

Quote refresh behavior:

- The Portfolio page refreshes prices automatically after upload and every 5 minutes while holdings are open.
- `/api/live-prices` checks Redis first and only calls Polygon/Yahoo for missing or stale tickers.
- Stale cached prices can still be returned if a provider fails.
- `vercel.json` schedules `/api/refresh-prices` daily to warm known ticker prices in the background.

### Research
- Daily market news and top movers — **pending stock API integration**

## Live Price API Options

The current app uses a hybrid market data router after parsing symbols:

- Polygon/Massive (`POLYGON_API_KEY`) — preferred for normal US stocks
- Yahoo Finance (unofficial, no key) — fallback, CDR `.NE` symbols, and USD/CAD FX
- Alpha Vantage (free key, limited daily quota)

## Roadmap

- [x] Wire up stock API for price refresh after upload
- [ ] Compute P&L per position from uploaded spreadsheet
- [ ] Chart portfolio value over time
- [ ] Watchlist with price alerts
- [ ] Live market news feed

## Spreadsheet Format

The app accepts CSV, Excel, and PDF files. Recommended columns:

| Column | Example |
|---|---|
| Symbol | AAPL |
| Shares | 10 |
| Avg Cost | 150.00 |
| Purchase Date | 2023-01-15 |
