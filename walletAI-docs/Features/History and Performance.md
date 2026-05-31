# History and Performance

Track whether the engine actually picks winners.

---

## How It Works

1. Each nightly run stores picks in `research:history:<date>` (Redis, 7d TTL)
2. History page fetches all stored days via `/api/get-research-history`
3. **Excludes today's picks** — only shows yesterday and older (fair comparison)
4. Fetches live prices via `/api/live-prices` for all historical tickers
5. Computes `(currentPrice - pickPrice) / pickPrice` for % return

## Stats Display

### All Picks
Shows win rate, avg return, total picks tracked across all conviction levels.

### Conviction >= 7 (highlighted in green)
Separate stats for only high-conviction picks. This answers: "does the engine's confidence actually correlate with returns?"

## Performance Badge

Each pick shows:
- Price at pick date → Current price
- Green badge (+X.X%) or red badge (-X.X%)

## Data Retention

- History entries: 7-day TTL in Redis
- Index capped at 30 entries
- Older picks fall off automatically

## Insights So Far

As of May 4, 2026 (4 days of data):
- BAND: +38.6% (picked at $33.19)
- TEAM: +36.3% (picked at $67.68)  
- CUE: +14.2%
- BE: +8.5%
- Worst: AMD -2.8%, INTC -1.9%

## Future Ideas

- [ ] Extend retention beyond 7 days (archive to a persistent store)
- [ ] Add a chart showing cumulative returns over time
- [ ] Compare "conviction >= 7 only" vs "all picks" as a portfolio strategy
- [ ] Track if screener-confirmed picks outperform non-screener picks
