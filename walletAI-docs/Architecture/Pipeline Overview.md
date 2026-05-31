# Pipeline Overview

How a nightly research run works, end to end.

---

## Steps

### Step 1: X Signal Collection
**File:** `src/server/xSignals.js`

Pulls recent tweets from curated accounts. Each account has a `lane` (technical, flow, macro) and a `role` (conviction vs context).

Key accounts:
- `@MMatters22596` — technical, conviction
- `@Mr_Derivatives` — flow, conviction

Context-only accounts provide information but don't create conviction alone.

Output: `{ signals[], queries[], stats }`

### Step 2: Yahoo RSS
**File:** `src/server/researchEngine.js` → `fetchAllYahooNews()`

Fetches financial news headlines. Used as validation/context, not primary signal source.

### Step 2.5: Technical Screener
**File:** `src/server/technicalScreener.js`

Runs two Finviz screens:
- **Squeeze:** tight consolidation + rising relative volume + low volatility
- **Breakout:** new 50-day high + above SMA20/50

Filters: RSI < 70, monthly performance < 50%, avg volume > 300k, small-cap+

Results cached in Redis (12h TTL). Uses Googlebot UA to get server-rendered HTML.

### Step 3: Signal Board + Ranking
**File:** `src/server/researchEngine.js` → `buildSignalBoard()` + `rankHighUpsideBoard()`

Aggregates all signals per ticker, then scores each candidate:
- See [[Scoring Algorithm]] for weight breakdown
- Fetches live quotes for price bands
- Fetches sector ETFs for trend penalties
- Caps noisy signals (high volume, few sources)

### Step 4: Claude Ticker Selection
**File:** `src/server/researchEngine.js` → `extractTickers()`

Sends the ranked board + raw signal text + news + sector trends to Claude.
Claude picks top 5 based on the [[Claude Prompt Design]] framework.

### Step 5: OpenAI Reports (optional)
**File:** `src/server/researchEngine.js` → `generateResearchReports()`

For each pick, calls OpenAI with `web_search_preview` tool for deep research reports.
If credits are exhausted → picks are stored without reports (graceful fallback).

### Step 6: Redis Storage
Stores to:
- `research:latest` (48h TTL) — powers the Research page
- `research:history:<YYYY-MM-DD>` (7d TTL) — powers History page
- `research:history-index` (capped at 30 entries)

---

## Trigger Methods

| Method | Notes |
|--------|-------|
| Vercel Cron | Nightly via `api/nightly-research.js` |
| Local `run-research.mjs` | Manual run with `.env` vars |
| Vercel curl with CRON_SECRET | `Authorization: Bearer <secret>` header |
