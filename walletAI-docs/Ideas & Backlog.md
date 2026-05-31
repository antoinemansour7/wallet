# Ideas & Backlog

Things to explore or build next.

---

## Engine Improvements

- [ ] **Extend history retention** — 7 days is short. Archive to a persistent store or increase TTL
- [ ] **Conviction correlation analysis** — do 8+ picks actually outperform 6-7 picks?
- [ ] **Screener vs non-screener comparison** — do screener-confirmed picks win more?
- [ ] **Add intraday timing** — run screener at market open AND close to catch afternoon setups
- [ ] **Earnings calendar integration** — auto-flag tickers reporting this week
- [ ] **Sentiment scoring on tweets** — NLP to detect bullish/bearish/neutral before Claude
- [ ] **Backtest framework** — replay historical signals through scoring algorithm to tune weights
- [ ] **Add more X accounts** — find accounts with high signal-to-noise ratio

## UI/UX

- [ ] **Cumulative return chart** on History page
- [ ] **Mobile optimization** — test on phone, fix any wrapping
- [ ] **Push notifications** — alert on high-conviction picks (>=8)
- [ ] **Watchlist** — let user add tickers to track even if engine doesn't pick them
- [ ] **Compare mode** — side-by-side pick performance across different days

## Operational

- [ ] **Migrate Claude model** — `claude-sonnet-4-20250514` is deprecated
- [ ] **Set temperature to 0** for more consistent picks (trade-off: less creative discovery)
- [ ] **Add alerting** — if nightly run fails, send notification
- [ ] **Fix GitHub SSH** — switch to correct account or use deploy key
- [ ] **Top up OpenAI credits** — reports add significant value to research

## Research

- [ ] **Sector rotation model** — identify which sectors are entering/exiting favor
- [ ] **Macro overlay** — VIX, DXY, rates context for Claude
- [ ] **Position sizing** — use conviction score to suggest allocation weighting
- [ ] **Stop-loss levels** — add suggested exit if thesis breaks
