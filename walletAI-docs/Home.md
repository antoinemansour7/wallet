# WalletAI

Personal AI-powered stock research engine + dark theme portfolio tracker.

---

## System at a Glance

```
X Signals (72h)  ──┐
Yahoo RSS News   ──┼──▶  Signal Board  ──▶  Claude Ranking  ──▶  Top Picks (≥6 conviction)
Finviz Screener  ──┘         │                     │
                             │                     ▼
                     Sector ETF Trends      OpenAI Reports (when credits available)
                     (penalty if down)            │
                                                  ▼
                                           Redis Storage ──▶ Research Page + History
```

## Quick Links

| Area | Notes |
|------|-------|
| [[Architecture/Pipeline Overview]] | End-to-end data flow |
| [[Architecture/Claude Prompt Design]] | How the LLM thinks about picks |
| [[Architecture/Screener Logic]] | Finviz filters and why |
| [[Architecture/Scoring Algorithm]] | Archetype score breakdown |
| [[Features/Research Page]] | UI decisions |
| [[Features/History and Performance]] | Tracking pick accuracy |
| [[Features/Portfolio]] | Dark theme, cash input |
| [[Operations/API Credits]] | Claude, OpenAI, X quotas |
| [[Operations/Deployment]] | Vercel, cron, Redis |
| [[Operations/Nightly Pipeline]] | What runs and when |

## Current Performance (as of May 4, 2026)

- **Win Rate (all):** 59% (10W / 7L)
- **Avg Return (all):** +5.5% per pick
- **Win Rate (conviction >= 7):** tracked separately on History page
- **Picks tracked:** 17 across 4 days
- **Best pick:** BAND +38.6%, TEAM +36.3%

## Design Principles

1. **Signal volume is a clue, not a conclusion** — lots of chatter doesn't mean a stock will move
2. **Catalyst specificity matters** — "bullish vibes" is noise, "earnings May 8 with whisper numbers 20% above" is signal
3. **Don't fight sector headwinds** — penalize stocks in declining sector ETFs
4. **Prefer early entries** — screener caps at 50% monthly gain and RSI < 70
5. **Tech bias (62.5%)** — reflects user's edge and market preference
6. **Graceful degradation** — if OpenAI credits dry up, picks still show without reports
