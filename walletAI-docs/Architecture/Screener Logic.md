# Screener Logic

Finviz-based technical screener that identifies pre-breakout and squeeze candidates.

---

## Two Screens

### Squeeze Setup
Looking for: stocks in tight consolidation with building volume → likely to expand.

**Finviz filters:**
- Market cap: small-cap and above (>$300M)
- Avg volume: >300k shares/day (liquid enough to trade)
- Relative volume: >1 (more activity than normal today)
- Weekly performance: up
- Weekly volatility: low (consolidating, not erratic)
- Monthly performance: <50% (not already extended)
- RSI: <70 (not overbought)

### Breakout Setup
Looking for: stocks making new highs with trend confirmation.

**Finviz filters:**
- Market cap: small-cap and above
- Avg volume: >300k
- 50-day high/low: new high
- SMA20: price above
- SMA50: price above
- Monthly performance: <50%
- RSI: <70

## Why These Filters

| Filter | Purpose |
|--------|---------|
| Cap > small | Avoid illiquid microcaps |
| Vol > 300k | Ensures tradability, no slippage |
| Monthly < 50% | **Prevents chasing** — AAOI was up 100%+ monthly and still passing before this was added |
| RSI < 70 | Avoids overbought names about to correct |
| New 50d high | Confirms breakout, not just bouncing |
| Above SMAs | Confirms trend structure |

## How It Integrates

1. Screener results get converted to signals with `sourceType: 'screener'`
2. On the signal board, `screenerMentions` counter tracks how many screener hits
3. Scoring: `screenerMentions * 2.5` bonus in archetype score
4. Claude prompt: "screener-confirmed setups represent price action validation — weight heavily"

## Caching

- Redis key: `screener:breakout-candidates`
- TTL: 12 hours
- Must clear cache manually when filter logic changes: `redis.del('screener:breakout-candidates')`

## Technical Detail: Googlebot UA

Finviz renders tables via JavaScript for normal users. With a Googlebot User-Agent, it serves server-rendered HTML that we can parse without a headless browser.

```
User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)
```

## Evolution

| Date | Change | Reason |
|------|--------|--------|
| Apr 2026 | Initial screener | Needed technical confirmation beyond X chatter |
| May 4, 2026 | Added RSI<70 + monthly<50% | AAOI (up 100%) and AMD (up 30%+) were being returned as "breakout" even though they already broke out weeks ago |
| May 4, 2026 | Changed 30% → 50% cap | 30% was too aggressive, some stocks still have room at +30-40% |
