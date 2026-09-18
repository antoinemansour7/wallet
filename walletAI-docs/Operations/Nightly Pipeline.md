# Nightly Pipeline

Automated daily research run.

---

## Schedule

Configured as a Vercel Cron Job hitting `/api/nightly-research`.

## What Runs

1. Collect X signals (~125 tweets from curated accounts)
2. Fetch Yahoo RSS (~70 articles)
3. Run Finviz screener (~20-35 candidates)
4. Build signal board + rank with archetype scoring
5. Fetch sector ETF trends + live quotes
6. Send to Claude for final pick selection (top 5)
7. Generate OpenAI reports (or skip if no credits)
8. Store in Redis (`research:latest` + `research:history:<date>`)

## Duration

Full run: ~30-60 seconds locally, ~45-90s on Vercel

## Manual Trigger

```bash
# Locally (recommended — avoids Vercel auth issues)
env $(grep -v '^#' .env | grep -v '^\s*$' | xargs) node run-research.mjs

# Or via inline script for just tickers (no Redis storage)
env $(grep -v '^#' .env | grep -v '^\s*$' | xargs) node --input-type=module << 'EOF'
import { collectXSignals } from './src/server/xSignals.js'
import { fetchAllYahooNews, extractTickers } from './src/server/researchEngine.js'
import { fetchBreakoutCandidates, candidatesToSignals } from './src/server/technicalScreener.js'

let signals = []
try { const x = await collectXSignals(); signals = x.signals } catch {}
const articles = await fetchAllYahooNews()
try { const c = await fetchBreakoutCandidates(); signals = [...signals, ...candidatesToSignals(c)] } catch {}
const tickers = await extractTickers(signals, articles)
for (const t of tickers) console.log(`${t.ticker} (${t.conviction}/10) — ${t.reason}`)
EOF
```

## Non-deterministic

Each run can produce different results because:
1. X signals change (new tweets, old ones age out of 72h window)
2. Yahoo news rotates
3. Finviz screener candidates shift with market
4. Sector ETF quotes change intraday
5. Claude (temperature default) produces varied outputs

## Failure Modes

| Failure | Impact | Handling |
|---------|--------|----------|
| X API down | 0 signals | Non-fatal, continues with screener + news only |
| Finviz blocked | 0 screener candidates | Non-fatal, logged |
| Claude empty response | No picks | Retries 3x, then throws |
| OpenAI 429 (no credits) | No reports | Graceful fallback, picks stored without reports |
| Redis down | Nothing stored | Fatal for storage step |

## Duration and monitoring

Verified 2026-09-03.

`vercel.json` gives `api/nightly-research.js` a `maxDuration` of **300 seconds**,
which is exactly the Hobby ceiling — Vercel's limits with Fluid compute (on by
default) are 300s default and 300s maximum on Hobby, rising to 800s on Pro. The
setting is valid and honoured; nothing is being truncated.

Older figures of 10s and 60s are historical. Vercel raised Hobby to 60s, then
Fluid compute raised it to 300s, and blog posts quoting the earlier numbers are
still easy to find. Check the docs rather than a search result.

**Monitoring is `src/server/runLog.js`.** Every cron run writes a summary to
Redis under `logs:runs` — job, timestamp, `durationMs`, `ok`, and any errors —
keeping the last 90. It exists because Hobby keeps runtime logs for about an
hour, so a 3 AM run leaves no trace by morning.

Reading `logs:runs` is how to answer "is the pipeline healthy":

- `durationMs` near 299,000 with `ok: false` would mean the ceiling is being hit.
- A scheduled slot with **no entry at all** means the function died before
  reaching `recordRun` — the one failure Redis can't report, since the record
  is only written at the end.
